module.exports = {
	apps: [
		{
			name: 'signal-server',
			cwd: './webrtc-signaling',
			script: 'server.js',
			interpreter: 'node',
			watch: false,
			autorestart: true,
			restart_delay: 1000,
		},
		{
			name: 'pi-webrtc-audio',
			cwd: './pi-webrtc-audio',
			script: 'index.js',
			interpreter: 'node',
			watch: false,
			autorestart: true,
			restart_delay: 1000,
			env: {
				PULSE_SERVER: 'unix:/run/user/1000/pulse/native',
				XDG_RUNTIME_DIR: '/run/user/1000',
			},
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
