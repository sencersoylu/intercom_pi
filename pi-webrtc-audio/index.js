// pi-webrtc-audio.js (Answerer - Raspberry Pi)
// Non-trickle ICE: offer/answer sending after collecting all ICE candidates.
// In signaling 'offer.from' -> remotePeerId; answer/candidate messages sent with 'to: remotePeerId'.
// Remote audio RTCAudioSink -> aplay (buffer/offset corrections). Local mic arecord -> RTCAudioSource.

const wrtc = require('wrtc');
const WebSocket = require('ws');
const { spawn } = require('child_process');

// ====== ENV / CONFIG ======
const SIGNALING_URL = process.env.SIGNALING_URL || 'ws://192.168.1.20:8080/ws';
const PEER_ID = process.env.PEER_ID || 'raspi-1';
const ARECORD_DEV = process.env.ARECORD_DEV || 'plughw:2,0';
const SPEAKER_DEV = process.env.SPEAKER_DEV || 'plughw:2,0';
const USE_STUN = parseInt(process.env.USE_STUN || '0'); // Default 0 for LAN testing
const SAMPLE_RATE = parseInt(process.env.SAMPLE_RATE || '48000');
const CHANNELS = parseInt(process.env.CHANNELS || '1');
const RECONNECT_DELAY = parseInt(process.env.RECONNECT_DELAY || '1500');
// ==========================

console.log('Pi WebRTC Audio baslatiliyor...');
console.log('Signaling URL:', SIGNALING_URL);
console.log('Peer ID:', PEER_ID);
console.log('Microphone device:', ARECORD_DEV);
console.log('Speaker device:', SPEAKER_DEV);
console.log('Sample rate:', SAMPLE_RATE);
console.log('Channels:', CHANNELS);

let pc = null;
let audioSource = null;
let audioTrackOut = null;
let arecord = null;
let isShuttingDown = false;

function createPeerConnection() {
	pc = new wrtc.RTCPeerConnection({
		iceServers: USE_STUN
			? [
					{ urls: ['stun:stun.l.google.com:19302'] },
					{ urls: ['stun:stun1.l.google.com:19302'] },
			  ]
			: [],
	});

	// Audio track varsa direkt ekle, yoksa transceiver ekle
	if (audioTrackOut) {
		console.log("Existing audio track PC'ye adding...");
		pc.addTrack(audioTrackOut);
	} else {
		console.log('Audio transceiver adding...');
		pc.addTransceiver('audio', { direction: 'sendrecv' });
	}

	pc.oniceconnectionstatechange = () => {
		console.log('ICE state:', pc.iceConnectionState);
		if (pc.iceConnectionState === 'failed') {
			console.log('ICE baglantisi basarisiz, yeniden baslatiliyor...');
			if (pc.restartIce) {
				pc.restartIce();
			}
		}
	};

	pc.onconnectionstatechange = () => {
		console.log('PC state:', pc.connectionState);
		if (pc.connectionState === 'failed') {
			console.error('Peer baglantisi basarisiz oldu');
			setTimeout(() => {
				if (!isShuttingDown) {
					restartAudioProcesses();
				}
			}, 2000);
		}
	};

	return pc;
}

