# WebRTC Ses Köprüsü

Web tarayıcısı ile Raspberry Pi arasında gerçek zamanlı ses iletişimi sağlayan kapsamlı WebRTC uygulaması. Bu proje, modern web teknolojileri kullanarak düşük gecikmeli ses iletişimi kurar.

## 🚀 Özellikler

### WebRTC Ses İletişimi
- ✅ **Web tarayıcısı ↔ Raspberry Pi** çift yönlü ses iletişimi
- ✅ **Non-trickle ICE** desteği (tüm ICE adayları toplandıktan sonra gönderim)
- ✅ **Düşük gecikme** ses aktarımı (10ms chunk'lar)
- ✅ **Otomatik yeniden bağlanma** mekanizması
- ✅ **Graceful shutdown** ve hata kurtarma

### Ses İşleme
- ✅ **ALSA ses desteği** (Raspberry Pi)
- ✅ **USB ses kartı** desteği
- ✅ **Yapılandırılabilir ses cihazları** (mikrofon/hoparlör)
- ✅ **48kHz, 16-bit, Mono** ses kalitesi
- ✅ **Echo cancellation** ve **noise suppression**
- ✅ **Real-time ses seviyesi** izleme

### Sinyalleme ve Ağ
- ✅ **WebSocket tabanlı** sinyalleme sunucusu
- ✅ **Health check** ve **peer monitoring** endpoint'leri
- ✅ **CORS desteği** ve güvenlik
- ✅ **STUN sunucu** desteği (isteğe bağlı)
- ✅ **Firewall friendly** TCP öncelikli bağlantı

### Video Streaming (MediaMTX)
- ✅ **RTSP/RTMP/WebRTC** video streaming
- ✅ **IP kamera** desteği
- ✅ **HLS** ve **Low-Latency HLS**
- ✅ **On-demand** video transcoding
- ✅ **Multi-protocol** destek

### Geliştirici Araçları
- ✅ **Kapsamlı debug scriptleri**
- ✅ **Ses cihazı test** araçları
- ✅ **Otomatik kurulum** scriptleri
- ✅ **PM2 ecosystem** konfigürasyonu
- ✅ **Comprehensive logging**

## Gereksinimler

### Raspberry Pi

- Node.js 14+
- ALSA (ses kartı)
- USB/3.5mm mikrofon ve hoparlör

### Web Client

- Modern web tarayıcısı (Chrome, Firefox, Safari, Edge)
- Mikrofon erişimi

## Kurulum

### 1. Sinyalleme Sunucusu

```bash
cd webrtc-signaling
npm install
npm start
```

### 2. Raspberry Pi Client

```bash
cd pi-webrtc-audio
npm install

# ALSA kurulumu (gerekirse)
npm run install-alsa

# Ses cihazlarını listele
npm run list-devices

# Test et
npm run test-audio

# Başlat
npm start
```

### 3. Web Client

`index.html` dosyasını web tarayıcısında açın veya sinyalleme sunucusu üzerinden erişin:

```
http://localhost:8080/index.html
```

## Konfigürasyon

### Environment Variables

#### Raspberry Pi (`pi-webrtc-audio`)

```bash
export SIGNALING_URL="ws://192.168.1.12:8080/ws"
export PEER_ID="raspi-1"
export ARECORD_DEV="plughw:3,0"     # Mikrofon cihazı
export SPEAKER_DEV="plughw:3,0"     # Hoparlör cihazı
export SAMPLE_RATE="48000"          # Örnekleme hızı
export CHANNELS="1"                 # Kanal sayısı (mono)
export USE_STUN="0"                 # STUN sunucu kullanımı
export RECONNECT_DELAY="1500"       # Yeniden bağlanma gecikmesi (ms)
```

#### Sinyalleme Sunucusu (`webrtc-signaling`)

```bash
export PORT="8080"
export HOST="0.0.0.0"
```

### Ses Cihazı Yapılandırması

Raspberry Pi'da ses cihazlarınızı kontrol edin:

```bash
# Playback devices
aplay -l

# Recording devices
arecord -l

# Test recording
arecord -D plughw:3,0 -f S16_LE -r 48000 -c 1 -t wav -d 5 test.wav

# Test playback
aplay test.wav
```

## Kullanım

1. **Sinyalleme sunucusunu başlatın**
2. **Raspberry Pi client'ını başlatın**
3. **Web tarayıcısında index.html'i açın**
4. **Doğru sinyalleme URL'sini girin**
5. **Peer ID'lerini kontrol edin** (web-1 ↔ raspi-1)
6. **"Bağlan" butonuna tıklayın**

## Troubleshooting

### Ses Sorunları

```bash
# ALSA mixing yeniden başlatma
sudo service alsa-state restart

# Ses seviyesi kontrolü
alsamixer

# Cihaz test
speaker-test -c 1 -t wav
```

### Bağlantı Sorunları

- **Firewall**: Port 8080'in açık olduğundan emin olun
- **Network**: Tüm cihazlar aynı ağda olmalı
- **STUN**: İnternet bağlantısı gerekirse `USE_STUN=1` yapın

### Log Kontrolü

```bash
# Raspberry Pi logs
npm start 2>&1 | tee webrtc.log

# Signaling server logs
cd webrtc-signaling && npm start 2>&1 | tee signaling.log
```

## API Endpoints

### Health Check

```bash
curl http://localhost:8080/health
```

### Connected Peers

```bash
curl http://localhost:8080/peers
```

## Geliştirme

### Development Mode

```bash
# Sinyalleme sunucusu
cd webrtc-signaling && npm run dev

# Raspberry Pi
cd pi-webrtc-audio && npm run dev
```

### Audio Testing

```bash
# Pi'da ses test
cd pi-webrtc-audio && npm run test-audio

# Cihaz listesi
npm run list-devices
```

## Sorun Giderme

### Yaygın Hatalar

1. **"Mikrofon erişimi reddedildi"**

   - Tarayıcı mikrofon izni verin
   - HTTPS üzerinden erişim gerekebilir

2. **"ALSA: Connection refused"**

   - Ses kartı doğru takılı değil
   - Device path'i kontrol edin

3. **"WebSocket connection failed"**

   - Sinyalleme sunucusu çalışıyor mu?
   - IP adresi ve port doğru mu?

4. **"Peer unavailable"**
   - Raspberry Pi client çalışıyor mu?
   - Peer ID'ler eşleşiyor mu?

### Performance Tips

- Düşük latency için buffer boyutlarını ayarlayın
- Network kalitesine göre sample rate'i optimize edin
- STUN sunucularını sadece gerekirse kullanın

## Lisans

ISC License - Özgürce kullanabilirsiniz.
