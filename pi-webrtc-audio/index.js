// pi-webrtc-audio.js (Answerer - Raspberry Pi)
// Non-trickle ICE: offer/answer gÃ¶nderirken tÃ¼m ICE adaylarÄ±nÄ± toplar.
// Sinyallemede 'offer.from' -> remotePeerId; answer/candidate mesajlarÄ±nÄ± 'to: remotePeerId' ile yollar.
// Uzak ses RTCAudioSink -> aplay (buffer/offset dÃ¼zeltmeleri). Yerel mic arecord -> RTCAudioSource.

const wrtc = require('wrtc');
const WebSocket = require('ws');
const { spawn } = require('child_process');

// ====== ENV / KONFÄ°G ======
const SIGNALING_URL = process.env.SIGNALING_URL || 'ws://192.168.1.20:8080/ws';
const PEER_ID = process.env.PEER_ID || 'raspi-1';
const ARECORD_DEV = process.env.ARECORD_DEV || 'plughw:2,0';
const SPEAKER_DEV = process.env.SPEAKER_DEV || 'plughw:2,0';
const USE_STUN = parseInt(process.env.USE_STUN || '0'); // LAN test iÃ§in varsayÄ±lan 0
const SAMPLE_RATE = parseInt(process.env.SAMPLE_RATE || '48000');
const CHANNELS = parseInt(process.env.CHANNELS || '1');
const RECONNECT_DELAY = parseInt(process.env.RECONNECT_DELAY || '1500');
// ==========================

console.log('Pi WebRTC Audio baÅlatÄ±lÄ±yor...');
console.log('Sinyalleme URL:', SIGNALING_URL);
console.log('Peer ID:', PEER_ID);
console.log('Mikrofon device:', ARECORD_DEV);
console.log('HoparlÃ¶r device:', SPEAKER_DEV);
console.log('Sample rate:', SAMPLE_RATE);
console.log('Kanallar:', CHANNELS);

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
		console.log("Mevcut audio track PC'ye ekleniyor...");
		pc.addTrack(audioTrackOut);
	} else {
		console.log('Audio transceiver ekleniyor...');
		pc.addTransceiver('audio', { direction: 'sendrecv' });
	}

	pc.oniceconnectionstatechange = () => {
		console.log('ICE state:', pc.iceConnectionState);
		if (pc.iceConnectionState === 'failed') {
			console.log('ICE baÄlantÄ±sÄ± baÅarÄ±sÄ±z, yeniden baÅlatÄ±lÄ±yor...');
			if (pc.restartIce) {
				pc.restartIce();
			}
		}
	};

	pc.onconnectionstatechange = () => {
		console.log('PC state:', pc.connectionState);
		if (pc.connectionState === 'failed') {
			console.error('Peer baÄlantÄ±sÄ± baÅarÄ±sÄ±z oldu');
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
		// Audio source zaten hazÄ±r, sadece arecord'u baÅlat
		if (!audioSource) {
			console.log('Audio source bulunamadÄ±, yeni oluÅturuluyor...');
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
		console.log('Mikrofon baÅlatÄ±lÄ±yor:', arecordArgs.join(' '));

		arecord = spawn('arecord', arecordArgs);

		let dataCounter = 0;
		arecord.stdout.on('data', (chunk) => {
			if (isShuttingDown || !audioSource) return;

			try {
				dataCounter++;
				if (dataCounter % 100 === 0) {
					console.log(
						`Mikrofon veri alÄ±ndÄ±: ${chunk.length} bytes (${dataCounter}. chunk)`
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
							console.error('AudioSource.onData hatasÄ±:', sourceError.message);
						}
					}
				}
			} catch (error) {
				console.error('Mikrofon veri iÅleme hatasÄ±:', error.message);
			}
		});

		arecord.stderr.on('data', (d) => {
			const message = d.toString();
			if (!message.includes('arecord:')) {
				process.stderr.write(`[arecord] ${message}`);
			}
		});

		arecord.on('exit', (code, signal) => {
			console.log(`arecord Ã§Ä±ktÄ±: kod=${code}, sinyal=${signal}`);
			if (!isShuttingDown && code !== 0 && code !== null) {
				console.log(
					'Mikrofon beklenmedik Åekilde kapandÄ±, yeniden baÅlatÄ±lÄ±yor...'
				);
				setTimeout(() => {
					if (!isShuttingDown) {
						startMicrophone();
					}
				}, 1000);
			}
		});

		arecord.on('error', (error) => {
			console.error('arecord hatasÄ±:', error.message);
			if (!isShuttingDown) {
				setTimeout(() => startMicrophone(), 2000);
			}
		});

		console.log('Mikrofon baÅlatÄ±ldÄ±');
	} catch (error) {
		console.error('Mikrofon baÅlatma hatasÄ±:', error.message);
		if (!isShuttingDown) {
			setTimeout(() => startMicrophone(), 2000);
		}
	}
}

