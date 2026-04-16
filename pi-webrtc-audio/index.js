// pi-webrtc-audio.js (Answerer - Raspberry Pi)
// Multi-peer support: each remote peer gets its own RTCPeerConnection + RTCAudioSink.
// Audio from all peers is mixed (sample-level additive with clipping) into a single speaker process.
// Non-trickle ICE: offer/answer sending after collecting all ICE candidates.

const wrtc = require('wrtc');
const WebSocket = require('ws');
const { spawn, execSync } = require('child_process');
const path = require('path');

// ====== ENV / CONFIG ======
const SIGNALING_URL =
	process.env.SIGNALING_URL || 'ws://192.168.77.100:8080/ws';
const PEER_ID = process.env.PEER_ID || 'raspi-1';
const ARECORD_DEV = process.env.ARECORD_DEV || 'plughw:2,0';
const SPEAKER_DEV = process.env.SPEAKER_DEV || 'plughw:2,0';
const USE_STUN = parseInt(process.env.USE_STUN || '0');
const SAMPLE_RATE = parseInt(process.env.SAMPLE_RATE || '48000');
const CHANNELS = parseInt(process.env.CHANNELS || '1');
const RECONNECT_DELAY = parseInt(process.env.RECONNECT_DELAY || '1500');
const DISABLE_MIC = parseInt(process.env.DISABLE_MIC || '1');
const USE_PULSEAUDIO = parseInt(process.env.USE_PULSEAUDIO || '1');
const APLAY_BUFFER_US = parseInt(process.env.APLAY_BUFFER_US || '20000');
const APLAY_PERIOD_US = parseInt(process.env.APLAY_PERIOD_US || '5000');
const SINK_FRAME_MS = parseInt(process.env.SINK_FRAME_MS || '10');
const PULSE_SINK = process.env.PULSE_SINK || '';
const PULSE_SOURCE = process.env.PULSE_SOURCE || '';
// ==========================

// Effect file paths
const DOOR_CLOSE_WAV = path.join(__dirname, 'door_close.wav');
const DOOR_OPEN_WAV = path.join(__dirname, 'door_open.wav');
const START_SESSION_WAV = path.join(__dirname, 'start_session.wav');
const TAKEOFF_MASK_WAV = path.join(__dirname, 'takeoff_mask.wav');
const PUTON_MASK_WAV = path.join(__dirname, 'puton_mask.wav');
const END_SESSION_WAV = path.join(__dirname, 'end_session.wav');
const DECO_START_WAV = path.join(__dirname, 'deco_start.wav');

console.log('Starting Pi WebRTC audio bridge (multi-peer)...');
console.log('Signaling URL:', SIGNALING_URL);
console.log('Peer ID:', PEER_ID);
console.log('Microphone device:', ARECORD_DEV);
console.log('Speaker device:', SPEAKER_DEV);
console.log('Sample rate:', SAMPLE_RATE);
console.log('Channels:', CHANNELS);
console.log('Mic disabled mode:', !!DISABLE_MIC);

// ---- Multi-peer session map ----
// Each entry: { pc, sink, pendingIce, pcmBuffer, lastDataTime, timeoutInterval }
const peerSessions = new Map();

let audioSource = null;
let audioTrackOut = null;
let arecord = null;
let isShuttingDown = false;

// ---- Audio mixing (event-driven) ----
const frameBytes = Math.floor(SAMPLE_RATE * (SINK_FRAME_MS / 1000)) * CHANNELS * 2;
const frameSamples = frameBytes / 2;
let mixerPaused = false; // paused during effect playback
let speakerBackpressure = false; // true while waiting for drain

function speakerReady() {
	return speakerProc && !speakerProc.killed && speakerProc.stdin &&
		!speakerProc.stdin.destroyed && !speakerProc.stdin.writableEnded &&
		speakerProc.stdin.writable;
}

