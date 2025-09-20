# WebRTC Audio Bridge

Comprehensive WebRTC application providing real-time audio communication between web browsers and Raspberry Pi. This project establishes low-latency audio communication using modern web technologies.

## 🚀 Features

### WebRTC Audio Communication

- ✅ **Web Browser ↔ Raspberry Pi** bidirectional audio communication
- ✅ **Non-trickle ICE** support (sends after gathering all ICE candidates)
- ✅ **Low latency** audio transmission (10ms chunks)
- ✅ **Automatic reconnection** mechanism
- ✅ **Graceful shutdown** and error recovery

### Audio Processing

- ✅ **ALSA audio support** (Raspberry Pi)
- ✅ **USB audio card** support
- ✅ **Configurable audio devices** (microphone/speaker)
- ✅ **48kHz, 16-bit, Mono** audio quality
- ✅ **Echo cancellation** and **noise suppression**
- ✅ **Real-time audio level** monitoring

### Signaling and Network

- ✅ **WebSocket-based** signaling server
- ✅ **Health check** and **peer monitoring** endpoints
- ✅ **CORS support** and security
- ✅ **STUN server** support (optional)
- ✅ **Firewall friendly** TCP-priority connection

### Video Streaming (MediaMTX)

- ✅ **RTSP/RTMP/WebRTC** video streaming
- ✅ **IP camera** support
- ✅ **HLS** and **Low-Latency HLS**
- ✅ **On-demand** video transcoding
- ✅ **Multi-protocol** support

### Developer Tools

- ✅ **Comprehensive debug scripts**
- ✅ **Audio device testing** tools
- ✅ **Automated installation** scripts
- ✅ **PM2 ecosystem** configuration
- ✅ **Comprehensive logging**

## 📋 Requirements

### Raspberry Pi Minimum System

- **Raspberry Pi 3B+** or higher (4B recommended)
- **Raspberry Pi OS** (Bullseye/Bookworm)
- **Node.js 14+** (18+ recommended)
- **8GB+ microSD** card
- **USB audio card** or HAT
- **Internet connection** (for installation)

### Audio Hardware

- **USB audio card** (e.g., Creative Sound Blaster Play! 3)
- **Microphone** (USB or 3.5mm)
- **Speaker/Headphones** (USB or 3.5mm)
- **ALSA compatible** audio devices

### Web Client (Browser)

- **Chrome 90+** (recommended)
- **Firefox 88+**
- **Safari 14+**
- **Edge 90+**
- **HTTPS** (for production)
- **Microphone permission** required

### Video Streaming (Optional)

- **IP camera** (RTSP support)
- **MediaMTX binary** (included)
- **FFmpeg** (for transcoding)

## 🛠️ Installation

### Quick Start (Automated)

```bash
# 1. Clone the repository
git clone <repository-url>
cd webrtc

# 2. Run the automated installation script
chmod +x start.sh
./start.sh
```

### Manual Installation

#### 1. Project Dependencies

```bash
# Install dependencies in both directories
cd webrtc-signaling && npm install && cd ..
cd pi-webrtc-audio && npm install && cd ..
```

#### 2. Raspberry Pi Setup

```bash
# Audio system installation
sudo apt-get update
sudo apt-get install -y alsa-utils

# Check audio devices
aplay -l    # Playback devices
arecord -l  # Recording devices

# Test USB audio card
arecord -D plughw:3,0 -f S16_LE -r 48000 -c 1 -t wav -d 3 test.wav
aplay test.wav
```

#### 3. Configuration Files

```bash
# Pi WebRTC configuration
cp pi-webrtc-audio/config.example pi-webrtc-audio/.env

# Signaling server configuration
cp webrtc-signaling/config.example webrtc-signaling/.env

# Edit settings
nano pi-webrtc-audio/.env
```

#### 4. Starting Services

```bash
# Terminal 1: Signaling server
cd webrtc-signaling && npm start

# Terminal 2: Pi WebRTC client (on Pi)
cd pi-webrtc-audio && npm start

# Terminal 3: In web browser
open index.html
# or http://localhost:8080/index.html
```

### Production Setup (PM2)

```bash
# Run as service with PM2
npm install -g pm2
pm2 start ecosystem.config.js
pm2 save
pm2 startup
```

## ⚙️ Configuration

### Raspberry Pi Configuration (`pi-webrtc-audio/.env`)

