# Repository Guidelines

## Project Structure & Module Organization
`pi-webrtc-audio/` hosts the Raspberry Pi client that captures audio with ALSA, manages the WebRTC peer connection, and reads its runtime settings from `.env`. `webrtc-signaling/` exposes the Node/Express WebSocket server, static web assets, and health endpoints. `rtsp_rtc/` packages the MediaMTX binary plus `mediamtx.yml` for optional camera streaming. Root-level scripts like `start.sh`, `debug_webrtc.sh`, and `ecosystem.config.js` automate installs, troubleshooting, and PM2 deployment; keep them executable.

## Build, Test, and Development Commands
Run `npm install` separately in `webrtc-signaling/` and `pi-webrtc-audio/`. Use `npm start` for production-like runs and `npm run dev` when you need file-watching via nodemon. `webrtc-signaling` also exposes `npm run health` to probe the `/health` endpoint and `npm run peers` to inspect active peer IDs. On the Pi, `npm run list-devices` and `npm run test-audio` verify ALSA devices before pairing.

## Coding Style & Naming Conventions
This codebase favors modern Node.js (>=14) features, CommonJS modules, and tab-indented blocks—match that formatting when editing. Stick with single quotes for strings and camelCase identifiers for variables, functions, and environment keys (e.g., `SIGNALING_URL`). Configuration files should extend the provided `config.example` templates and remain ASCII.

## Testing Guidelines
There is no automated test suite yet, so treat manual verification as mandatory. After changes, start the signaling server locally and call `npm run health`; confirm new peers appear when the Pi client connects. For device-level updates, capture a short sample with `npm run test-audio` and play it back. Document any added manual test steps in your pull request until automated coverage lands.

## Commit & Pull Request Guidelines
Existing history is terse ("turkish", "inti"), so please move toward imperative, scope-prefixed messages such as `signaling: guard empty peer list`. Reference issue IDs when available. Pull requests should outline the change, note config or hardware prerequisites, and include screenshots or console transcripts for key flows. If you touch `.env` defaults, call out required redeploy steps and scrub secrets before sharing logs.

## Security & Configuration Tips
Config secrets live in `.env`; never commit real credentials. When sharing troubleshooting output, redact peer IDs and IPs. Keep MediaMTX configs limited to the minimum required cameras, and prefer firewall-restricted networks when exposing the signaling server.
