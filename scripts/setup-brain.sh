#!/usr/bin/env bash
# Installs Ollama and a small open model that fits this Mac's memory. Free, runs on-device.
set -euo pipefail

if ! command -v brew >/dev/null 2>&1; then
  echo "Homebrew is required: https://brew.sh" >&2
  exit 1
fi

if ! command -v ollama >/dev/null 2>&1; then
  echo "Installing Ollama…"
  brew install ollama
fi

echo "Starting Ollama in the background (it will also start at login)…"
brew services start ollama >/dev/null 2>&1 || true
for i in $(seq 1 20); do
  curl -s http://127.0.0.1:11434/api/tags >/dev/null 2>&1 && break
  sleep 1
done

RAM_GB=$(( $(sysctl -n hw.memsize) / 1073741824 ))
if [ "$RAM_GB" -ge 16 ]; then
  MODEL="qwen2.5:7b"     # ~4.7 GB download
else
  MODEL="qwen2.5:3b"     # ~1.9 GB download, fits 8 GB Macs
fi

echo "Your Mac has ${RAM_GB} GB of memory, so Mario gets ${MODEL}."
ollama pull "$MODEL"

echo
echo "Mario's brain is ready. Restart Desk Buddy (🤖 → Quit, then npm start) and click him."