// Called from every peer's ondata — flushes one mixed frame per call
function tryFlushMix() {
	if (isShuttingDown || mixerPaused || speakerBackpressure || !speakerReady()) return;

	const activeSessions = [];
	for (const session of peerSessions.values()) {
		if (session.pcmBuffer.length >= frameBytes) {
			activeSessions.push(session);
		}
	}

	if (activeSessions.length === 0) return;

	// Extract one frame from each peer that has data
	const sources = [];
	for (const session of activeSessions) {
		sources.push(session.pcmBuffer.subarray(0, frameBytes));
		session.pcmBuffer = session.pcmBuffer.subarray(frameBytes);
	}

	let out;
	if (sources.length === 1) {
		// Single source — copy to avoid holding reference to large underlying buffer
		out = Buffer.from(sources[0]);
	} else {
		// Mix: additive with Int16 clamping
		out = Buffer.alloc(frameBytes);
		for (let i = 0; i < frameSamples; i++) {
			let sum = 0;
			for (const src of sources) {
				sum += src.readInt16LE(i * 2);
			}
			if (sum > 32767) sum = 32767;
			else if (sum < -32768) sum = -32768;
			out.writeInt16LE(sum, i * 2);
		}
	}

	let ok = true;
	try {
		ok = speakerProc.stdin.write(out);
	} catch (e) {
		console.warn('Mixer write error:', e?.message || e);
		ok = false;
	}
	if (!ok) {
		speakerBackpressure = true;
		speakerProc.stdin.once('drain', () => {
			speakerBackpressure = false;
			if (!isShuttingDown && !mixerPaused) tryFlushMix();
		});
	}
}

// ---- Per-peer connection management ----

function createPeerSession(remotePeerId) {
	// Clean up existing session for this peer if any
	if (peerSessions.has(remotePeerId)) {
		destroyPeerSession(remotePeerId, 'replaced by new offer');
	}

	const peerPc = new wrtc.RTCPeerConnection({
		iceServers: USE_STUN
			? [
					{ urls: ['stun:stun.l.google.com:19302'] },
					{ urls: ['stun:stun1.l.google.com:19302'] },
			  ]
			: [],
	});

	if (DISABLE_MIC) {
		peerPc.addTransceiver('audio', { direction: 'recvonly' });
	} else if (audioTrackOut) {
		peerPc.addTrack(audioTrackOut);
	} else {
		peerPc.addTransceiver('audio', { direction: 'sendrecv' });
	}

	const session = {
		pc: peerPc,
		sink: null,
		pendingIce: [],
		pcmBuffer: Buffer.alloc(0),
		lastDataTime: Date.now(),
		timeoutInterval: null,
	};

	// ICE state handlers
	peerPc.oniceconnectionstatechange = () => {
		if (!peerPc) return;
		console.log(`[${remotePeerId}] ICE state:`, peerPc.iceConnectionState);
		if (peerPc.iceConnectionState === 'failed') {
			console.log(`[${remotePeerId}] ICE connection failed, attempting restart...`);
			if (peerPc.restartIce) peerPc.restartIce();
		}
	};

	peerPc.onconnectionstatechange = () => {
		if (!peerPc) return;
		console.log(`[${remotePeerId}] PC state:`, peerPc.connectionState);
		if (peerPc.connectionState === 'disconnected' ||
			peerPc.connectionState === 'closed' ||
			peerPc.connectionState === 'failed') {
			setTimeout(() => {
				if (!isShuttingDown) {
					destroyPeerSession(remotePeerId, `pc state: ${peerPc.connectionState}`);
				}
			}, 500);
		}
	};

	// ICE candidate handler (non-trickle, but kept for future use)
	peerPc.onicecandidate = ({ candidate }) => {
		if (candidate && ws?.readyState === 1 && !isShuttingDown) {
			try {
				ws.send(JSON.stringify({ type: 'candidate', to: remotePeerId, candidate }));
			} catch (error) {
				console.error(`[${remotePeerId}] ICE candidate send error:`, error.message);
			}
		}
	};

	// Remote audio track -> per-peer PCM buffer
	peerPc.ontrack = (ev) => {
		const track = ev.track;
		if (track.kind !== 'audio') return;
		console.log(`[${remotePeerId}] Received remote audio track`);

		if (!speakerProc) startSpeaker();

		try {
			const peerSink = new wrtc.nonstandard.RTCAudioSink(track);
			session.sink = peerSink;

			peerSink.ondata = (data) => {
				if (isShuttingDown || mixerPaused) return;
				try {
					session.lastDataTime = Date.now();
					const chunk = Buffer.from(
						data.samples.buffer,
						data.samples.byteOffset,
						data.samples.byteLength
					);
					session.pcmBuffer = Buffer.concat([session.pcmBuffer, chunk]);

					// Prevent unbounded buffer growth (max ~500ms of audio)
					const maxBufferBytes = frameBytes * 50;
					if (session.pcmBuffer.length > maxBufferBytes) {
						session.pcmBuffer = session.pcmBuffer.subarray(
							session.pcmBuffer.length - maxBufferBytes
						);
					}

					// Flush immediately — no polling delay
					tryFlushMix();
				} catch (error) {
					console.error(`[${remotePeerId}] Audio data error:`, error.message);
				}
			};

			// Audio stall detection
			session.timeoutInterval = setInterval(() => {
				if (isShuttingDown) {
					clearInterval(session.timeoutInterval);
					return;
				}
				if (Date.now() - session.lastDataTime > 5000) {
					console.log(`[${remotePeerId}] Audio stream stalled`);
					clearInterval(session.timeoutInterval);
					session.timeoutInterval = null;
				}
			}, 2000);

			track.onended = () => {
				console.log(`[${remotePeerId}] Remote audio track ended`);
				destroyPeerSession(remotePeerId, 'track ended');
			};

			track.onmute = () => console.log(`[${remotePeerId}] Remote audio track muted`);
			track.onunmute = () => console.log(`[${remotePeerId}] Remote audio track unmuted`);
		} catch (error) {
			console.error(`[${remotePeerId}] Audio track setup error:`, error.message);
		}
	};

	peerSessions.set(remotePeerId, session);
	console.log(`[${remotePeerId}] Peer session created (total: ${peerSessions.size})`);
	return session;
}

