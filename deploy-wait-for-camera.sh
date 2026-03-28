#!/bin/bash

# Raspberry Pi'ye wait-for-camera.sh scriptini deploy eder
# ve pm2-root systemd servisine ExecStartPre olarak ekler

PI_HOST="192.168.77.100"
PI_USER="soyluhbo"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SCRIPT_SRC="$SCRIPT_DIR/wait-for-camera.sh"

if [ ! -f "$SCRIPT_SRC" ]; then
    echo "HATA: $SCRIPT_SRC bulunamadi!"
    exit 1
fi

echo "Raspberry Pi'ye baglaniliyor ($PI_USER@$PI_HOST)..."

# 1. Scripti kopyala ve calistir yetkisi ver
echo "[1/3] wait-for-camera.sh kopyalaniyor..."
cat "$SCRIPT_SRC" | ssh "$PI_USER@$PI_HOST" "sudo tee /usr/local/bin/wait-for-camera.sh > /dev/null && sudo chmod +x /usr/local/bin/wait-for-camera.sh"

if [ $? -ne 0 ]; then
    echo "HATA: Script kopyalanamadi!"
    exit 1
fi
echo "  -> /usr/local/bin/wait-for-camera.sh olusturuldu"

# 2. systemd override olustur
echo "[2/3] systemd override olusturuluyor..."
ssh "$PI_USER@$PI_HOST" "sudo mkdir -p /etc/systemd/system/pm2-root.service.d && echo -e '[Service]\nExecStartPre=/usr/local/bin/wait-for-camera.sh' | sudo tee /etc/systemd/system/pm2-root.service.d/override.conf > /dev/null"

if [ $? -ne 0 ]; then
    echo "HATA: systemd override olusturulamadi!"
    exit 1
fi
echo "  -> override.conf olusturuldu"

# 3. systemd daemon reload
echo "[3/3] systemd daemon reload..."
ssh "$PI_USER@$PI_HOST" "sudo systemctl daemon-reload"

if [ $? -ne 0 ]; then
    echo "HATA: daemon-reload basarisiz!"
    exit 1
fi

echo ""
echo "Deploy tamamlandi!"
echo "Pi yeniden basladiginda pm2 servisi kamera hazir olana kadar bekleyecek."
echo "Test icin: ssh $PI_USER@$PI_HOST 'sudo systemctl restart pm2-root'"
