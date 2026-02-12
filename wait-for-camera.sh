#!/bin/bash

CAMERA_IP="192.168.77.105"  
CAMERA_PORT="80"           
MAX_WAIT=300
WAIT_TIME=0

echo "Waiting for camera: $CAMERA_IP:$CAMERA_PORT"

while [ $WAIT_TIME -lt $MAX_WAIT ]; do
    if timeout 3 bash -c "cat < /dev/null > /dev/tcp/$CAMERA_IP/$CAMERA_PORT" 2>
        echo "Camera is ready! PM2 starting..."
        exit 0
    fi
    
    echo "Camera is not ready... ($WAIT_TIME seconds)"
    sleep 5
    WAIT_TIME=$((WAIT_TIME + 5))
done

echo "Warning: Camera did not respond within $MAX_WAIT seconds, continuing anyw>
exit 0
