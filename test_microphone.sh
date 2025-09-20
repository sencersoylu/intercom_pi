#!/bin/bash

echo "🎤 Raspberry Pi Mikrofon Test Scripti"
echo "===================================="

echo "1. Ses cihazlarını kontrol ediliyor..."
echo "Recording devices:"
arecord -l

echo ""
echo "2. Mikrofon seviyesini test ediliyor..."
echo "5 saniye mikrofon testi başlıyor..."
arecord -D plughw:2,0 -f S16_LE -r 48000 -c 1 -t wav -d 5 mic_test.wav

if [ -f mic_test.wav ]; then
    echo "✅ Mikrofon testi başarılı"
    echo "Dosya boyutu: $(du -h mic_test.wav)"
    
    echo ""
    echo "3. Ses dosyasını analiz ediliyor..."
    if command -v sox >/dev/null 2>&1; then
        sox mic_test.wav -n stat
    else
        echo "Sox yüklü değil, basic analiz:"
        ls -la mic_test.wav
    fi
    
    echo ""
    echo "4. Ses dosyasını dinleme testi..."
    echo "Ses dosyası çalınıyor..."
    aplay mic_test.wav
    
    echo ""
    echo "Ses geldi mi? (y/n):"
    read -r response
    if [[ "$response" == "y" || "$response" == "Y" ]]; then
        echo "✅ Mikrofon ve hoparlör çalışıyor"
    else
        echo "❌ Ses sistemi problemi var"
    fi
    
    rm -f mic_test.wav
else
    echo "❌ Mikrofon testi başarısız"
fi

echo ""
echo "5. ALSA mixer seviyelerini kontrol ediliyor..."
amixer scontrols

echo ""
echo "6. USB ses cihazını kontrol ediliyor..."
lsusb | grep -i audio

echo ""
echo "7. Mikrofon için önerilen ayarlar:"
echo "amixer set Mic 80%"
echo "amixer set Capture 80%"
echo "amixer set 'Mic Capture' 80%"

echo ""
echo "8. Real-time mikrofon seviyesi testi:"
echo "arecord -D plughw:2,0 -f S16_LE -r 48000 -c 1 -t raw | hexdump -C | head -20"
echo ""
echo "Eğer sadece 0000 görürseniz, mikrofon sessizdir."
echo "Eğer değişen sayılar görürseniz, mikrofon çalışıyordur."