```bash
# Signaling server settings
SIGNALING_URL=ws://192.168.1.12:8080/ws
PEER_ID=raspi-1

# Audio device settings (check with aplay -l and arecord -l)
ARECORD_DEV=plughw:3,0      # Microphone device
SPEAKER_DEV=plughw:3,0      # Speaker device

# Audio quality settings
SAMPLE_RATE=48000           # 48kHz recommended
CHANNELS=1                  # Mono (1) or Stereo (2)

# Network settings
USE_STUN=0                  # 0 for LAN, 1 for Internet
RECONNECT_DELAY=1500        # Reconnection delay (ms)
```

### Signaling Server Configuration (`webrtc-signaling/.env`)

```bash
# Server bind settings
PORT=8080                   # WebSocket port
HOST=0.0.0.0               # Listen on all interfaces

# Security settings (production)
# SSL_CERT_PATH=/path/to/cert.pem
# SSL_KEY_PATH=/path/to/key.pem
```

### MediaMTX Video Streaming Configuration

```yaml
# In rtsp_rtc/mediamtx.yml
paths:
  cam1:
    source: rtsp://admin:password@192.168.1.105:554
    rtspTransport: tcp

  cam1enc:
    # FFmpeg transcoding
    runOnDemand: >
      ffmpeg -rtsp_transport tcp -i rtsp://admin:password@192.168.1.105:554
      -c:v libx264 -preset ultrafast -tune zerolatency 
      -b:v 1500k -c:a libopus -ac 1 -b:a 64k
      -f rtsp rtsp://127.0.0.1:8554/cam1enc
```

### Audio Device Configuration

```bash
# List audio devices
./test_microphone.sh

# Manual check
aplay -l     # Playback devices
arecord -l   # Recording devices

# Device test
arecord -D plughw:3,0 -f S16_LE -r 48000 -c 1 -t wav -d 5 test.wav
aplay test.wav

# ALSA mixer settings
alsamixer   # F4: Recording, ↑↓: Volume, M: Mute toggle
```

## 🎯 Usage

### Basic Usage Steps

1. **📡 Start the signaling server**

   ```bash
   cd webrtc-signaling && npm start
   ```

2. **🔊 Start the Raspberry Pi client**

   ```bash
   cd pi-webrtc-audio && npm start
   ```

3. **🌐 Open the web client in browser**

   ```bash
   # Local file
   open index.html

   # Or via server
   http://localhost:8080/index.html
   ```

4. **⚙️ Configure connection settings**

   - **Signaling URL:** `ws://192.168.1.12:8080/ws`
   - **My ID:** `web-1`
   - **Remote ID:** `raspi-1`

5. **🔗 Click "Connect" button**

### Video Streaming Usage

```bash
# Start MediaMTX
cd rtsp_rtc && ./mediamtx

# Watch IP camera stream
http://localhost:8889/cam1/

# Low-latency WebRTC stream
http://localhost:8889/cam1enc/
```

## 🔧 Troubleshooting

### Automated Debug Scripts

```bash
# Comprehensive debug analysis
./debug_webrtc.sh

# Microphone specific debug
./debug_pi_microphone.sh

# Audio system fix
./fix_pi_audio.sh

# Audio device test
./test_microphone.sh
```

### Common Problems and Solutions

#### 🎤 Audio Issues

**Problem:** Microphone not working

```bash
# Solution 1: Check audio devices
aplay -l && arecord -l

# Solution 2: ALSA mixer settings
alsamixer  # Press F4 for recording, increase volume to 80%

# Solution 3: Reset USB audio card
sudo rmmod snd_usb_audio && sudo modprobe snd_usb_audio

# Solution 4: Restart audio system
sudo service alsa-state restart
```

**Problem:** No sound from speakers

```bash
# Test audio playback
speaker-test -c 1 -t wav

# ALSA volume levels
amixer set Master 80%
amixer set PCM 80%
```

#### 🌐 Connection Issues

**Problem:** WebSocket connection failed

```bash
# Check signaling server status
curl http://192.168.1.12:8080/health

# Check port
nc -z 192.168.1.12 8080

# Check firewall
sudo ufw status
```

**Problem:** Peer unavailable

```bash
# Check connected peers
curl http://192.168.1.12:8080/peers

# Check Pi client status
ps aux | grep "node index.js"
```

**Problem:** ICE connection failed