function destroyPeerSession(remotePeerId, reason) {
	const session = peerSessions.get(remotePeerId);
	if (!session) return;

	console.log(`[${remotePeerId}] Destroying peer session:`, reason || 'unknown');

	if (session.timeoutInterval) {
		clearInterval(session.timeoutInterval);
		session.timeoutInterval = null;
	}

	if (session.sink) {
		try { session.sink.stop(); } catch {}
		session.sink = null;
	}

	if (session.pc) {
		try { session.pc.close(); } catch {}
		session.pc = null;
	}

	session.pcmBuffer = Buffer.alloc(0);
	peerSessions.delete(remotePeerId);
	console.log(`[${remotePeerId}] Peer session destroyed (remaining: ${peerSessions.size})`);
}

function destroyAllPeerSessions(reason) {
	for (const peerId of [...peerSessions.keys()]) {
		destroyPeerSession(peerId, reason);
	}
}

// ---- Microphone (Pi -> remote peers) ----

function startMicrophone() {
	try {
		if (DISABLE_MIC) {
			console.log('Microphone disabled by config; skipping capture startup');
			return;
		}
		if (!audioSource) {
			console.log('Audio source missing, creating a new instance...');
			audioSource = new wrtc.nonstandard.RTCAudioSource();
			audioTrackOut = audioSource.createTrack();
		}

		let micCmd, micArgs;

		if (USE_PULSEAUDIO) {
			micCmd = 'parec';
			micArgs = [
				'--raw',
				'--rate=' + SAMPLE_RATE,
				'--channels=' + CHANNELS,
				'--format=s16le',
				'--latency-msec=10',
			];
			if (PULSE_SOURCE) micArgs.push('--device=' + PULSE_SOURCE);
		} else {
			micCmd = 'arecord';
			micArgs = [
				'-f', 'S16_LE',
				'-r', SAMPLE_RATE.toString(),
				'-c', CHANNELS.toString(),
				'-D', ARECORD_DEV,
				'-t', 'raw',
				'--period-size=480',
				'--buffer-size=1920',
				'-',
			];
		}

		console.log(`Starting microphone capture (${USE_PULSEAUDIO ? 'PulseAudio' : 'ALSA'}):`, micCmd, micArgs.join(' '));
		arecord = spawn(micCmd, micArgs);

		let dataCounter = 0;
		arecord.stdout.on('data', (chunk) => {
			if (isShuttingDown || !audioSource) return;

			try {
				dataCounter++;
				if (dataCounter % 100 === 0) {
					console.log(`Microphone data received: ${chunk.length} bytes (chunk ${dataCounter})`);
				}

				const samples = new Int16Array(
					chunk.buffer, chunk.byteOffset, chunk.length / 2
				);
				const expectedFrames = Math.floor(SAMPLE_RATE * 0.01);

				for (let i = 0; i < samples.length; i += expectedFrames) {
					const frameSlice = samples.slice(i, Math.min(i + expectedFrames, samples.length));
					if (frameSlice.length === expectedFrames) {
						try {
							audioSource.onData({
								samples: frameSlice,
								sampleRate: SAMPLE_RATE,
								bitsPerSample: 16,
								channelCount: CHANNELS,
								numberOfFrames: frameSlice.length,
							});
						} catch (sourceError) {
							console.error('AudioSource.onData error:', sourceError.message);
						}
					}
				}
			} catch (error) {
				console.error('Microphone data handling error:', error.message);
			}
		});

		arecord.stderr.on('data', (d) => {
			const message = d.toString();
			if (!message.includes('arecord:')) {
				process.stderr.write(`[arecord] ${message}`);
			}
		});

		arecord.on('exit', (code, signal) => {
			console.log(`arecord exited: code=${code}, signal=${signal}`);
			if (!isShuttingDown && code !== 0 && code !== null) {
				console.log('Microphone process ended unexpectedly, restarting...');
				setTimeout(() => {
					if (!isShuttingDown) startMicrophone();
				}, 1000);
			}
		});

		arecord.on('error', (error) => {
			console.error('arecord error:', error.message);
			if (!isShuttingDown) {
				setTimeout(() => startMicrophone(), 2000);
			}
		});

		console.log('Microphone capture started');
	} catch (error) {
		console.error('Microphone start error:', error.message);
		if (!isShuttingDown) {
			setTimeout(() => startMicrophone(), 2000);
		}
	}
}

