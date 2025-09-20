#!/bin/bash

echo "🎤 Raspberry Pi Mikrofon Debug Scripti"
echo "====================================="

echo "Bu scripti Raspberry Pi'da çalıştırın:"
echo ""

cat << 'EOF'
#!/bin/bash

echo "1. Ses cihazlarını listele:"
echo "Recording devices:"
arecord -l
echo ""
echo "Playback devices:"
aplay -l
echo ""

echo "2. USB ses cihazını kontrol et:"
lsusb | grep -i audio
echo ""

echo "3. ALSA mixer durumunu kontrol et:"
amixer scontrols
echo ""

echo "4. Mikrofon seviyelerini göster:"
amixer get Mic 2>/dev/null || echo "Mic kontrolü bulunamadı"
amixer get Capture 2>/dev/null || echo "Capture kontrolü bulunamadı"
amixer get 'Mic Capture' 2>/dev/null || echo "Mic Capture kontrolü bulunamadı"
echo ""

echo "5. Mikrofon seviyelerini ayarla:"
echo "Mikrofon seviyelerini %80'e ayarlıyor..."
amixer set Mic 80% 2>/dev/null || echo "Mic kontrolü ayarlanamadı"
amixer set Capture 80% 2>/dev/null || echo "Capture kontrolü ayarlanamadı"
amixer set 'Mic Capture' 80% 2>/dev/null || echo "Mic Capture kontrolü ayarlanamadı"
echo ""

echo "6. Mikrofon cihazını test et:"
echo "3 saniye mikrofon testi..."
if arecord -D plughw:2,0 -f S16_LE -r 48000 -c 1 -t wav -d 3 mic_test.wav 2>/dev/null; then
    echo "✅ Mikrofon kaydı başarılı"
    echo "Dosya boyutu: $(du -h mic_test.wav | cut -f1)"
    
    echo ""
    echo "7. Kaydedilen sesi oynat:"
    aplay mic_test.wav
    echo ""
    echo "Sesinizi duydunuz mu? (y/n):"
    read -r heard_sound
    
    if [[ "$heard_sound" == "y" || "$heard_sound" == "Y" ]]; then
        echo "✅ Mikrofon ve hoparlör çalışıyor"
    else
        echo "❌ Ses problemi var"
        echo ""
        echo "Mikrofon seviyelerini daha yüksek ayarlayın:"
        echo "alsamixer"
        echo "F4 tuşuna basın, seviyeyi artırın"
    fi
    
    rm -f mic_test.wav
else
    echo "❌ Mikrofon testi başarısız"
    echo ""
    echo "Alternatif cihazları deneyin:"
    echo "arecord -D plughw:0,0 -f S16_LE -r 48000 -c 1 -t wav -d 3 test.wav"
    echo "arecord -D plughw:1,0 -f S16_LE -r 48000 -c 1 -t wav -d 3 test.wav"
    echo "arecord -D plughw:3,0 -f S16_LE -r 48000 -c 1 -t wav -d 3 test.wav"
fi

echo ""
echo "8. Real-time mikrofon seviyesi kontrolü:"
echo "Mikrofonunuza konuşun, Ctrl+C ile durdurun:"
echo ""
timeout 10s arecord -D plughw:2,0 -f S16_LE -r 48000 -c 1 -t raw | hexdump -C | head -20
echo ""
echo "Eğer sadece '0000 0000' gördüyseniz mikrofon sessiz"
echo "Eğer değişen sayılar gördüyseniz mikrofon çalışıyor"

echo ""
echo "9. WebRTC için önerilen ayarlar:"
echo "export ARECORD_DEV=plughw:2,0"
echo "export SPEAKER_DEV=plughw:2,0"
echo ""

echo "10. alsamixer ile manuel ayar:"
echo "alsamixer"
echo "F4 tuşu: Recording controls"
echo "↑↓ tuşları: Seviye ayarla"
echo "M tuşu: Mute/unmute"
echo ""

echo "11. WebRTC client'ı test için başlat:"
echo "cd ~/webrtc/pi-webrtc-audio"
echo "ARECORD_DEV=plughw:2,0 SPEAKER_DEV=plughw:2,0 node index.js"

EOF

echo ""
echo "Yukarıdaki scripti Raspberry Pi'da çalıştırmak için:"
echo ""
echo "1. Pi'da yeni bir dosya oluşturun:"
echo "   nano ~/debug_mic.sh"
echo ""
echo "2. Yukarıdaki kodu kopyalayıp yapıştırın"
echo ""
echo "3. Executable yapın ve çalıştırın:"
echo "   chmod +x ~/debug_mic.sh"
echo "   ./debug_mic.sh"
echo ""

echo "🔧 Hızlı çözümler:"
echo ""
echo "1. Mikrofon seviyelerini artırın:"
echo "   ssh pi@192.168.1.12 'alsamixer'"
echo ""
echo "2. USB ses kartını reset edin:"
echo "   ssh pi@192.168.1.12 'sudo rmmod snd_usb_audio && sudo modprobe snd_usb_audio'"
echo ""
echo "3. WebRTC client'ı doğru ayarlarla başlatın:"
echo "   ssh pi@192.168.1.12 'cd ~/webrtc/pi-webrtc-audio && ARECORD_DEV=plughw:2,0 SPEAKER_DEV=plughw:2,0 node index.js'"