```bash
# Enable STUN server
export USE_STUN=1

# Network debug
ip route show default
```

#### 🔊 Audio Quality Issues

**Problem:** Audio dropouts/latency

```bash
# Optimize buffer sizes
export SAMPLE_RATE=44100  # Try lower sample rate
export CHANNELS=1         # Use mono

# ALSA buffer settings
arecord --period-size=480 --buffer-size=1920
```

### Advanced Debugging

#### Real-time Log Monitoring

```bash
# Pi WebRTC client logs
cd pi-webrtc-audio
DEBUG=* npm start 2>&1 | tee webrtc-debug.log

# Signaling server logs
cd webrtc-signaling
npm start 2>&1 | tee signaling-debug.log

# Browser console logs (F12 Developer Tools)
```

#### Performance Monitoring

```bash
# System resource usage
htop

# Network traffic
sudo netstat -tuln | grep 8080

# Audio process monitoring
ps aux | grep -E "(arecord|aplay)"
```

## 🔌 API Endpoints

### Signaling Server API

#### Health Check

```bash
# Server status
curl http://localhost:8080/health

# Response
{
  "status": "OK",
  "timestamp": "2024-01-15T10:30:00.000Z",
  "connectedPeers": 2,
  "uptime": 3600
}
```

#### Connected Peers

```bash
# List connected peers
curl http://localhost:8080/peers

# Response
{
  "peers": [
    {"id": "web-1", "connected": true},
    {"id": "raspi-1", "connected": true}
  ]
}
```

#### WebSocket Endpoints

```bash
# WebSocket connection
ws://localhost:8080/ws?id=your-peer-id

# Message formats
{
  "type": "offer|answer|candidate",
  "to": "target-peer-id",
  "from": "source-peer-id",
  "sdp": {...},
  "candidate": {...}
}
```

### MediaMTX API

#### Stream Status

```bash
# API check
curl http://localhost:9997/v3/paths/list

# Stream info
curl http://localhost:9997/v3/paths/get/cam1
```

#### Stream Endpoints

```bash
# RTSP stream
rtsp://localhost:8554/cam1

# HLS stream
http://localhost:8888/cam1/index.m3u8

# WebRTC stream
http://localhost:8889/cam1/
```

## 🚀 Development

### Development Environment

```bash
# Start in development mode
cd webrtc-signaling && npm run dev   # Nodemon with auto-reload
cd pi-webrtc-audio && npm run dev    # Nodemon with auto-reload

# Start in debug mode
DEBUG=* npm start                    # All debug logs
DEBUG=webrtc:* npm start            # WebRTC logs only
```

### NPM Scripts

#### WebRTC Signaling Server

```bash
npm start           # Production mode
npm run dev         # Development mode
npm run health      # Health check
npm run peers       # Peer list
```

#### Pi WebRTC Audio Client

```bash
npm start           # Production mode
npm run dev         # Development mode
npm run test-audio  # Audio device test
npm run list-devices # List audio devices
npm run install-alsa # ALSA installation
```

### Testing Commands

```bash
# Audio system test
./test_microphone.sh

# WebRTC connection test
./debug_webrtc.sh

# Code update (to Pi)
./update_pi_code.sh

# Automatic fix
./fix_pi_audio.sh
```

## 📁 Project Structure

```
webrtc/
├── 📂 webrtc-signaling/          # WebSocket signaling server
│   ├── server.js                 # Main server file
│   ├── package.json              # Dependencies
│   └── config.example            # Example configuration
├── 📂 pi-webrtc-audio/           # Raspberry Pi WebRTC client
│   ├── index.js                  # Main client file
│   ├── package.json              # Dependencies
│   └── config.example            # Example configuration
├── 📂 rtsp_rtc/                  # MediaMTX video streaming
│   ├── mediamtx                  # MediaMTX binary
│   ├── mediamtx.yml              # MediaMTX configuration
│   └── LICENSE                   # MediaMTX license
├── 📄 index.html                 # Web client UI
├── 📄 ecosystem.config.js        # PM2 configuration
├── 🔧 start.sh                   # Automated startup script
├── 🔧 debug_webrtc.sh            # WebRTC debug script
├── 🔧 debug_pi_microphone.sh     # Microphone debug script
├── 🔧 fix_pi_audio.sh            # Audio system fix
├── 🔧 test_microphone.sh         # Microphone test script
├── 🔧 update_pi_code.sh          # Code update script
└── 📄 README.md                  # This file
```