function stopMicrophone() {
	if (arecord) {
		try { arecord.kill('SIGTERM'); } catch {}
		arecord = null;
	}

	try {
		if (USE_PULSEAUDIO) {
			execSync('pkill -9 parec 2>/dev/null || true', { stdio: 'ignore' });
		} else {
			execSync('pkill -9 arecord 2>/dev/null || true', { stdio: 'ignore' });
		}
	} catch {}

	if (audioTrackOut) {
		try { audioTrackOut.stop(); } catch {}
		audioTrackOut = null;
	}
	audioSource = null;
}

// ---- Speaker (single shared process) ----
let speakerProc = null;
let effectQueue = [];
let isEffectPlaying = false;
let currentEffectProc = null;

function startSpeaker() {
	try {
		let cmd, args;

		if (USE_PULSEAUDIO) {
			cmd = 'paplay';
			args = [
				'--raw',
				'--rate=' + SAMPLE_RATE,
				'--channels=' + CHANNELS,
				'--format=s16le',
				'--latency-msec=20',
			];
			if (PULSE_SINK) args.push('--device=' + PULSE_SINK);
		} else {
			cmd = 'aplay';
			args = [
				'-f', 'S16_LE',
				'-r', SAMPLE_RATE.toString(),
				'-c', CHANNELS.toString(),
				'-t', 'raw',
				'-B', APLAY_BUFFER_US.toString(),
				'-F', APLAY_PERIOD_US.toString(),
				'-',
			];
			if (SPEAKER_DEV) args.push('-D', SPEAKER_DEV);
		}

		console.log(`Starting speaker playback (${USE_PULSEAUDIO ? 'PulseAudio' : 'ALSA'}):`, cmd, args.join(' '));
		speakerProc = spawn(cmd, args);

		if (speakerProc && speakerProc.stdin) {
			speakerProc.stdin.on('error', (err) => {
				if (err && err.code === 'EPIPE') {
					console.warn('Speaker stdin EPIPE detected; restarting speaker...');
					// Pause mixer to stop writes
					mixerPaused = true;

					if (currentEffectProc && currentEffectProc.stdout) {
						try { currentEffectProc.stdout.pause(); } catch {}
					}

					try { speakerProc.stdin.end(); } catch {}
					try { speakerProc.kill('SIGTERM'); } catch {}
					speakerProc = null;

					setTimeout(() => {
						if (isShuttingDown) return;
						startSpeaker();
						setTimeout(() => {
							if (isShuttingDown) return;
							if (currentEffectProc && currentEffectProc.stdout) {
								try { currentEffectProc.stdout.resume(); } catch {}
							} else {
								mixerPaused = false;
							}
						}, 80);
					}, 80);
					return;
				}
				console.error('speaker stdin error:', err?.message || err);
			});
		}

		speakerProc.stderr.on('data', (d) => {
			const message = d.toString();
			if (!message.includes('aplay:') && !message.includes('ALSA lib') && !message.includes('paplay:')) {
				process.stderr.write(`[speaker] ${message}`);
			}
		});

		speakerProc.on('exit', (code, signal) => {
			console.log(`Speaker process exited: code=${code}, signal=${signal}`);
			speakerProc = null;
			if (!isShuttingDown && code !== 0 && code !== null) {
				console.log('Speaker process ended unexpectedly, restarting...');
				setTimeout(() => {
					if (!isShuttingDown) startSpeaker();
				}, 1000);
			}
		});

		speakerProc.on('error', (error) => {
			console.error('Speaker error:', error.message);
			speakerProc = null;
			if (!isShuttingDown) {
				setTimeout(() => startSpeaker(), 2000);
			}
		});

		console.log('Speaker playback started');
	} catch (error) {
		console.error('Speaker start error:', error.message);
		speakerProc = null;
		if (!isShuttingDown) {
			setTimeout(() => startSpeaker(), 2000);
		}
	}
}

