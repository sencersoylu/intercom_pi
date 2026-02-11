// pi-webrtc-audio.js (Answerer - Raspberry Pi)
// Non-trickle ICE: offer/answer sending after collecting all ICE candidates.
// In signaling 'offer.from' -> remotePeerId; answer/candidate messages sent with 'to: remotePeerId'.
// Remote audio RTCAudioSink -> aplay (buffer/offset corrections). Local mic arecord -> RTCAudioSource.

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
const USE_STUN = parseInt(process.env.USE_STUN || '0'); // Default 0 for LAN testing
const SAMPLE_RATE = parseInt(process.env.SAMPLE_RATE || '48000');
const CHANNELS = parseInt(process.env.CHANNELS || '1');
const RECONNECT_DELAY = parseInt(process.env.RECONNECT_DELAY || '1500');
const DISABLE_MIC = parseInt(process.env.DISABLE_MIC || '1');
const IDLE_RESET_MS = parseInt(process.env.IDLE_RESET_MS || '120000');
// PulseAudio mode (recommended) - prevents "Device busy" errors
const USE_PULSEAUDIO = parseInt(process.env.USE_PULSEAUDIO || '1');
// Low-latency playback controls (in microseconds / milliseconds) - only for ALSA mode
const APLAY_BUFFER_US = parseInt(process.env.APLAY_BUFFER_US || '40000'); // 40ms (reduced for lower latency)
const APLAY_PERIOD_US = parseInt(process.env.APLAY_PERIOD_US || '10000'); // 10ms
const SINK_FRAME_MS = parseInt(process.env.SINK_FRAME_MS || '10'); // 10ms frames to minimize extra delay
// PulseAudio device names (use 'pactl list sinks/sources' to find)
const PULSE_SINK = process.env.PULSE_SINK || ''; // empty = default sink
const PULSE_SOURCE = process.env.PULSE_SOURCE || ''; // empty = default source
// ==========================

// Effect file paths
const DOOR_CLOSE_WAV = path.join(__dirname, 'door_close.wav');
const DOOR_OPEN_WAV = path.join(__dirname, 'door_open.wav');
const START_SESSION_WAV = path.join(__dirname, 'start_session.wav');
const TAKEOFF_MASK_WAV = path.join(__dirname, 'takeoff_mask.wav');
const PUTON_MASK_WAV = path.join(__dirname, 'puton_mask.wav');

const END_SESSION_WAV = path.join(__dirname, 'end_session.wav');
const DECO_START_WAV = path.join(__dirname, 'deco_start.wav');

console.log('Starting Pi WebRTC audio bridge...');
console.log('Signaling URL:', SIGNALING_URL);
console.log('Peer ID:', PEER_ID);
console.log('Microphone device:', ARECORD_DEV);
console.log('Speaker device:', SPEAKER_DEV);
console.log('Sample rate:', SAMPLE_RATE);
console.log('Channels:', CHANNELS);
console.log('Mic disabled mode:', !!DISABLE_MIC);

let pc = null;
let audioSource = null;
let audioTrackOut = null;
let arecord = null;
let isShuttingDown = false;
let lastResetTime = 0;
let idleResetTimeout = null;

function resetService(reason) {
	try {
		const now = Date.now();
		if (now - lastResetTime < 1000) return; // debounce rapid resets
		lastResetTime = now;
		console.log('Resetting service due to:', reason || 'unknown');

		// Stop I/O pipelines
		restartAudioProcesses();

		// Reset peer connection state
		if (pc) {
			try {
				pc.close();
			} catch (error) {
				console.error('PC close error during reset:', error.message);
			}
			pc = null;
		}

		// Clear remote peer context and pending ICE
		remotePeerId = null;
		if (global.pendingIceCandidates) global.pendingIceCandidates.length = 0;

		// We remain connected to signaling and wait for the next offer
		console.log('Service reset complete. Waiting for new offer...');

		// After resetting, schedule idle reset in case no one connects
		scheduleIdleReset();
	} catch (error) {
		console.error('Reset service error:', error.message);
	}
}

