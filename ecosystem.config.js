module.exports = {
	apps: [
		{
			name: 'signal-server',
			cwd: './webrtc-signaling',
			script: 'server.js',
			interpreter: 'node',
			env: {
				PORT: '3000',
			},
			watch: false,
			autorestart: true,
			restart_delay: 1000,
		},
		{
			name: 'pi-webrtc-audio',
			cwd: './pi-webrtc-audio',
			script: 'index.js',
			interpreter: 'node',
			env: {
				SIGNALING_URL: 'ws://localhost:3000/ws',
				PEER_ID: 'raspi-1',
				ARECORD_DEV: 'plughw:2,0',
				SPEAKER_DEV: 'plughw:2,0',
				USE_STUN: '0',
				SAMPLE_RATE: '48000',
				CHANNELS: '1',
				RECONNECT_DELAY: '1500',
			},
			watch: false,
			autorestart: true,
			restart_delay: 1000,
		},
		{
			name: 'mediamtx',
			cwd: './rtsp_rtc',
			script: './mediamtx',
			interpreter: 'none',
			watch: false,
			autorestart: true,
			restart_delay: 1000,
		},
	],
};