function stopSpeaker() {
	if (speakerProc) {
		try {
			if (speakerProc.stdin && !speakerProc.stdin.destroyed) {
				speakerProc.stdin.end();
			}
			speakerProc.kill('SIGTERM');
		} catch {}
		speakerProc = null;
	}

	try {
		if (USE_PULSEAUDIO) {
			execSync('pkill -9 paplay 2>/dev/null || true', { stdio: 'ignore' });
		} else {
			execSync('pkill -9 aplay 2>/dev/null || true', { stdio: 'ignore' });
		}
	} catch {}
}

// ---- Effect system ----

function pauseRemoteAudio() {
	mixerPaused = true;
}

function resumeRemoteAudio() {
	if (!speakerProc) startSpeaker();
	// Drain accumulated buffers from all peers during effect playback
	for (const session of peerSessions.values()) {
		session.pcmBuffer = Buffer.alloc(0);
	}
	setTimeout(() => {
		if (!isShuttingDown) mixerPaused = false;
	}, 30);
}

function enqueueEffect(filePath) {
	effectQueue.push(filePath);
	if (!isEffectPlaying) {
		processNextEffect();
	}
}

function processNextEffect() {
	if (isEffectPlaying) return;
	const next = effectQueue.shift();
	if (!next) return;

	isEffectPlaying = true;
	console.log('Effect playback starting:', next);

	pauseRemoteAudio();
	if (!speakerProc) startSpeaker();

	const ffArgs = [
		'-hide_banner', '-loglevel', 'error',
		'-i', next,
		'-f', 's16le', '-acodec', 'pcm_s16le',
		'-ac', CHANNELS.toString(),
		'-ar', SAMPLE_RATE.toString(),
		'pipe:1',
	];
	const fx = spawn('ffmpeg', ffArgs);
	currentEffectProc = fx;

	fx.stderr.on('data', (d) => {
		const message = d.toString();
		if (message.trim().length) process.stderr.write(`[ffmpeg-fx] ${message}`);
	});

	fx.stdout.on('data', (chunk) => {
		if (!speakerProc || speakerProc.killed || !speakerProc.stdin ||
			speakerProc.stdin.destroyed || speakerProc.stdin.writableEnded ||
			!speakerProc.stdin.writable) return;
		let ok = true;
		try {
			ok = speakerProc.stdin.write(chunk);
		} catch (e) {
			console.warn('Effect write error, pausing stream:', e?.message || e);
			ok = false;
		}
		if (!ok) {
			try { fx.stdout.pause(); } catch {}
			speakerProc.stdin.once('drain', () => {
				if (!isShuttingDown) {
					try { fx.stdout.resume(); } catch {}
				}
			});
		}
	});

	fx.on('close', (code, signal) => {
		console.log(`Effect stream closed: code=${code}, signal=${signal}`);
		isEffectPlaying = false;
		currentEffectProc = null;
		resumeRemoteAudio();
		setImmediate(processNextEffect);
	});

	fx.on('error', (error) => {
		console.error('Effect stream error:', error.message);
		isEffectPlaying = false;
		currentEffectProc = null;
		resumeRemoteAudio();
		setImmediate(processNextEffect);
	});
}

