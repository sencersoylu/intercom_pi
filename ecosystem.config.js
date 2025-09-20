module.exports = {
	apps: [
		{
			name: 'signal-server',
			cwd: './server',
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
			name: 'pi-client',
			cwd: './pi-client',
			script: 'index.js',
			interpreter: 'node',
			env: {
				SIGNAL_URL: 'ws://localhost:3000',
				ROOM_ID: 'room1',
				MIC_DEVICE: 'plughw:1,0',
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
