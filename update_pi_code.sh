#!/bin/bash

echo "🔄 Raspberry Pi kod güncelleme"
echo "=============================="

# Pi'ya güncellenmiş index.js kopyala
echo "Pi'ya güncellenmiş kod kopyalanıyor..."

# Method 1: SCP ile kopyala
if scp pi-webrtc-audio/index.js hbo@192.168.1.12:~/webrtc/pi-webrtc-audio/ 2>/dev/null; then
    echo "✅ Kod başarıyla kopyalandı"
else
    echo "❌ SCP başarısız, manuel kopyalama gerekli"
    echo ""
    echo "Manual olarak şunu yapın:"
    echo "1. Pi'da nano ~/webrtc/pi-webrtc-audio/index.js"
    echo "2. Dosyayı tamamen silin"
    echo "3. Aşağıdaki içeriği yapıştırın:"
    echo ""
    echo "=== KOD BAŞLANGICI ==="
    cat pi-webrtc-audio/index.js
    echo "=== KOD SONU ==="
fi

echo ""
echo "Pi'da şu komutları çalıştırın:"
echo ""
echo "1. Eski process'i durdurun:"
echo "   pkill -f 'node index.js'"
echo ""
echo "2. WebRTC client'ı debug modda başlatın:"
echo "   cd ~/webrtc/pi-webrtc-audio"
echo "   ARECORD_DEV=plughw:2,0 SPEAKER_DEV=plughw:2,0 node index.js"
echo ""
echo "3. Aşağıdaki logları görmelisiniz:"
echo "   - 'Audio track WebRTC'ye eklendi'"
echo "   - 'Mikrofon veri alındı: X bytes'"
echo ""
echo "4. Web'de de şu logları kontrol edin:"
echo "   - 'Uzak track geldi'"
echo "   - 'Ses seviyesi algılandı'"