function stopCurrentEffect() {
	try {
		effectQueue.length = 0;
		if (currentEffectProc) {
			try { currentEffectProc.stdout?.removeAllListeners?.('data'); } catch {}
			try { currentEffectProc.kill('SIGTERM'); } catch {}
		}
	} catch (e) {
		console.error('stopCurrentEffect error:', e?.message || e);
	} finally {
		resumeRemoteAudio();
	}
}

// ---- Signaling (non-trickle) ----
let ws = null;
let reconnectTimeout = null;
let isConnected = false;

function waitIceComplete(peerPc) {
	if (peerPc.iceGatheringState === 'complete') return Promise.resolve();
	return new Promise((res) => {
		const timeout = setTimeout(() => {
			console.log('ICE gathering timed out, continuing without additional candidates...');
			res();
		}, 15000);

		const check = () => {
			if (peerPc.iceGatheringState === 'complete') {
				clearTimeout(timeout);
				peerPc.removeEventListener('icegatheringstatechange', check);
				res();
			}
		};
		peerPc.addEventListener('icegatheringstatechange', check);
	});
}

function connectSignaling() {
	if (isShuttingDown) return;

	try {
		const u = new URL(SIGNALING_URL);
		u.searchParams.set('id', PEER_ID);
		console.log('Connecting to signaling server:', u.toString());

		ws = new WebSocket(u);

		const connectionTimeout = setTimeout(() => {
			if (ws && ws.readyState === WebSocket.CONNECTING) {
				console.error('Signaling connection timed out');
				ws.terminate();
			}
		}, 10000);

		ws.on('open', () => {
			clearTimeout(connectionTimeout);
			console.log('Signaling connected. Pi is ready (answerer, multi-peer).');
			isConnected = true;

			if (reconnectTimeout) {
				clearTimeout(reconnectTimeout);
				reconnectTimeout = null;
			}
		});

		ws.on('error', (e) => {
			clearTimeout(connectionTimeout);
			console.error('WS error:', e.message);
			isConnected = false;
		});

		ws.on('close', (code, reason) => {
			clearTimeout(connectionTimeout);
			console.log(`Signaling closed (code: ${code}, reason: ${reason?.toString() || 'unknown'})`);
			isConnected = false;

			if (!isShuttingDown) {
				console.log(`Reconnecting in ${RECONNECT_DELAY}ms...`);
				reconnectTimeout = setTimeout(() => {
					if (!isShuttingDown) connectSignaling();
				}, RECONNECT_DELAY);
			}
		});

		ws.on('message', async (msgBuf) => {
			if (isShuttingDown) return;

			try {
				const data = JSON.parse(msgBuf.toString());

				if (data.type === 'system') {
					console.log('System message:', data.event, data.id || '');
					try {
						if (data.event === 'peer_disconnected' && data.id && peerSessions.has(data.id)) {
							destroyPeerSession(data.id, 'remote peer disconnected');
						}
					} catch (e) {
						console.error('System event handling error:', e.message);
					}
					return;
				}

				// Command handling
				if (data.type === 'command') {
					try {
						const cmd = (data.command || data.cmd || '').toString();
						switch (cmd) {
							case 'play_door_close':
							case 'door_close':
							case 'playDoorClose':
								enqueueEffect(DOOR_CLOSE_WAV);
								break;
							case 'play_door_open':
							case 'door_open':
							case 'playDoorOpen':
								enqueueEffect(DOOR_OPEN_WAV);
								break;
							case 'stop_effect':
							case 'stopEffect':
							case 'stop':
								stopCurrentEffect();
								break;
							case 'start_session':
							case 'startSession':
								enqueueEffect(START_SESSION_WAV);
								break;
							case 'end_session':
							case 'endSession':
								enqueueEffect(END_SESSION_WAV);
								break;
							case 'takeoff_mask':
							case 'takeOffMask':
								enqueueEffect(TAKEOFF_MASK_WAV);
								break;
							case 'puton_mask':
							case 'putOnMask':
								enqueueEffect(PUTON_MASK_WAV);
								break;
							case 'deco_start':
							case 'decoStart':
								enqueueEffect(DECO_START_WAV);
								break;
							default:
								console.log('Unknown command:', cmd);
						}
					} catch (e) {
						console.error('Command handling error:', e.message);
					}
					return;
				}

				if (data.type === 'offer' && data.sdp) {
					const remotePeerId = data.from;
					console.log('Offer received, from:', remotePeerId);

					const session = createPeerSession(remotePeerId);
					const peerPc = session.pc;

					// Ensure mic track is available for sendrecv
					if (!DISABLE_MIC && !audioTrackOut) {
						startMicrophone();
					}

					await peerPc.setRemoteDescription(
						new wrtc.RTCSessionDescription(data.sdp)
					);

					// Add any pending ICE candidates
					if (session.pendingIce.length > 0) {
						console.log(`[${remotePeerId}] Adding ${session.pendingIce.length} pending ICE candidates...`);
						for (const candidate of session.pendingIce) {
							try {
								await peerPc.addIceCandidate(new wrtc.RTCIceCandidate(candidate));
							} catch (e) {
								console.error(`[${remotePeerId}] Pending ICE candidate error:`, e.message);
							}
						}
						session.pendingIce = [];
					}

					const answer = await peerPc.createAnswer();
					await peerPc.setLocalDescription(answer);

					await waitIceComplete(peerPc);

					console.log('Sending answer to', remotePeerId);
					ws.send(JSON.stringify({
						type: 'answer',
						to: remotePeerId,
						sdp: peerPc.localDescription,
					}));
					return;
				}

				if (data.type === 'candidate' && data.candidate) {
					const fromPeer = data.from;
					const session = peerSessions.get(fromPeer);
					if (!session) return;

					if (session.pc && session.pc.remoteDescription) {
						await session.pc.addIceCandidate(new wrtc.RTCIceCandidate(data.candidate));
					} else {
						console.log(`[${fromPeer}] Caching ICE candidate until remote description is applied`);
						session.pendingIce.push(data.candidate);
					}
					return;
				}
			} catch (e) {
				console.error('Signaling message error:', e.message);
			}
		});
	} catch (error) {
		console.error('Signaling connection setup error:', error.message);
		if (!isShuttingDown) {
			reconnectTimeout = setTimeout(() => {
				if (!isShuttingDown) connectSignaling();
			}, RECONNECT_DELAY);
		}
	}
}

