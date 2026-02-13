# Repository Guidelines

This document orients contributors to the Raspberry Pi audio capture client, WebRTC signaling server, and optional MediaMTX camera stack contained in this repository.

## Project Structure & Module Organization
- `pi-webrtc-audio/` captures ALSA audio, negotiates WebRTC peers, and sources runtime values from `.env`.
- `webrtc-signaling/` runs the Node/Express WebSocket server, hosts static assets, and exposes operational health endpoints.
- `rtsp_rtc/` ships the MediaMTX binary plus `mediamtx.yml` for optional RTSP-to-WebRTC video relays.
- Root scripts such as `start.sh`, `debug_webrtc.sh`, and `ecosystem.config.js` bootstrap installs, interactive troubleshooting, and PM2 deployment; keep them executable.

## Build, Test, and Development Commands
Run `npm install` separately inside `webrtc-signaling/` and `pi-webrtc-audio/`. Use `npm start` for production-like runs and `npm run dev` when nodemon-based hot reloads help. From `webrtc-signaling/`, `npm run health` polls `/health` while `npm run peers` lists active peer IDs. On the Pi client, `npm run list-devices` enumerates ALSA inputs and `npm run test-audio` captures a short sample for playback verification.

## Coding Style & Naming Conventions
Favor Node.js ≥14 features, CommonJS modules, single quotes, and camelCase identifiers (`SIGNALING_URL`, `peerId`). Indent code with tabs, mirror existing directory layouts, and extend provided `config.example` files instead of inventing new formats. Keep configuration ASCII-only and document non-obvious environment variables inline or in README updates.

## Testing Guidelines
There is no automated test suite yet, so rely on manual validation. After backend changes, start the signaling server locally and run `npm run health`; confirm inbound clients appear via `npm run peers`. For device-side edits, run `npm run list-devices`, capture audio with `npm run test-audio`, and inspect WebRTC connection logs. Record any manual verification steps in the associated pull request.

## Commit & Pull Request Guidelines
Adopt imperative, scope-prefixed commits such as `signaling: guard empty peer list` and reference issue IDs when possible. Pull requests should summarize intent, highlight config or hardware prerequisites, attach screenshots or console snippets for key flows, and call out required redeploy steps when `.env` defaults shift.

## Security & Configuration Tips
Never commit real credentials; rely on `.env` templates for defaults. Redact peer IDs, IPs, and camera endpoints from shared logs. Limit MediaMTX exposure to necessary cameras and prefer firewalled networks when hosting the signaling server. Document any new secrets or certificates so operators understand rotation requirements.
