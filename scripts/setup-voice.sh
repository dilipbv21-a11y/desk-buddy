#!/usr/bin/env bash
# Installs on-device speech-to-text (whisper.cpp) and downloads a small English model.
set -euo pipefail

DIR="$HOME/Library/Application Support/desk-buddy/models"
MODEL="$DIR/ggml-base.en.bin"

if ! command -v brew >/dev/null 2>&1; then
  echo "Homebrew is required: https://brew.sh" >&2
  exit 1
fi

if ! command -v whisper-cli >/dev/null 2>&1 && ! command -v whisper-cpp >/dev/null 2>&1; then
  echo "Installing whisper.cpp…"
  brew install whisper-cpp
fi

mkdir -p "$DIR"
if [ ! -f "$MODEL" ]; then
  echo "Downloading the base.en model (~140 MB)…"
  curl -L --fail -o "$MODEL" "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin"
fi

echo "Voice is ready. Restart Desk Buddy and click it to talk."
