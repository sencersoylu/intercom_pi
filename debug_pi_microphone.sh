#!/bin/bash

echo "🎤 Raspberry Pi Microphone Debug Script"
echo "====================================="

echo "Run this script on a Raspberry Pi:"
echo ""

cat <<'INNER'
#!/bin/bash

echo "1. List audio devices:"
echo "Recording devices:"
arecord -l
echo ""
echo "Playback devices:"
aplay -l
echo ""

echo "2. Check USB audio devices:"
lsusb | grep -i audio
echo ""

echo "3. Inspect ALSA mixer controls:"
amixer scontrols
echo ""

echo "4. Show microphone levels:"
amixer get Mic 2>/dev/null || echo "Mic control not found"
amixer get Capture 2>/dev/null || echo "Capture control not found"
amixer get 'Mic Capture' 2>/dev/null || echo "Mic Capture control not found"
echo ""

echo "5. Set microphone levels:"
echo "Setting microphone levels to 80%..."
amixer set Mic 80% 2>/dev/null || echo "Unable to set Mic control"
amixer set Capture 80% 2>/dev/null || echo "Unable to set Capture control"
amixer set 'Mic Capture' 80% 2>/dev/null || echo "Unable to set Mic Capture control"
echo ""

echo "6. Test the microphone device:"
echo "Recording a 3-second microphone sample..."
if arecord -D plughw:2,0 -f S16_LE -r 48000 -c 1 -t wav -d 3 mic_test.wav 2>/dev/null; then
    echo "✅ Microphone recording succeeded"
    echo "File size: $(du -h mic_test.wav | cut -f1)"
    
    echo ""
    echo "7. Play the recorded audio:"
    aplay mic_test.wav
    echo ""
    echo "Did you hear your voice? (y/n):"
    read -r heard_sound
    
    if [[ "$heard_sound" == "y" || "$heard_sound" == "Y" ]]; then
        echo "✅ Microphone and speaker are working"
    else
        echo "❌ Audio issue detected"
        echo ""
        echo "Increase microphone levels in alsamixer:"
        echo "alsamixer"
        echo "Press F4, then raise the capture levels"
    fi
    
    rm -f mic_test.wav
else
    echo "❌ Microphone test failed"
    echo ""
    echo "Try alternate devices:"
    echo "arecord -D plughw:0,0 -f S16_LE -r 48000 -c 1 -t wav -d 3 test.wav"
    echo "arecord -D plughw:1,0 -f S16_LE -r 48000 -c 1 -t wav -d 3 test.wav"
    echo "arecord -D plughw:3,0 -f S16_LE -r 48000 -c 1 -t wav -d 3 test.wav"
fi

echo ""
echo "8. Monitor microphone levels in real time:"
echo "Speak into the microphone, stop with Ctrl+C:"
echo ""
timeout 10s arecord -D plughw:2,0 -f S16_LE -r 48000 -c 1 -t raw | hexdump -C | head -20
echo ""
echo "If you only see '0000 0000' the microphone is silent"
echo "If the numbers change, the microphone is active"

echo ""
echo "9. Recommended WebRTC settings:"
echo "export ARECORD_DEV=plughw:2,0"
echo "export SPEAKER_DEV=plughw:2,0"
echo ""

echo "10. Manual tuning with alsamixer:"
echo "alsamixer"
echo "F4 key: Recording controls"
echo "Up/Down keys: Adjust level"
echo "M key: Mute/unmute"
echo ""

echo "11. Start the WebRTC client for testing:"
echo "cd ~/webrtc/pi-webrtc-audio"
echo "ARECORD_DEV=plughw:2,0 SPEAKER_DEV=plughw:2,0 node index.js"
INNER

echo ""
echo "To run the script above on the Raspberry Pi:"
echo ""
echo "1. Create a new file on the Pi:"
echo "   nano ~/debug_mic.sh"
echo ""
echo "2. Copy and paste the code above"
echo ""
echo "3. Make it executable and run it:"
echo "   chmod +x ~/debug_mic.sh"
echo "   ./debug_mic.sh"
echo ""

echo "🔧 Quick fixes:"
echo ""
echo "1. Raise microphone levels:"
echo "   ssh pi@192.168.1.12 'alsamixer'"
echo ""
echo "2. Reset the USB sound card:"
echo "   ssh pi@192.168.1.12 'sudo rmmod snd_usb_audio && sudo modprobe snd_usb_audio'"
echo ""
echo "3. Start the WebRTC client with the correct settings:"
echo "   ssh pi@192.168.1.12 'cd ~/webrtc/pi-webrtc-audio && ARECORD_DEV=plughw:2,0 SPEAKER_DEV=plughw:2,0 node index.js'"