function cancelIdleReset() {
	if (idleResetTimeout) {
		clearTimeout(idleResetTimeout);
		idleResetTimeout = null;
	}
}

function scheduleIdleReset() {
	cancelIdleReset();
	idleResetTimeout = setTimeout(() => {
		if (isShuttingDown) return;
		// If no active remote peer is set, consider this idle and reset
		if (!remotePeerId) {
			resetService('idle timeout without connections');
		}
	}, IDLE_RESET_MS);
}

function createPeerConnection() {
	pc = new wrtc.RTCPeerConnection({
		iceServers: USE_STUN
			? [
					{ urls: ['stun:stun.l.google.com:19302'] },
					{ urls: ['stun:stun1.l.google.com:19302'] },
			  ]
			: [],
	});

	// Configure audio direction based on mic setting
	if (DISABLE_MIC) {
		console.log('Playback-only mode: adding recvonly audio transceiver...');
		pc.addTransceiver('audio', { direction: 'recvonly' });
	} else if (audioTrackOut) {
		console.log(
			'Existing audio track detected, attaching to peer connection...'
		);
		pc.addTrack(audioTrackOut);
	} else {
		console.log('Adding bidirectional audio transceiver...');
		pc.addTransceiver('audio', { direction: 'sendrecv' });
	}

	pc.oniceconnectionstatechange = () => {
		if (!pc) return;
		console.log('ICE state:', pc.iceConnectionState);
		if (pc.iceConnectionState === 'failed') {
			console.log('ICE connection failed, attempting restart...');
			if (pc && pc.restartIce) {
				pc.restartIce();
			}
		}
	};

	pc.onconnectionstatechange = () => {
		if (!pc) return;
		console.log('PC state:', pc.connectionState);
		if (pc.connectionState === 'failed') {
			console.error('Peer connection failed');
			setTimeout(() => {
				if (!isShuttingDown) {
					restartAudioProcesses();
				}
			}, 2000);
		}

		// Reset service when peer disconnects or the connection fully closes
		if (
			pc &&
			(pc.connectionState === 'disconnected' ||
				pc.connectionState === 'closed')
		) {
			const state = pc.connectionState;
			setTimeout(() => {
				if (!isShuttingDown) {
					resetService(`pc state: ${state}`);
				}
			}, 500);
		}
	};

	return pc;
}