function restartAudioProcesses() {
	console.log('Ses iÅlemleri yeniden baÅlatÄ±lÄ±yor...');
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
			console.error('Mikrofon durdurma hatasÄ±:', error.message);
		}
		arecord = null;
	}

	if (audioTrackOut) {
		try {
			audioTrackOut.stop();
		} catch (error) {
			console.error('Audio track durdurma hatasÄ±:', error.message);
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
		]; // daha geniÅ tampon
		if (SPEAKER_DEV) args.push('-D', SPEAKER_DEV);

		console.log('HoparlÃ¶r baÅlatÄ±lÄ±yor:', args.join(' '));
		speakerProc = spawn('aplay', args);

		speakerProc.stderr.on('data', (d) => {
			const message = d.toString();
			if (!message.includes('aplay:') && !message.includes('ALSA lib')) {
				process.stderr.write(`[aplay] ${message}`);
			}
		});

		speakerProc.on('exit', (code, signal) => {
			console.log(`aplay Ã§Ä±ktÄ±: kod=${code}, sinyal=${signal}`);
			speakerProc = null;
			if (!isShuttingDown && code !== 0 && code !== null) {
				console.log(
					'HoparlÃ¶r beklenmedik Åekilde kapandÄ±, yeniden baÅlatÄ±lÄ±yor...'
				);
				setTimeout(() => {
					if (!isShuttingDown) {
						startSpeaker();
					}
				}, 1000);
			}
		});

		speakerProc.on('error', (error) => {
			console.error('aplay hatasÄ±:', error.message);
			speakerProc = null;
			if (!isShuttingDown) {
				setTimeout(() => startSpeaker(), 2000);
			}
		});

		console.log('HoparlÃ¶r baÅlatÄ±ldÄ±');
	} catch (error) {
		console.error('HoparlÃ¶r baÅlatma hatasÄ±:', error.message);
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
			console.error('Audio sink durdurma hatasÄ±:', error.message);
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
			console.error('HoparlÃ¶r durdurma hatasÄ±:', error.message);
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
					console.error('Audio data iÅleme hatasÄ±:', error.message);
				}
			}

			sink.ondata = onData;

			// Audio data timeout kontrolÃ¼
			const checkAudioTimeout = setInterval(() => {
				if (isShuttingDown) {
					clearInterval(checkAudioTimeout);
					return;
				}

				if (Date.now() - lastDataTime > 5000) {
					// 5 saniye sessizlik
					console.log(
						'Audio veri akÄ±ÅÄ± durdu, baÄlantÄ± kontrol ediliyor...'
					);
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
					console.error('Sink durdurma hatasÄ±:', error.message);
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
			console.error('Remote audio track kurulum hatasÄ±:', error.message);
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
			console.log('ICE gathering zaman aÅÄ±mÄ±, devam ediliyor...');
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
		// Non-trickle moddayÄ±z; yine de ileride gerekirse dursun
		if (candidate && ws?.readyState === 1 && remotePeerId && !isShuttingDown) {
			try {
				ws.send(
					JSON.stringify({ type: 'candidate', to: remotePeerId, candidate })
				);
			} catch (error) {
				console.error('ICE candidate gÃ¶nderme hatasÄ±:', error.message);
			}
		}
	};
}

function connectSignaling() {
	if (isShuttingDown) return;

	try {
		const u = new URL(SIGNALING_URL);
		u.searchParams.set('id', PEER_ID);
		console.log('Sinyalleme sunucusuna baÄlanÄ±lÄ±yor:', u.toString());

		ws = new WebSocket(u);

		const connectionTimeout = setTimeout(() => {
			if (ws && ws.readyState === WebSocket.CONNECTING) {
				console.error('Sinyalleme baÄlantÄ± zaman aÅÄ±mÄ±');
				ws.terminate();
			}
		}, 10000);

		ws.on('open', () => {
			clearTimeout(connectionTimeout);
			console.log('Sinyalleme baÄlÄ±. Pi hazÄ±r (answerer).');
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
				`Sinyalleme kapandÄ± (kod: ${code}, sebep: ${
					reason?.toString() || 'bilinmiyor'
				})`
			);
			isConnected = false;

			if (!isShuttingDown) {
				console.log(`${RECONNECT_DELAY}ms sonra yeniden baÄlanÄ±lacak...`);
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
					console.log('Sistem mesajÄ±:', data.event, data.id || '');
					return;
				}

				if (data.type === 'offer' && data.sdp) {
					remotePeerId = data.from; // kritik: hedefi Ã¶Ären
					console.log('Offer alÄ±ndÄ±, from:', remotePeerId);

					if (!pc) {
						pc = createPeerConnection();
						setupIceCandidateHandler();
						setupRemoteAudioTrack();
					}

					// Audio track'i offer almadan Ã¶nce ekleyelim
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
							`${global.pendingIceCandidates.length} bekleyen ICE candidate ekleniyor...`
						);
						for (const candidate of global.pendingIceCandidates) {
							try {
								await pc.addIceCandidate(new wrtc.RTCIceCandidate(candidate));
							} catch (e) {
								console.error(
									'Pending ICE candidate ekleme hatasÄ±:',
									e.message
								);
							}
						}
						global.pendingIceCandidates = [];
					}

					const answer = await pc.createAnswer();
					await pc.setLocalDescription(answer);

					// Non-trickle: tÃ¼m ICE adaylarÄ±nÄ± topla, sonra gÃ¶nder
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
							'ICE candidate gecici olarak saklanÄ±yor (remote description henÃ¼z yok)'
						);
						// Store candidates to add later
						if (!global.pendingIceCandidates) global.pendingIceCandidates = [];
						global.pendingIceCandidates.push(data.candidate);
					}
					return;
				}
			} catch (e) {
				console.error('Sinyalleme mesaj hatasÄ±:', e.message);
			}
		});
	} catch (error) {
		console.error('Sinyalleme baÄlantÄ± kurma hatasÄ±:', error.message);
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
	console.log('Graceful shutdown baÅlatÄ±lÄ±yor...');
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
			console.error('PC kapatma hatasÄ±:', error.message);
		}
		pc = null;
	}

	if (ws) {
		try {
			ws.close(1000, 'Shutdown');
		} catch (error) {
			console.error('WS kapatma hatasÄ±:', error.message);
		}
		ws = null;
	}

	console.log('Shutdown tamamlandÄ±');
	process.exit(0);
}

// Signal handlers
process.on('SIGINT', gracefulShutdown);
process.on('SIGTERM', gracefulShutdown);
process.on('SIGHUP', gracefulShutdown);

// Uncaught exception handler
process.on('uncaughtException', (error) => {
	console.error('YakalanmamÄ±Å hata:', error);
	gracefulShutdown();
});

process.on('unhandledRejection', (reason, promise) => {
	console.error('Ä°ÅlenmemiÅ promise reddi:', reason);
	console.error('Promise:', promise);
});

// Start the application
console.log('Uygulama baÅlatÄ±lÄ±yor...');

// Audio source'u Ã¶nceden hazÄ±rla
console.log('Audio source hazÄ±rlanÄ±yor...');
audioSource = new wrtc.nonstandard.RTCAudioSource();
audioTrackOut = audioSource.createTrack();
console.log('Audio track oluÅturuldu:', {
	trackId: audioTrackOut.id,
	trackKind: audioTrackOut.kind,
	trackEnabled: audioTrackOut.enabled,
});

// Mikrofon veri akÄ±ÅÄ±nÄ± baÅlat
startMicrophone();

connectSignaling();
