#!/bin/bash

# Fix Raspberry Pi Audio Issues

echo "🔧 Raspberry Pi Ses Sorunları Düzeltme Scripti"
echo "==============================================="

echo "1. Ses cihazlarını kontrol ediliyor..."
echo "Playback devices:"
aplay -l
echo ""
echo "Capture devices:"
arecord -l
echo ""

echo "2. Çalışan ses process'lerini kontrol ediliyor..."
ps aux | grep -E "(arecord|aplay|pulseaudio)" | grep -v grep

echo ""
echo "3. Ses process'lerini durduruyor..."
sudo pkill -f arecord
sudo pkill -f aplay
sudo pkill -f pulseaudio

echo ""
echo "4. ALSA ses kartını resetliyor..."
sudo /sbin/fuser -k /dev/snd/*
sudo alsa force-reload 2>/dev/null || echo "ALSA reload command not found, skipping..."

echo ""
echo "5. USB ses cihazını kontrol ediyor..."
lsusb | grep -i audio

echo ""
echo "6. ALSA config'ini kontrol ediyor..."
if [ -f ~/.asoundrc ]; then
    echo "~/.asoundrc mevcut:"
    cat ~/.asoundrc
else
    echo "~/.asoundrc bulunamadı"
fi

echo ""
echo "7. Önerilen .asoundrc yapılandırması:"
cat << 'EOF'
pcm.!default {
    type hw
    card 3
    device 0
}
ctl.!default {
    type hw
    card 3
}
EOF

echo ""
echo "8. Ses cihazını test ediyor..."
echo "Mikrofon testi (2 saniye)..."
if arecord -D plughw:3,0 -f S16_LE -r 48000 -c 1 -t wav -d 2 test.wav 2>/dev/null; then
    echo "✅ Mikrofon testi başarılı"
    echo "Hoparlör testi..."
    if aplay test.wav 2>/dev/null; then
        echo "✅ Hoparlör testi başarılı"
    else
        echo "❌ Hoparlör testi başarısız"
    fi
    rm -f test.wav
else
    echo "❌ Mikrofon testi başarısız"
fi

echo ""
echo "9. WebRTC için önerilen environment variables:"
echo "export ARECORD_DEV=plughw:3,0"
echo "export SPEAKER_DEV=plughw:3,0"
echo "export SAMPLE_RATE=48000"
echo "export CHANNELS=1"
echo ""

echo "10. WebRTC client'ı başlatmak için:"
echo "cd pi-webrtc-audio"
echo "ARECORD_DEV=plughw:3,0 SPEAKER_DEV=plughw:3,0 node index.js"
echo ""

echo "🎉 Düzeltme tamamlandı!"
