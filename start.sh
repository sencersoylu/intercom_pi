#!/bin/bash

# WebRTC Audio Bridge Quick Start Script

echo "🚀 WebRTC Ses Köprüsü Başlatma Scripti"
echo "======================================="

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Function to print colored output
print_status() {
    echo -e "${GREEN}[OK]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

print_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    print_error "Node.js bulunamadı. Lütfen Node.js 14+ kurun."
    exit 1
fi

NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 14 ]; then
    print_error "Node.js versiyonu çok eski. Node.js 14+ gerekli."
    exit 1
fi

print_status "Node.js $(node -v) bulundu"

# Function to install dependencies
install_deps() {
    local dir=$1
    local name=$2
    
    print_info "$name için bağımlılıklar kontrol ediliyor..."
    
    if [ -d "$dir" ]; then
        cd "$dir"
        if [ ! -d "node_modules" ] || [ ! -f "package-lock.json" ]; then
            print_info "$name için npm install çalıştırılıyor..."
            npm install
            if [ $? -eq 0 ]; then
                print_status "$name bağımlılıkları yüklendi"
            else
                print_error "$name bağımlılık yüklemesi başarısız"
                return 1
            fi
        else
            print_status "$name bağımlılıkları zaten yüklü"
        fi
        cd ..
    else
        print_error "$dir dizini bulunamadı"
        return 1
    fi
}

# Install dependencies for both projects
print_info "Bağımlılıklar kontrol ediliyor..."
install_deps "webrtc-signaling" "Sinyalleme Sunucusu"
install_deps "pi-webrtc-audio" "Raspberry Pi Client"

# Detect platform
if [[ "$OSTYPE" == "linux"* ]]; then
    print_info "Linux platformu algılandı"
    PLATFORM="linux"
elif [[ "$OSTYPE" == "darwin"* ]]; then
    print_info "macOS platformu algılandı"
    PLATFORM="macos"
else
    print_warning "Bilinmeyen platform: $OSTYPE"
    PLATFORM="unknown"
fi

# Menu for user selection
echo ""
print_info "Ne yapmak istiyorsunuz?"
echo "1) Sinyalleme sunucusunu başlat"
echo "2) Raspberry Pi client'ını başlat (Linux/RasPi)"
echo "3) Her ikisini de başlat (geliştirme modu)"
echo "4) Web client'ı aç"
echo "5) Ses cihazlarını listele (Linux/RasPi)"
echo "6) Ses testi yap (Linux/RasPi)"
echo "7) Çıkış"

read -p "Seçiminizi yapın (1-7): " choice

case $choice in
    1)
        print_info "Sinyalleme sunucusu başlatılıyor..."
        cd webrtc-signaling && npm start
        ;;
    2)
        if [[ "$PLATFORM" != "linux" ]]; then
            print_warning "Raspberry Pi client sadece Linux üzerinde çalışır"
            print_info "macOS/Windows'ta test için geliştirme modunda çalıştırabilirsiniz"
        fi
        print_info "Raspberry Pi client başlatılıyor..."
        cd pi-webrtc-audio && npm start
        ;;
    3)
        print_info "Her iki servis de başlatılıyor..."
        print_warning "Bu mod geliştirme için uygundur"
        
        # Start signaling server in background
        cd webrtc-signaling
        npm start &
        SIGNALING_PID=$!
        cd ..
        
        sleep 2
        
        # Start pi client
        cd pi-webrtc-audio
        npm start &
        PI_PID=$!
        cd ..
        
        print_status "Servisler başlatıldı"
        print_info "Durdurmak için Ctrl+C kullanın"
        
        # Handle shutdown
        trap 'print_info "Servisler durduruluyor..."; kill $SIGNALING_PID $PI_PID 2>/dev/null; exit 0' INT
        wait
        ;;
    4)
        print_info "Web client açılıyor..."
        if command -v open &> /dev/null; then
            open index.html
        elif command -v xdg-open &> /dev/null; then
            xdg-open index.html
        else
            print_info "index.html dosyasını tarayıcınızda manuel olarak açın"
            print_info "Veya: http://localhost:8080/index.html (sinyalleme sunucusu çalışıyorsa)"
        fi
        ;;
    5)
        if [[ "$PLATFORM" == "linux" ]]; then
            print_info "Ses cihazları listeleniyor..."
            cd pi-webrtc-audio && npm run list-devices
        else
            print_warning "Ses cihazı listesi sadece Linux'ta kullanılabilir"
        fi
        ;;
    6)
        if [[ "$PLATFORM" == "linux" ]]; then
            print_info "Ses testi yapılıyor..."
            cd pi-webrtc-audio && npm run test-audio
        else
            print_warning "Ses testi sadece Linux'ta kullanılabilir"
        fi
        ;;
    7)
        print_info "Çıkılıyor..."
        exit 0
        ;;
    *)
        print_error "Geçersiz seçim"
        exit 1
        ;;
esac

