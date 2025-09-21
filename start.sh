#!/bin/bash

# WebRTC Audio Bridge Quick Start Script

echo "🚀 WebRTC Audio Bridge Launch Script"
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
    print_error "Node.js not found. Please install Node.js 14+."
    exit 1
fi

NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 14 ]; then
    print_error "Node.js version is too old. Node.js 14+ required."
    exit 1
fi

print_status "Detected Node.js $(node -v)"

# Function to install dependencies
install_deps() {
    local dir=$1
    local name=$2
    
    print_info "Checking dependencies for $name..."
    
    if [ -d "$dir" ]; then
        cd "$dir"
        if [ ! -d "node_modules" ] || [ ! -f "package-lock.json" ]; then
            print_info "Running npm install for $name..."
            npm install
            if [ $? -eq 0 ]; then
                print_status "$name dependencies installed"
            else
                print_error "$name dependency installation failed"
                return 1
            fi
        else
            print_status "$name dependencies already present"
        fi
        cd ..
    else
        print_error "Directory $dir not found"
        return 1
    fi
}

# Install dependencies for both projects
print_info "Checking shared dependencies..."
install_deps "webrtc-signaling" "Signaling Server"
install_deps "pi-webrtc-audio" "Raspberry Pi Client"

# Detect platform
if [[ "$OSTYPE" == "linux"* ]]; then
    print_info "Detected Linux platform"
    PLATFORM="linux"
elif [[ "$OSTYPE" == "darwin"* ]]; then
    print_info "Detected macOS platform"
    PLATFORM="macos"
else
    print_warning "Unknown platform: $OSTYPE"
    PLATFORM="unknown"
fi

# Menu for user selection
echo ""
print_info "Select an action"
echo "1) Start signaling server"
echo "2) Start Raspberry Pi client (Linux/RasPi)"
echo "3) Start both services (development mode)"
echo "4) Open web client"
echo "5) List audio devices (Linux/RasPi)"
echo "6) Run audio test (Linux/RasPi)"
echo "7) Exit"

read -p "Select an option (1-7): " choice

case $choice in
    1)
        print_info "Starting signaling server..."
        cd webrtc-signaling && npm start
        ;;
    2)
        if [[ "$PLATFORM" != "linux" ]]; then
            print_warning "Raspberry Pi client only runs on Linux"
            print_info "Use development mode on macOS/Windows for testing"
        fi
        print_info "Starting Raspberry Pi client..."
        cd pi-webrtc-audio && npm start
        ;;
    3)
        print_info "Starting both services..."
        print_warning "This mode is intended for development"
        
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
        
        print_status "Services started"
        print_info "Use Ctrl+C to stop"
        
        # Handle shutdown
        trap 'print_info "Stopping services..."; kill $SIGNALING_PID $PI_PID 2>/dev/null; exit 0' INT
        wait
        ;;
    4)
        print_info "Opening web client..."
        if command -v open &> /dev/null; then
            open index.html
        elif command -v xdg-open &> /dev/null; then
            xdg-open index.html
        else
            print_info "Open index.html in your browser manually"
            print_info "Or go to http://localhost:8080/index.html (if the signaling server is running)"
        fi
        ;;
    5)
        if [[ "$PLATFORM" == "linux" ]]; then
            print_info "Listing audio devices..."
            cd pi-webrtc-audio && npm run list-devices
        else
            print_warning "Audio device listing is only available on Linux"
        fi
        ;;
    6)
        if [[ "$PLATFORM" == "linux" ]]; then
            print_info "Running audio test..."
            cd pi-webrtc-audio && npm run test-audio
        else
            print_warning "Audio test is only available on Linux"
        fi
        ;;
    7)
        print_info "Exiting..."
        exit 0
        ;;
    *)
        print_error "Invalid selection"
        exit 1
        ;;
esac
