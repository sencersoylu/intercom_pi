#!/bin/bash

# WebRTC Debug Script

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

print_status() { echo -e "${GREEN}[OK]${NC} $1"; }
print_warning() { echo -e "${YELLOW}[WARNING]${NC} $1"; }
print_error() { echo -e "${RED}[ERROR]${NC} $1"; }
print_info() { echo -e "${BLUE}[INFO]${NC} $1"; }

echo "🔍 WebRTC Bağlantı Sorunları Debug"
echo "=================================="

# 1. Signaling server kontrolü
print_info "1. Sinyalleme sunucusu kontrol ediliyor..."
if curl -s http://192.168.1.12:8080/health > /dev/null 2>&1; then
    print_status "Sinyalleme sunucusu çalışıyor"
    curl -s http://192.168.1.12:8080/health | jq . 2>/dev/null || echo "Health check yanıtı alındı"
else
    print_error "Sinyalleme sunucusuna erişilemiyor!"
    print_info "Çözüm: cd webrtc-signaling && npm start"
    exit 1
fi

# 2. Peer listesi kontrol
print_info "2. Bağlı peer'lar kontrol ediliyor..."
PEERS=$(curl -s http://192.168.1.12:8080/peers 2>/dev/null)
if [ $? -eq 0 ]; then
    print_status "Peer listesi alındı:"
    echo "$PEERS" | jq . 2>/dev/null || echo "$PEERS"
else
    print_warning "Peer listesi alınamadı"
fi

# 3. Network connectivity
print_info "3. Network bağlantısı kontrol ediliyor..."
if ping -c 1 192.168.1.12 > /dev/null 2>&1; then
    print_status "Pi ile network bağlantısı OK"
else
    print_error "Pi'ye ping atılamıyor!"
    print_info "IP adresini kontrol edin: 192.168.1.12"
fi

# 4. Port kontrolü
print_info "4. WebSocket portu kontrol ediliyor..."
if nc -z 192.168.1.12 8080 2>/dev/null; then
    print_status "Port 8080 açık"
else
    print_warning "Port 8080'e erişilemiyor"
fi

# 5. Pi'da process kontrolü (ssh gerekli)
print_info "5. Raspberry Pi kontrolleri"
print_warning "Raspberry Pi'da aşağıdaki komutları çalıştırın:"
echo ""
echo "# Pi'da sinyalleme sunucusu logları:"
echo "curl -s http://localhost:8080/health"
echo ""
echo "# Pi WebRTC client durumu:"
echo "cd pi-webrtc-audio"
echo "ps aux | grep node"
echo ""
echo "# Pi'da ses cihazları:"
echo "aplay -l"
echo "arecord -l"
echo ""
echo "# Pi'da mikrofon testi:"
echo "arecord -D plughw:3,0 -f S16_LE -r 48000 -c 1 -t wav -d 2 test.wav"
echo "aplay test.wav"
echo ""

# 6. Yaygın sorunlar ve çözümler
print_info "6. Yaygın Sorunlar ve Çözümler:"
echo ""
print_warning "SORUN: Web'de 'connecting' durumunda takılı"
print_info "Çözüm 1: Pi'da WebRTC client'ı başlatın:"
echo "  cd pi-webrtc-audio && npm start"
echo ""
print_info "Çözüm 2: Pi'da ses cihazı ayarları:"
echo "  export ARECORD_DEV=plughw:0,0"
echo "  export SPEAKER_DEV=plughw:0,0"
echo ""
print_info "Çözüm 3: Pi'da STUN sunucu etkinleştirin:"
echo "  export USE_STUN=1"
echo ""

print_warning "SORUN: Audio erişim hatası"
print_info "Çözüm: Pi'da ALSA konfigürasyonu:"
echo "  sudo apt-get update && sudo apt-get install -y alsa-utils"
echo "  alsamixer  # ses seviyelerini ayarlayın"
echo ""

print_warning "SORUN: Permission denied"
print_info "Çözüm: Pi'da kullanıcı ses grubuna ekleyin:"
echo "  sudo usermod -a -G audio \$USER"
echo "  # Sonra logout/login yapın"
echo ""

# 7. Real-time debug komutu
print_info "7. Real-time Debug:"
echo ""
echo "# Pi'da WebRTC client'ı debug modunda başlatın:"
echo "cd pi-webrtc-audio"
echo "DEBUG=* npm start"
echo ""
echo "# Veya verbose modda:"
echo "node index.js 2>&1 | tee webrtc-debug.log"
echo ""

# 8. Test senaryosu
print_info "8. Önerilen Test Senaryosu:"
echo ""
echo "1. Pi'da önce sinyalleme sunucusunu başlatın:"
echo "   cd webrtc-signaling && npm start"
echo ""
echo "2. Pi'da ses cihazlarını test edin:"
echo "   cd pi-webrtc-audio && npm run test-audio"
echo ""
echo "3. Pi'da WebRTC client'ı başlatın:"
echo "   cd pi-webrtc-audio && npm start"
echo ""
echo "4. Web'de bağlantıyı deneyin"
echo ""
echo "5. Her iki tarafın loglarını da izleyin"
echo ""

print_info "Daha detaylı debug için aşağıdaki komutu Pi'da çalıştırın:"
echo "cd pi-webrtc-audio && SIGNALING_URL=ws://192.168.1.12:8080/ws PEER_ID=raspi-1 node index.js"
