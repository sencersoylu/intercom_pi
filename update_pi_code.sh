#!/bin/bash

echo "🔄 Raspberry Pi code update"
echo "============================"

echo "Copying the updated code to the Pi..."

# Method 1: copy with SCP
if scp pi-webrtc-audio/index.js hbo@192.168.1.12:~/webrtc/pi-webrtc-audio/ 2>/dev/null; then
    echo "✅ Code copied successfully"
else
    echo "❌ SCP failed; manual copy required"
    echo ""
    echo "Perform the following manually:"
    echo "1. On the Pi run: nano ~/webrtc/pi-webrtc-audio/index.js"
    echo "2. Clear the file contents"
    echo "3. Paste the content shown below"
    echo ""
    echo "=== BEGIN CODE ==="
    cat pi-webrtc-audio/index.js
    echo "=== END CODE ==="
fi

echo ""
echo "Run these commands on the Pi:"
echo ""
echo "1. Stop the existing process:"
echo "   pkill -f 'node index.js'"


echo "2. Start the WebRTC client in debug mode:"
echo "   cd ~/webrtc/pi-webrtc-audio"
echo "   ARECORD_DEV=plughw:2,0 SPEAKER_DEV=plughw:2,0 node index.js"

echo ""
echo "3. You should see logs similar to:"
echo "   - 'Audio track added to WebRTC'"
echo "   - 'Microphone data received: X bytes'"

echo ""
echo "4. In the web UI verify logs such as:"
echo "   - 'Remote track received'"
echo "   - 'Audio level detected'"