## 🏗️ Technical Details

### WebRTC Implementation

- **Non-trickle ICE** gathering strategy
- **STUN/TURN** server support (optional)
- **Echo cancellation** and **noise suppression**
- **10ms audio chunks** for low latency
- **Graceful connection recovery**

### Audio Processing Pipeline

```
[Microphone] → [ALSA arecord] → [PCM Buffer] → [RTCAudioSource] → [WebRTC]
[WebRTC] → [RTCAudioSink] → [PCM Buffer] → [ALSA aplay] → [Speaker]
```

### Signaling Protocol

```json
{
	"type": "offer|answer|candidate|system",
	"from": "peer-id",
	"to": "target-peer-id",
	"sdp": { "type": "offer", "sdp": "..." },
	"candidate": { "candidate": "...", "sdpMid": "0" },
	"timestamp": 1640123456789
}
```

### Video Streaming Architecture

```
[IP Camera] → [RTSP] → [MediaMTX] → [HLS/WebRTC] → [Browser]
                          ↓
                    [FFmpeg Transcoding]
```

## 🚨 Security Notes

### Production Deployment

- Use **HTTPS** (WebRTC requirement)
- Configure **firewall** rules
- Add **authentication** (if needed)
- Implement **rate limiting**
- Use **SSL certificates**

### Network Security

```bash
# Firewall rules (on Pi)
sudo ufw allow 8080/tcp   # WebSocket
sudo ufw allow 8554/tcp   # RTSP
sudo ufw allow 8889/tcp   # WebRTC
sudo ufw enable
```

## 🎯 Performance Optimization

### For Low Latency

- **Sample rate:** 48kHz or 44.1kHz
- **Buffer size:** 480 samples (10ms)
- **Channel count:** 1 (mono)
- Use **TCP transport** (instead of UDP)

### Resource Optimization

```bash
# CPU optimization on Pi
echo performance | sudo tee /sys/devices/system/cpu/cpu*/cpufreq/scaling_governor

# Memory optimization
echo 1 | sudo tee /proc/sys/vm/drop_caches
```

## 📊 Monitoring

### Log Levels

- **INFO:** Normal operation logs
- **WARN:** Warning messages
- **ERROR:** Error conditions
- **DEBUG:** Detailed debug information

### Metrics to Monitor

- **Audio latency** (target: <50ms)
- **Packet loss** (target: <1%)
- **Connection uptime**
- **CPU/Memory usage**

## 🛠️ Advanced Configuration

### Custom STUN/TURN Servers

```javascript
// In Pi WebRTC client
const iceServers = [
	{ urls: 'stun:your-stun-server.com:3478' },
	{
		urls: 'turn:your-turn-server.com:3478',
		username: 'user',
		credential: 'pass',
	},
];
```

### Audio Quality Tuning

```bash
# For high quality audio
export SAMPLE_RATE=48000
export CHANNELS=2          # Stereo
export USE_AGC=1           # Auto Gain Control
export USE_AEC=1           # Acoustic Echo Cancellation
```

## 📝 License

**ISC License** - You can freely use, modify, and distribute this project.

## 🤝 Contributing

1. **Fork** the repository
2. Create a **feature branch** (`git checkout -b feature/amazing-feature`)
3. **Commit** your changes (`git commit -m 'Add amazing feature'`)
4. **Push** to the branch (`git push origin feature/amazing-feature`)
5. Open a **Pull Request**

## 🔗 Related Projects

- **WebRTC.org** - WebRTC standard
- **MediaMTX** - RTSP/WebRTC media server
- **node-webrtc** - Node.js WebRTC library
- **ALSA** - Advanced Linux Sound Architecture

## ❓ FAQ (Frequently Asked Questions)

**Q: Why is the audio delayed?**
A: Reduce buffer sizes, optimize sample rate, use TCP transport.

**Q: Microphone not detected?**
A: Check devices with `arecord -l`, configure ALSA mixer settings.

**Q: WebRTC connection not establishing?**
A: Enable STUN server, check firewall settings.

**Q: Video streaming not working?**
A: Ensure MediaMTX is running, check RTSP URL.

---

💡 **For more help:** Use the [Issues](issues) section or run the [debug scripts](debug_webrtc.sh).
