#!/bin/bash

CAMERAS=("192.168.77.105" "192.168.77.106" "192.168.77.107")
CAMERA_PORT="80"
MAX_WAIT=300
WAIT_TIME=0

echo "Waiting for cameras: ${CAMERAS[*]} (port $CAMERA_PORT)"

while [ $WAIT_TIME -lt $MAX_WAIT ]; do
    ALL_READY=true
    for cam in "${CAMERAS[@]}"; do
        if ! timeout 3 bash -c "cat < /dev/null > /dev/tcp/$cam/$CAMERA_PORT" 2>/dev/null; then
            echo "Camera $cam is not ready... ($WAIT_TIME seconds)"
            ALL_READY=false
        fi
    done

    if $ALL_READY; then
        echo "All cameras are ready! PM2 starting..."
        exit 0
    fi

    sleep 5
    WAIT_TIME=$((WAIT_TIME + 5))
done

echo "Warning: Not all cameras responded within $MAX_WAIT seconds, continuing anyway."
exit 0