function startMicrophone() {
	try {
		// Audio source zaten hazir, sadece arecord'u baslat
		if (!audioSource) {
			console.log('Audio source bulunamadi, yeni olusturuluyor...');
			audioSource = new wrtc.nonstandard.RTCAudioSource();
			audioTrackOut = audioSource.createTrack();
		}

		if (pc && audioTrackOut) {
			// Track'i PC'ye ekle
			const sender = pc.addTrack(audioTrackOut);
			console.log("Audio track WebRTC'ye eklendi:", {
				trackId: audioTrackOut.id,
				trackKind: audioTrackOut.kind,
				trackEnabled: audioTrackOut.enabled,
				senderId: sender ? 'OK' : 'FAILED',
			});
		}

		const arecordArgs = [
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
		console.log('Mikrofon baslatiliyor:', arecordArgs.join(' '));

		arecord = spawn('arecord', arecordArgs);

		let dataCounter = 0;
		arecord.stdout.on('data', (chunk) => {
			if (isShuttingDown || !audioSource) return;

			try {
				dataCounter++;
				if (dataCounter % 100 === 0) {
					console.log(
						`Mikrofon veri received: ${chunk.length} bytes (${dataCounter}. chunk)`
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
				console.error('Mikrofon veri isleme error:', error.message);
			}
		});

		arecord.stderr.on('data', (d) => {
			const message = d.toString();
			if (!message.includes('arecord:')) {
				process.stderr.write(`[arecord] ${message}`);
			}
		});

		arecord.on('exit', (code, signal) => {
			console.log(`arecord cikti: kod=${code}, sinyal=${signal}`);
			if (!isShuttingDown && code !== 0 && code !== null) {
				console.log(
					'Mikrofon beklenmedik sekilde kapandi, yeniden baslatiliyor...'
				);
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

		console.log('Mikrofon baslatildi');
	} catch (error) {
		console.error('Mikrofon baslatma error:', error.message);
		if (!isShuttingDown) {
			setTimeout(() => startMicrophone(), 2000);
		}
	}
}

function restartAudioProcesses() {
	console.log('Ses islemleri yeniden baslatiliyor...');
	stopMicrophone();
	stopSpeaker();
	setTimeout(() => {
		if (!isShuttingDown) {
			startMicrophone();
		}
	}, 1000);
}

function stopMicrophone() {
	if (arecord) {
		try {
			arecord.kill('SIGTERM');
		} catch (error) {
			console.error('Mikrofon durdurma error:', error.message);
		}
		arecord = null;
	}

	if (audioTrackOut) {
		try {
			audioTrackOut.stop();
		} catch (error) {
			console.error('Audio track durdurma error:', error.message);
		}
		audioTrackOut = null;
	}

	audioSource = null;
}

// ---- Uzak ses -> aplay ----
let speakerProc = null;
let sink = null;

function startSpeaker() {
	try {
		const args = [
			'-f',
			'S16_LE',
			'-r',
			SAMPLE_RATE.toString(),
			'-c',
			CHANNELS.toString(),
			'-B',
			'1200000',
			'-F',
			'60000',
		]; // daha genis tampon
		if (SPEAKER_DEV) args.push('-D', SPEAKER_DEV);

		console.log('Hoparlor baslatiliyor:', args.join(' '));
		speakerProc = spawn('aplay', args);

		speakerProc.stderr.on('data', (d) => {
			const message = d.toString();
			if (!message.includes('aplay:') && !message.includes('ALSA lib')) {
				process.stderr.write(`[aplay] ${message}`);
			}
		});

		speakerProc.on('exit', (code, signal) => {
			console.log(`aplay cikti: kod=${code}, sinyal=${signal}`);
			speakerProc = null;
			if (!isShuttingDown && code !== 0 && code !== null) {
				console.log(
					'Hoparlor beklenmedik sekilde kapandi, yeniden baslatiliyor...'
				);
				setTimeout(() => {
					if (!isShuttingDown) {
						startSpeaker();
					}
				}, 1000);
			}
		});

		speakerProc.on('error', (error) => {
			console.error('aplay error:', error.message);
			speakerProc = null;
			if (!isShuttingDown) {
				setTimeout(() => startSpeaker(), 2000);
			}
		});

		console.log('Hoparlor baslatildi');
	} catch (error) {
		console.error('Hoparlor baslatma error:', error.message);
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
			console.error('Audio sink durdurma error:', error.message);
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
			console.error('Hoparlor durdurma error:', error.message);
		}
		speakerProc = null;
	}
}

function setupRemoteAudioTrack() {
	if (!pc) return;

	pc.ontrack = (ev) => {
		const track = ev.track;
		if (track.kind !== 'audio') return;
		console.log('Remote audio track geldi');

		if (!speakerProc) startSpeaker();

		try {
			sink = new wrtc.nonstandard.RTCAudioSink(track);

			const FRAME_BYTES_20MS = Math.floor(SAMPLE_RATE * 0.02) * CHANNELS * 2; // Dinamik hesaplama
			let pending = Buffer.alloc(0);
			let lastDataTime = Date.now();

			function onData(data) {
				if (
					isShuttingDown ||
					!speakerProc ||
					!speakerProc.stdin ||
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

					while (pending.length >= FRAME_BYTES_20MS) {
						const out = pending.subarray(0, FRAME_BYTES_20MS);
						const ok = speakerProc.stdin.write(out);
						pending = pending.subarray(FRAME_BYTES_20MS);
						if (!ok) {
							if (sink) sink.ondata = null;
							speakerProc.stdin.once('drain', () => {
								if (sink && !isShuttingDown) sink.ondata = onData;
							});
							break;
						}
					}
				} catch (error) {
					console.error('Audio data isleme error:', error.message);
				}
			}

			sink.ondata = onData;

			// Audio data timeout kontrolu
			const checkAudioTimeout = setInterval(() => {
				if (isShuttingDown) {
					clearInterval(checkAudioTimeout);
					return;
				}

				if (Date.now() - lastDataTime > 5000) {
					// 5 saniye sessizlik
					console.log('Audio veri akisi durdu, baglanti kontrol continuing...');
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
			console.log('ICE gathering time asimi, devam continuing...');
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
		console.log('Sinyalleme sunucusuna baglaniliyor:', u.toString());

		ws = new WebSocket(u);

		const connectionTimeout = setTimeout(() => {
			if (ws && ws.readyState === WebSocket.CONNECTING) {
				console.error('Sinyalleme baglanti time asimi');
				ws.terminate();
			}
		}, 10000);

		ws.on('open', () => {
			clearTimeout(connectionTimeout);
			console.log('Sinyalleme bagli. Pi hazir (answerer).');
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
			console.log(
				`Sinyalleme kapandi (kod: ${code}, sebep: ${
					reason?.toString() || 'bilinmiyor'
				})`
			);
			isConnected = false;

			if (!isShuttingDown) {
				console.log(`${RECONNECT_DELAY}ms sonra yeniden baglanilacak...`);
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
					console.log('Sistem mesaji:', data.event, data.id || '');
					return;
				}

				if (data.type === 'offer' && data.sdp) {
					remotePeerId = data.from; // kritik: target ogren
					console.log('Offer received, from:', remotePeerId);

					if (!pc) {
						pc = createPeerConnection();
						setupIceCandidateHandler();
						setupRemoteAudioTrack();
					}

					// Audio track'i offer almadan once ekleyelim
					if (!audioTrackOut) {
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
							`${global.pendingIceCandidates.length} bekleyen ICE candidate adding...`
						);
						for (const candidate of global.pendingIceCandidates) {
							try {
								await pc.addIceCandidate(new wrtc.RTCIceCandidate(candidate));
							} catch (e) {
								console.error('Pending ICE candidate ekleme error:', e.message);
							}
						}
						global.pendingIceCandidates = [];
					}

					const answer = await pc.createAnswer();
					await pc.setLocalDescription(answer);

					// Non-trickle: tum ICE candidates topla, sonra send
					await waitIceComplete(pc);

					console.log('Send answer ->', remotePeerId);
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
							'ICE candidate gecici olarak storing (remote description henuz yok)'
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
		console.error('Sinyalleme baglanti kurma error:', error.message);
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
	console.log('Graceful shutdown baslatiliyor...');
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
	console.error('Yakalanmamis hata:', error);
	gracefulShutdown();
});

process.on('unhandledRejection', (reason, promise) => {
	console.error('g°slenmemis promise reddi:', reason);
	console.error('Promise:', promise);
});

// Start the application
console.log('Uygulama baslatiliyor...');

// Audio source'u onceden hazirla
console.log('Audio source hazirlaniyor...');
audioSource = new wrtc.nonstandard.RTCAudioSource();
audioTrackOut = audioSource.createTrack();
console.log('Audio track olusturuldu:', {
	trackId: audioTrackOut.id,
	trackKind: audioTrackOut.kind,
	trackEnabled: audioTrackOut.enabled,
});

// Mikrofon veri akisini baslat
startMicrophone();

connectSignaling();
