# AGENTS.md

Guidelines for AI coding agents working on this WebRTC Audio Bridge project.

## Project Overview

Real-time bidirectional audio communication between web browsers and Raspberry Pi devices. Three services:
- `webrtc-signaling/` - Express + WebSocket signaling server
- `pi-webrtc-audio/` - Node.js WebRTC client with PulseAudio/ALSA audio I/O
- `rtsp_rtc/` - Optional MediaMTX for IP camera streaming

## Build & Development Commands

```bash
# Install dependencies (run in each directory)
cd webrtc-signaling && npm install
cd pi-webrtc-audio && npm install

# Development (with hot reload via nodemon)
npm run dev --prefix webrtc-signaling
npm run dev --prefix pi-webrtc-audio

# Production
npm start --prefix webrtc-signaling
npm start --prefix pi-webrtc-audio

# PM2 (all services)
pm2 start ecosystem.config.js
pm2 logs
pm2 restart all
```

## Testing & Validation

No automated test suite exists. Manual validation required:

```bash
# Signaling server health
npm run health --prefix webrtc-signaling    # GET /health endpoint
npm run peers --prefix webrtc-signaling     # List connected peers

# Pi audio device testing (run on Pi hardware)
npm run list-devices --prefix pi-webrtc-audio  # Enumerate ALSA devices
npm run test-audio --prefix pi-webrtc-audio    # 5-second record/playback test

# Debug scripts
./debug_webrtc.sh          # Connection diagnostics
./debug_pi_microphone.sh   # Microphone debugging
./test_microphone.sh       # ALSA device test
./fix_pi_audio.sh          # Reset audio system
```

## Code Style

### Language & Modules
- Node.js 14+, CommonJS (`require`/`module.exports`)
- No TypeScript, no ESM imports
- Tab indentation (not spaces)
- Single quotes for strings
- Semicolons optional (follow file's existing style)

### Naming Conventions
- Variables/functions: `camelCase` (e.g., `peerId`, `createPeerConnection`)
- Constants/ENV keys: `SCREAMING_SNAKE_CASE` (e.g., `SIGNALING_URL`, `SAMPLE_RATE`)
- Private functions: prefix with underscore (e.g., `_handleMessage`)
- Files: lowercase with hyphens (e.g., `server.js`, `pi-webrtc-audio/`)

### Imports Organization
```javascript
// 1. Node.js built-ins
const http = require('http');
const path = require('path');

// 2. External dependencies
const express = require('express');
const { WebSocketServer } = require('ws');

// 3. Local modules (if any)
const config = require('./config');
```

### Function Style
```javascript
// Prefer function declarations for top-level functions
function startSpeaker() {
	// ...
}

// Arrow functions for callbacks and inline handlers
peers.forEach((ws, id) => { /* ... */ });
ws.on('message', (raw) => { /* ... */ });
```

## Error Handling

### Try-Catch Blocks
Always wrap risky operations, especially:
- WebSocket sends (may throw if connection closed)
- Child process operations (spawn, exec)
- Audio device operations

```javascript
try {
	ws.send(JSON.stringify(msg));
} catch (error) {
	logActivity(`Message delivery error: ${error.message}`);
}
```

### Process-Wide Handlers
Both services implement:
- `process.on('uncaughtException')` - Log and graceful shutdown
- `process.on('unhandledRejection')` - Log promise rejections
- `process.on('SIGINT/SIGTERM')` - Graceful shutdown

### EPIPE Recovery (Pi Client)
Handle `EPIPE` errors from audio pipes without crashing:
```javascript
speakerProc.stdin.on('error', (err) => {
	if (err.code === 'EPIPE') {
		// Restart audio pipeline, don't exit
		restartAudioProcesses();
	}
});
```

## Key Architecture Patterns

### WebRTC Connection Flow
1. Browser (offerer) creates offer → signaling relays to Pi
2. Pi (answerer) creates answer → signaling relays back
3. Non-trickle ICE: gather all candidates before sending (15s timeout)
4. Direct audio stream established via RTCPeerConnection

### Audio Pipeline (Pi)
```
[Mic] → parec/arecord → RTCAudioSource → WebRTC → Browser
Browser → WebRTC → RTCAudioSink → paplay/aplay → [Speaker]
```

### Signaling Protocol
Message types: `offer`, `answer`, `candidate`, `system`, `command`
```javascript
{ type: 'offer', to: 'target-id', sdp: {...} }
{ type: 'command', to: 'raspi-1', command: 'play_door_close' }
```

### Effect Playback
- Uses ffmpeg to decode WAV → raw PCM
- Pipes into existing speaker process stdin
- Pauses remote audio during effect, resumes after
- Handles backpressure via pause/drain/resume

## Configuration

Environment variables via `.env` files (copy from `config.example`):

**pi-webrtc-audio/.env:**
- `SIGNALING_URL` - WebSocket server URL
- `PEER_ID` - Unique identifier (default: `raspi-1`)
- `USE_PULSEAUDIO=1` - Recommended; set `0` for ALSA
- `SAMPLE_RATE=48000`, `CHANNELS=1`
- `DISABLE_MIC=1` - Receive-only mode

**webrtc-signaling/.env:**
- `PORT=8080`, `HOST=0.0.0.0`

Never commit real `.env` files or credentials.

## Commit Guidelines

Imperative, scope-prefixed format:
```
signaling: add peer timeout handling
pi-audio: fix microphone track duplication
rtsp: update mediamtx config
```

Reference issue IDs when applicable.

## Known Performance Considerations

1. `Buffer.concat()` in audio hot path causes memory churn - consider pre-allocated buffers
2. `global.pendingIceCandidates` uses global state - potential memory leak if not cleared
3. `pkill -9` for cleanup is brutal - may leave orphan processes
4. Each effect spawns new ffmpeg process - consider pooling if frequent

## Security

- Redact peer IDs, IPs, camera URLs from logs before sharing
- CORS is permissive (`*`) - tighten for production
- No authentication on signaling - add if exposed to internet
- Use HTTPS in production (WebRTC requirement)