// ---- Graceful shutdown ----
function gracefulShutdown() {
	console.log('Starting graceful shutdown...');
	isShuttingDown = true;

	if (reconnectTimeout) {
		clearTimeout(reconnectTimeout);
		reconnectTimeout = null;
	}

	stopMicrophone();
	destroyAllPeerSessions('shutdown');
	stopSpeaker();

	if (ws) {
		try { ws.close(1000, 'Shutdown'); } catch {}
		ws = null;
	}

	console.log('Shutdown tamamlandi');
	process.exit(0);
}

process.on('SIGINT', gracefulShutdown);
process.on('SIGTERM', gracefulShutdown);
process.on('SIGHUP', gracefulShutdown);

process.on('uncaughtException', (error) => {
	try {
		if (error && (error.code === 'EPIPE' || /EPIPE/.test(String(error)))) {
			console.warn('Unhandled EPIPE detected; restarting speaker...');
			stopSpeaker();
			setTimeout(() => {
				if (!isShuttingDown) startSpeaker();
			}, 100);
			return;
		}
	} catch {}
	console.error('Unhandled error:', error);
	gracefulShutdown();
});

process.on('unhandledRejection', (reason, promise) => {
	console.error('Promise rejection not handled:', reason);
	console.error('Promise:', promise);
});

// ---- Start ----
console.log('Application starting...');

if (!DISABLE_MIC) {
	console.log('Audio source hazirlaniyor...');
	audioSource = new wrtc.nonstandard.RTCAudioSource();
	audioTrackOut = audioSource.createTrack();
	console.log('Audio track created:', {
		trackId: audioTrackOut.id,
		trackKind: audioTrackOut.kind,
		trackEnabled: audioTrackOut.enabled,
	});
	startMicrophone();
} else {
	console.log('Playback-only startup: microphone initialization skipped');
}

connectSignaling();