function startMicrophone() {
	try {
		if (DISABLE_MIC) {
			console.log('Microphone disabled by config; skipping capture startup');
			return;
		}
		// If the audio source is missing, rebuild it before starting arecord
		if (!audioSource) {
			console.log('Audio source missing, creating a new instance...');
			audioSource = new wrtc.nonstandard.RTCAudioSource();
			audioTrackOut = audioSource.createTrack();
		}

		if (pc && audioTrackOut) {
			// Check if track already exists to prevent duplicate sender error
			const existingSender = pc
				.getSenders()
				.find((s) => s.track && s.track.id === audioTrackOut.id);
			if (existingSender) {
				console.log('Audio track already attached, skipping addTrack');
			} else {
				const sender = pc.addTrack(audioTrackOut);
				console.log("Audio track WebRTC'ye eklendi:", {
					trackId: audioTrackOut.id,
					trackKind: audioTrackOut.kind,
					trackEnabled: audioTrackOut.enabled,
					senderId: sender ? 'OK' : 'FAILED',
				});
			}
		}

		let micCmd, micArgs;

		if (USE_PULSEAUDIO) {
			// PulseAudio mode - uses parec (no device conflicts)
			micCmd = 'parec';
			micArgs = [
				'--raw',
				'--rate=' + SAMPLE_RATE,
				'--channels=' + CHANNELS,
				'--format=s16le',
				'--latency-msec=20',
			];
			if (PULSE_SOURCE) micArgs.push('--device=' + PULSE_SOURCE);
		} else {
			// ALSA mode - uses arecord (legacy)
			micCmd = 'arecord';
			micArgs = [
				'-f',
				'S16_LE',
				'-r',
				SAMPLE_RATE.toString(),
				'-c',
				CHANNELS.toString(),
				'-D',
				ARECORD_DEV,
				'-t',
				'raw',
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
					console.log(
						`Microphone data received: ${chunk.length} bytes (chunk ${dataCounter})`
					);
				}

				const samples = new Int16Array(
					chunk.buffer,
					chunk.byteOffset,
					chunk.length / 2
				);

				// WebRTC expects 480 samples for 10ms at 48kHz
				const expectedFrames = Math.floor(SAMPLE_RATE * 0.01); // 10ms chunks = 480 samples

				// Always split into proper chunk sizes
				for (let i = 0; i < samples.length; i += expectedFrames) {
					const frameSlice = samples.slice(
						i,
						Math.min(i + expectedFrames, samples.length)
					);

					// Only send if we have the exact expected frame size
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
					if (!isShuttingDown) {
						startMicrophone();
					}
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

function restartAudioProcesses() {
	console.log('Restarting audio pipelines...');
	stopMicrophone();
	stopSpeaker();
	setTimeout(() => {
		if (!isShuttingDown) {
			if (!DISABLE_MIC) startMicrophone();
		}
	}, 1000);
}

function stopMicrophone() {
	if (arecord) {
		try {
			arecord.kill('SIGTERM');
		} catch (error) {
			console.error('Microphone stop error:', error.message);
		}
		arecord = null;
	}

	// Kill any orphan microphone processes
	try {
		if (USE_PULSEAUDIO) {
			execSync('pkill -9 parec 2>/dev/null || true', { stdio: 'ignore' });
		} else {
			execSync('pkill -9 arecord 2>/dev/null || true', { stdio: 'ignore' });
		}
	} catch {
		// Ignore errors
	}

	if (audioTrackOut) {
		try {
			audioTrackOut.stop();
		} catch (error) {
			console.error('Audio track stop error:', error.message);
		}
		audioTrackOut = null;
	}

	audioSource = null;
}

// ---- Uzak ses -> speaker (PulseAudio or ALSA) ----
let speakerProc = null;
let sink = null;
let effectQueue = [];
let isEffectPlaying = false;
let sinkOnDataRef = null; // holds the active ondata callback when attached
let currentEffectProc = null; // active ffmpeg process for the effect

function startSpeaker() {
	try {
		let cmd, args;

		if (USE_PULSEAUDIO) {
			// PulseAudio mode - uses paplay (no device conflicts)
			cmd = 'paplay';
			args = [
				'--raw',
				'--rate=' + SAMPLE_RATE,
				'--channels=' + CHANNELS,
				'--format=s16le',
				'--latency-msec=40',
			];
			if (PULSE_SINK) args.push('--device=' + PULSE_SINK);
		} else {
			// ALSA mode - uses aplay (legacy)
			cmd = 'aplay';
			args = [
				'-f',
				'S16_LE',
				'-r',
				SAMPLE_RATE.toString(),
				'-c',
				CHANNELS.toString(),
				'-t',
				'raw',
				'-B',
				APLAY_BUFFER_US.toString(),
				'-F',
				APLAY_PERIOD_US.toString(),
				'-',
			];
			if (SPEAKER_DEV) args.push('-D', SPEAKER_DEV);
		}

		console.log(`Starting speaker playback (${USE_PULSEAUDIO ? 'PulseAudio' : 'ALSA'}):`, cmd, args.join(' '));
		speakerProc = spawn(cmd, args);

		// Handle stdin EPIPE to avoid crashing when aplay closes unexpectedly
		if (speakerProc && speakerProc.stdin) {
			speakerProc.stdin.on('error', (err) => {
				if (err && err.code === 'EPIPE') {
					console.warn(
						'Speaker stdin EPIPE detected; restarting aplay and resuming streams...'
					);
					// Detach remote audio writes immediately
					if (sink) {
						try {
							sink.ondata = null;
						} catch {}
					}
					// Pause active effect stream if any
					if (currentEffectProc && currentEffectProc.stdout) {
						try {
							currentEffectProc.stdout.pause();
						} catch {}
					}

					// Close and kill current aplay
					try {
						speakerProc.stdin.end();
					} catch {}
					try {
						speakerProc.kill('SIGTERM');
					} catch {}
					speakerProc = null;

					// Restart aplay; then resume whichever stream is active
					setTimeout(() => {
						if (isShuttingDown) return;
						startSpeaker();
						setTimeout(() => {
							if (isShuttingDown) return;
							if (currentEffectProc && currentEffectProc.stdout) {
								try {
									currentEffectProc.stdout.resume();
								} catch {}
							} else if (sink && sinkOnDataRef) {
								sink.ondata = sinkOnDataRef;
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
					if (!isShuttingDown) {
						startSpeaker();
					}
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
	if (sink) {
		try {
			sink.stop();
		} catch (error) {
			console.error('Audio sink stop error:', error.message);
		}
		sink = null;
	}

	if (speakerProc) {
		try {
			if (speakerProc.stdin && !speakerProc.stdin.destroyed) {
				speakerProc.stdin.end();
			}
			speakerProc.kill('SIGTERM');
		} catch (error) {
			console.error('Speaker stop error:', error.message);
		}
		speakerProc = null;
	}

	// Kill any orphan audio processes to prevent "Device or resource busy" error
	try {
		if (USE_PULSEAUDIO) {
			execSync('pkill -9 paplay 2>/dev/null || true', { stdio: 'ignore' });
		} else {
			execSync('pkill -9 aplay 2>/dev/null || true', { stdio: 'ignore' });
		}
	} catch {
		// Ignore errors - process might not exist
	}
}

function pauseRemoteAudio() {
	// Detach ondata to prevent writes while effect audio is injected
	if (sink && sinkOnDataRef) {
		try {
			sink.ondata = null;
		} catch {}
	}
}

function resumeRemoteAudio() {
	// Restart aplay consumer; sink.ondata will continue writing once stdin is writable
	if (!speakerProc) {
		startSpeaker();
	}
	// Reattach ondata after a tiny delay to ensure stdin is ready
	if (sink && sinkOnDataRef) {
		setTimeout(() => {
			if (sink && !isShuttingDown) sink.ondata = sinkOnDataRef;
		}, 30);
	}
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

	// Pause remote audio writes and keep aplay alive
	pauseRemoteAudio();
	if (!speakerProc) startSpeaker();

	// Decode WAV -> raw PCM and stream into aplay stdin to avoid reopening device
	const ffArgs = [
		'-hide_banner',
		'-loglevel',
		'error',
		'-i',
		next,
		'-f',
		's16le',
		'-acodec',
		'pcm_s16le',
		'-ac',
		CHANNELS.toString(),
		'-ar',
		SAMPLE_RATE.toString(),
		'pipe:1',
	];
	const fx = spawn('ffmpeg', ffArgs);
	currentEffectProc = fx;

	fx.stderr.on('data', (d) => {
		const message = d.toString();
		if (message.trim().length) process.stderr.write(`[ffmpeg-fx] ${message}`);
	});

	// Pipe with backpressure handling
	fx.stdout.on('data', (chunk) => {
		if (
			!speakerProc ||
			speakerProc.killed ||
			!speakerProc.stdin ||
			speakerProc.stdin.destroyed ||
			speakerProc.stdin.writableEnded ||
			!speakerProc.stdin.writable
		)
			return;
		let ok = true;
		try {
			ok = speakerProc.stdin.write(chunk);
		} catch (e) {
			console.warn('Effect write error, pausing stream:', e?.message || e);
			ok = false;
		}
		if (!ok) {
			try {
				fx.stdout.pause();
			} catch {}
			speakerProc.stdin.once('drain', () => {
				if (!isShuttingDown) {
					try {
						fx.stdout.resume();
					} catch {}
				}
			});
		}
	});

	fx.on('close', (code, signal) => {
		console.log(`Effect stream closed: code=${code}, signal=${signal}`);
		isEffectPlaying = false;
		currentEffectProc = null;
		// Resume remote audio pipeline (reattach sink writes)
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
	// Stop active effect and clear queue
	try {
		effectQueue.length = 0;
		if (currentEffectProc) {
			try {
				currentEffectProc.stdout?.removeAllListeners?.('data');
			} catch {}
			try {
				currentEffectProc.kill('SIGTERM');
			} catch {}
		}
	} catch (e) {
		console.error('stopCurrentEffect error:', e?.message || e);
	} finally {
		// Reattach remote audio as soon as possible; close handler also resumes
		resumeRemoteAudio();
	}
}

function setupRemoteAudioTrack() {
	if (!pc) return;

	pc.ontrack = (ev) => {
		const track = ev.track;
		if (track.kind !== 'audio') return;
		console.log('Received remote audio track');

		if (!speakerProc) startSpeaker();

		try {
			sink = new wrtc.nonstandard.RTCAudioSink(track);

			const frameBytes =
				Math.floor(SAMPLE_RATE * (SINK_FRAME_MS / 1000)) * CHANNELS * 2; // e.g., 10ms at 48k = 480 samples
			let pending = Buffer.alloc(0);
			let lastDataTime = Date.now();

			function onData(data) {
				if (
					isShuttingDown ||
					!speakerProc ||
					speakerProc.killed ||
					!speakerProc.stdin ||
					speakerProc.stdin.destroyed ||
					speakerProc.stdin.writableEnded ||
					!speakerProc.stdin.writable
				)
					return;

				try {
					lastDataTime = Date.now();
					const chunk = Buffer.from(
						data.samples.buffer,
						data.samples.byteOffset,
						data.samples.byteLength
					);
					pending = Buffer.concat([pending, chunk]);

					while (pending.length >= frameBytes) {
						const out = pending.subarray(0, frameBytes);
						let ok = true;
						try {
							ok = speakerProc.stdin.write(out);
						} catch (e) {
							// Likely EPIPE if aplay died; detach and wait for resume
							console.warn(
								'Speaker stdin write error, detaching ondata:',
								e?.message || e
							);
							if (sink) sink.ondata = null;
							ok = false;
						}
						pending = pending.subarray(frameBytes);
						if (!ok) {
							if (sink) sink.ondata = null;
							speakerProc.stdin.once('drain', () => {
								if (sink && !isShuttingDown) sink.ondata = onData;
							});
							break;
						}
					}
				} catch (error) {
					console.error('Audio data processing error:', error.message);
				}
			}

			sink.ondata = onData;
			sinkOnDataRef = onData;

			// Audio data timeout kontrolu
			const checkAudioTimeout = setInterval(() => {
				if (isShuttingDown) {
					clearInterval(checkAudioTimeout);
					return;
				}

				if (Date.now() - lastDataTime > 5000) {
					// Five seconds of silence observed
					console.log('Audio stream stalled, checking connection status...');
					clearInterval(checkAudioTimeout);
				}
			}, 2000);

			track.onended = () => {
				console.log('Remote audio track ended');
				clearInterval(checkAudioTimeout);

				try {
					if (sink) {
						sink.stop();
						sink = null;
					}
				} catch (error) {
					console.error('Sink durdurma error:', error.message);
				}

				stopSpeaker();
			};

			track.onmute = () => {
				console.log('Remote audio track muted');
			};

			track.onunmute = () => {
				console.log('Remote audio track unmuted');
			};
		} catch (error) {
			console.error('Remote audio track kurulum error:', error.message);
		}
	};
}

// ---- Signaling (non-trickle) ----
let ws = null;
let remotePeerId = null;
let reconnectTimeout = null;
let isConnected = false;

function waitIceComplete(pc) {
	if (pc.iceGatheringState === 'complete') return Promise.resolve();
	return new Promise((res) => {
		const timeout = setTimeout(() => {
			console.log(
				'ICE gathering timed out, continuing without additional candidates...'
			);
			res();
		}, 15000); // 15 saniye timeout

		const check = () => {
			if (pc.iceGatheringState === 'complete') {
				clearTimeout(timeout);
				pc.removeEventListener('icegatheringstatechange', check);
				res();
			}
		};
		pc.addEventListener('icegatheringstatechange', check);
	});
}

function setupIceCandidateHandler() {
	if (!pc) return;

	pc.onicecandidate = ({ candidate }) => {
		// Non-trickle moddayiz; yine de ileride gerekirse dursun
		if (candidate && ws?.readyState === 1 && remotePeerId && !isShuttingDown) {
			try {
				ws.send(
					JSON.stringify({ type: 'candidate', to: remotePeerId, candidate })
				);
			} catch (error) {
				console.error('ICE candidate sendme error:', error.message);
			}
		}
	};
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
			console.log('Signaling connected. Pi is ready (answerer).');
			isConnected = true;

			// Start idle reset countdown when signaling is ready
			scheduleIdleReset();

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
			console.log(
				`Signaling closed (code: ${code}, reason: ${
					reason?.toString() || 'unknown'
				})`
			);
			isConnected = false;

			// Cancel idle reset when signaling is down; it will reschedule on reconnect
			cancelIdleReset();

			if (!isShuttingDown) {
				console.log(`Reconnecting in ${RECONNECT_DELAY}ms...`);
				reconnectTimeout = setTimeout(() => {
					if (!isShuttingDown) {
						connectSignaling();
					}
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
						if (
							data.event === 'peer_disconnected' &&
							remotePeerId &&
							data.id === remotePeerId
						) {
							resetService('remote peer disconnected');
							// No active peer anymore; schedule idle reset in case future offers don't arrive
							scheduleIdleReset();
						}
						if (
							data.event === 'peer_unavailable' &&
							remotePeerId &&
							(data.to === remotePeerId || data.to === PEER_ID)
						) {
							resetService('remote peer unavailable');
							scheduleIdleReset();
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
							case 'playDoorClose': {
								enqueueEffect(DOOR_CLOSE_WAV);
								break;
							}
							case 'play_door_open':
							case 'door_open':
							case 'playDoorOpen': {
								enqueueEffect(DOOR_OPEN_WAV);
								break;
							}
							case 'stop_effect':
							case 'stopEffect':
							case 'stop': {
								stopCurrentEffect();
								break;
							}
							case 'start_session':
							case 'startSession': {
								enqueueEffect(START_SESSION_WAV);
								break;
							}
							case 'end_session':
							case 'endSession': {
								enqueueEffect(END_SESSION_WAV);
								break;
							}
							case 'takeoff_mask':
							case 'takeOffMask': {
								enqueueEffect(TAKEOFF_MASK_WAV);
								break;
							}
							case 'puton_mask':
							case 'putOnMask': {
								enqueueEffect(PUTON_MASK_WAV);
								break;
							}
							case 'deco_start':
							case 'decoStart': {
								enqueueEffect(DECO_START_WAV);
								break;
							}
							default: {
								console.log('Unknown command:', cmd);
							}
						}
					} catch (e) {
						console.error('Command handling error:', e.message);
					}
					return;
				}

				if (data.type === 'offer' && data.sdp) {
					remotePeerId = data.from; // Remember the target peer for responses
					console.log('Offer received, from:', remotePeerId);

					// Cancel idle reset because we have an incoming connection
					cancelIdleReset();

					if (!pc) {
						pc = createPeerConnection();
						setupIceCandidateHandler();
						setupRemoteAudioTrack();
					}

					// Ensure an outgoing audio track exists before handling the offer
					if (!DISABLE_MIC && !audioTrackOut) {
						startMicrophone();
					}

					await pc.setRemoteDescription(
						new wrtc.RTCSessionDescription(data.sdp)
					);

					// Add any pending ICE candidates
					if (
						global.pendingIceCandidates &&
						global.pendingIceCandidates.length > 0
					) {
						console.log(
							`Adding ${global.pendingIceCandidates.length} pending ICE candidates...`
						);
						for (const candidate of global.pendingIceCandidates) {
							try {
								await pc.addIceCandidate(new wrtc.RTCIceCandidate(candidate));
							} catch (e) {
								console.error(
									'Pending ICE candidate addition error:',
									e.message
								);
							}
						}
						global.pendingIceCandidates = [];
					}

					const answer = await pc.createAnswer();
					await pc.setLocalDescription(answer);

					// Non-trickle: tum ICE candidates topla, sonra send
					await waitIceComplete(pc);

					console.log('Sending answer to', remotePeerId);
					ws.send(
						JSON.stringify({
							type: 'answer',
							to: remotePeerId,
							sdp: pc.localDescription,
						})
					);
					return;
				}

				if (data.type === 'candidate' && data.candidate && pc) {
					if (pc.remoteDescription) {
						await pc.addIceCandidate(new wrtc.RTCIceCandidate(data.candidate));
					} else {
						console.log(
							'Caching ICE candidate until remote description is applied'
						);
						// Store candidates to add later
						if (!global.pendingIceCandidates) global.pendingIceCandidates = [];
						global.pendingIceCandidates.push(data.candidate);
					}
					return;
				}
			} catch (e) {
				console.error('Sinyalleme mesaj error:', e.message);
			}
		});
	} catch (error) {
		console.error('Signaling connection setup error:', error.message);
		if (!isShuttingDown) {
			reconnectTimeout = setTimeout(() => {
				if (!isShuttingDown) {
					connectSignaling();
				}
			}, RECONNECT_DELAY);
		}
	}
}

// Graceful shutdown handling
function gracefulShutdown() {
	console.log('Starting graceful shutdown...');
	isShuttingDown = true;

	if (reconnectTimeout) {
		clearTimeout(reconnectTimeout);
		reconnectTimeout = null;
	}

	stopMicrophone();
	stopSpeaker();

	// Clear pending ICE candidates
	if (global.pendingIceCandidates) {
		global.pendingIceCandidates = [];
	}

	if (pc) {
		try {
			pc.close();
		} catch (error) {
			console.error('PC kapatma error:', error.message);
		}
		pc = null;
	}

	if (ws) {
		try {
			ws.close(1000, 'Shutdown');
		} catch (error) {
			console.error('WS kapatma error:', error.message);
		}
		ws = null;
	}

	console.log('Shutdown tamamlandi');
	process.exit(0);
}

// Signal handlers
process.on('SIGINT', gracefulShutdown);
process.on('SIGTERM', gracefulShutdown);
process.on('SIGHUP', gracefulShutdown);

// Uncaught exception handler
process.on('uncaughtException', (error) => {
	try {
		// Ignore and recover from EPIPE writes (typically aplay stdin closed)
		if (error && (error.code === 'EPIPE' || /EPIPE/.test(String(error)))) {
			console.warn('Unhandled EPIPE detected; restarting audio pipelines...');
			// Do not exit; restart audio stack instead
			restartAudioProcesses();
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

// Start the application
console.log('Application starting...');

// Audio source'u onceden hazirla (yalnizca mic aktifse)
if (!DISABLE_MIC) {
	console.log('Audio source hazirlaniyor...');
	audioSource = new wrtc.nonstandard.RTCAudioSource();
	audioTrackOut = audioSource.createTrack();
	console.log('Audio track created:', {
		trackId: audioTrackOut.id,
		trackKind: audioTrackOut.kind,
		trackEnabled: audioTrackOut.enabled,
	});

	// Kick off microphone streaming
	startMicrophone();
} else {
	console.log('Playback-only startup: microphone initialization skipped');
}

connectSignaling();
