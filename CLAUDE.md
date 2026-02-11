# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

WebRTC Audio Bridge - A real-time bidirectional audio communication system between web browsers and Raspberry Pi devices. Designed for intercom/voice applications with low-latency audio transmission. The web UI is in Turkish.

## Architecture

```
┌─────────────────┐         ┌─────────────────────┐         ┌──────────────────┐
│   Web Browser   │◄───────►│  Signaling Server   │◄───────►│  Raspberry Pi    │
│   (index.html)  │   WS    │  (webrtc-signaling) │   WS    │ (pi-webrtc-audio)│
└────────┬────────┘         └─────────────────────┘         └────────┬─────────┘
         │                                                           │
         └───────────────── WebRTC PeerConnection ──────────────────┘
                            (Direct audio stream)
```

**Three core services:**
- `webrtc-signaling/server.js` - Express + `ws` WebSocket server for peer discovery and SDP/ICE relay. Also serves `index.html` as static files from the project root.
- `pi-webrtc-audio/index.js` - Node.js client using `wrtc` (node-webrtc) + PulseAudio/ALSA for audio I/O. Always acts as the **answerer** (never creates offers).
- `rtsp_rtc/` - Optional MediaMTX binary for IP camera streaming (RTSP/HLS/WebRTC).

**Connection flow:** Browser (offerer) creates WebRTC offer → signaling relays to Pi → Pi creates answer → direct audio stream established. Non-trickle ICE: all candidates gathered before sending offer/answer.

**Audio pipeline on Pi:**
```
[Mic] → parec/arecord → PCM → RTCAudioSource → WebRTC → Browser
Browser → WebRTC → RTCAudioSink → PCM → paplay/aplay → [Speaker]
```

**Sound effects system:** The Pi has an effect queue (`enqueueEffect`) that plays WAV files (door_close, door_open, start_session, end_session, takeoff_mask, puton_mask, deco_start) via ffmpeg. Effects pause remote audio, pipe decoded PCM into the speaker process, then resume. Triggered via `command` message type through the signaling channel.

## Common Commands

### Installation
```bash
cd webrtc-signaling && npm install && cd ..
cd pi-webrtc-audio && npm install && cd ..
```

### Running Services
```bash
# Signaling server
cd webrtc-signaling && npm start      # Production
cd webrtc-signaling && npm run dev    # Development (nodemon)

# Pi audio client
cd pi-webrtc-audio && npm start       # Production
cd pi-webrtc-audio && npm run dev     # Development (nodemon)

# PM2 deployment (all services)
pm2 start ecosystem.config.js
```

### Debugging & Testing
```bash
# Health/status checks
npm run health --prefix webrtc-signaling    # GET /health
npm run peers --prefix webrtc-signaling     # GET /peers

# Audio device testing (on Pi)
npm run list-devices --prefix pi-webrtc-audio
npm run test-audio --prefix pi-webrtc-audio

# Shell scripts
./debug_webrtc.sh           # Connection diagnostics
./debug_pi_microphone.sh    # Microphone debug
./fix_pi_audio.sh           # Audio system reset
./test_microphone.sh        # ALSA device test
```

## Configuration

Configuration is via `.env` files (copy from `config.example`):

**pi-webrtc-audio/.env** (key settings):
- `SIGNALING_URL` - WebSocket URL (e.g., `ws://192.168.1.12:8080/ws`)
- `PEER_ID` - Unique peer identifier (default: `raspi-1`)
- `USE_PULSEAUDIO=1` - Recommended; `0` for legacy ALSA mode
- `PULSE_SINK` / `PULSE_SOURCE` - PulseAudio device names (empty = system default)
- `ARECORD_DEV` / `SPEAKER_DEV` - ALSA devices (only when `USE_PULSEAUDIO=0`)
- `SAMPLE_RATE` - Audio sample rate (default: 48000)
- `DISABLE_MIC=1` - Receive-only mode (default: enabled)
- `IDLE_RESET_MS` - Service reset timeout when idle (default: 120000)

**webrtc-signaling/.env:**
- `PORT` - Server port (default: 8080)
- `HOST` - Bind address (default: 0.0.0.0)

## Key Implementation Details

- **Non-trickle ICE**: Gathers all ICE candidates before sending offer/answer (15s timeout on Pi, 10s on browser)
- **Audio format**: 48kHz, 16-bit, mono PCM via PulseAudio (`parec`/`paplay`) or ALSA (`arecord`/`aplay`)
- **Reconnection**: Auto-reconnect to signaling with configurable delay (default 1.5s)
- **Idle timeout**: 120s reset for service recovery when no active peer
- **Peer roles**: Browser is always the offerer; Pi is always the answerer
- **Signaling messages**: `offer`, `answer`, `candidate`, `system`, and `command` types
- **Command protocol**: `{ type: 'command', to: peerId, command: 'play_door_close' }` - supported commands: `door_close`, `door_open`, `start_session`, `end_session`, `takeoff_mask`, `puton_mask`, `deco_start`, `stop_effect`
- **Effect playback**: Uses ffmpeg to decode WAV → raw PCM, piped into the existing speaker process stdin. Pauses remote audio during effect playback, resumes after.
- **EPIPE recovery**: Speaker stdin EPIPE triggers automatic aplay/paplay restart and stream reattachment
- **Backpressure**: Both effect and remote audio writes handle stdin backpressure via pause/drain/resume

## Code Style

- Node.js 14+, CommonJS modules (`require`/`module.exports`)
- Tab indentation, single quotes
- camelCase for variables/functions
- Environment keys in SCREAMING_SNAKE_CASE
- Some log messages and comments are in Turkish

## Commit Messages

Use imperative, scope-prefixed format:
```
signaling: add peer timeout handling
pi-audio: fix microphone track duplication
```
