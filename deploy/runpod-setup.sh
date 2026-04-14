#!/bin/bash
# ─────────────────────────────────────────────────
# RunPod Quick Setup Script
# RTX 4090 GPU — YouTube Automation Pipeline
# ─────────────────────────────────────────────────
set -e

echo "═══════════════════════════════════════════"
echo "  YouTube Automation — RunPod Setup"
echo "═══════════════════════════════════════════"

# ─── Install Node.js 20 LTS ───
echo ""
echo "[1/6] Installing Node.js 20..."
if ! command -v node &> /dev/null; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
fi
echo "  Node.js $(node -v)"

# ─── Install yt-dlp ───
echo ""
echo "[2/6] Installing yt-dlp..."
if ! command -v yt-dlp &> /dev/null; then
  pip install -q yt-dlp 2>/dev/null || pip3 install -q yt-dlp 2>/dev/null || {
    curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp
    chmod a+rx /usr/local/bin/yt-dlp
  }
fi
echo "  yt-dlp $(yt-dlp --version 2>/dev/null || echo 'installed')"

# ─── Install FFmpeg with NVENC ───
echo ""
echo "[3/6] Installing FFmpeg with NVENC..."
if ! command -v ffmpeg &> /dev/null; then
  apt-get update -qq
  apt-get install -y --no-install-recommends ffmpeg
fi
# Verify NVENC
if ffmpeg -encoders 2>/dev/null | grep -q h264_nvenc; then
  echo "  FFmpeg NVENC ✓"
else
  echo "  WARNING: FFmpeg missing NVENC. Downloading BtbN build..."
  cd /tmp
  curl -L -o ffmpeg.tar.xz https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-n7.1-latest-linux64-gpl-7.1.tar.xz
  tar xf ffmpeg.tar.xz
  cp ffmpeg-n7.1-latest-linux64-gpl-7.1/bin/ff* /usr/local/bin/
  rm -rf ffmpeg.tar.xz ffmpeg-n7.1-*
  echo "  FFmpeg BtbN NVENC build installed ✓"
fi
echo "  $(ffmpeg -version 2>&1 | head -1)"

# ─── Install project dependencies ───
echo ""
echo "[4/6] Installing npm dependencies..."
cd /workspace/youtube-automation
npm install --production=false 2>&1 | tail -1

# ─── Verify GPU ───
echo ""
echo "[5/6] Checking GPU..."
nvidia-smi --query-gpu=name,driver_version,memory.total --format=csv,noheader 2>/dev/null || echo "  WARNING: nvidia-smi not found"

# Test NVENC
if ffmpeg -y -f lavfi -i nullsrc=s=64x64:d=0.1 -c:v h264_nvenc -f null - 2>/dev/null; then
  echo "  NVENC encoding test ✓"
else
  echo "  WARNING: NVENC test failed — will fall back to CPU"
fi

# ─── Start server ───
echo ""
echo "[6/6] Starting server..."

# Auto-detect RunPod pod ID for auto-stop feature
if [ -n "$RUNPOD_POD_ID" ]; then
  echo "  RunPod Pod ID: $RUNPOD_POD_ID"
  echo "  Auto-stop enabled: pod will stop 60s after render completes"
  # Inject into .env if not already set
  if ! grep -q "^RUNPOD_POD_ID=" .env 2>/dev/null || grep -q "^RUNPOD_POD_ID=$" .env 2>/dev/null; then
    sed -i "s/^RUNPOD_POD_ID=.*/RUNPOD_POD_ID=$RUNPOD_POD_ID/" .env
  fi
fi
echo ""
echo "═══════════════════════════════════════════"
echo "  Server starting on port 3000"
echo "  Access via RunPod proxy URL:"
echo "  https://{POD_ID}-3000.proxy.runpod.net"
echo "═══════════════════════════════════════════"
echo ""

npm run dev
