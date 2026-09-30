#!/usr/bin/env bash
# One-time setup: node deps + headless Chromium + Python venv for beat analysis.
set -euo pipefail
cd "$(dirname "$0")"
command -v ffmpeg >/dev/null || { echo "install ffmpeg first: sudo apt install ffmpeg"; exit 1; }
npm install
npx playwright install chromium
python3 -m venv .venv && .venv/bin/pip install -q numpy librosa soundfile
echo "ready. try: ./studio list   ·   ./studio gui   ·   cd here && pi, then /skill:motion-reel"
