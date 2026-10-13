// Speech in and out, both on-device on macOS:
//  - listening: whisper.cpp (brew install whisper-cpp) transcribes a WAV the renderer recorded
//  - talking: the built-in `say` command
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile, spawn } = require('child_process');

const BIN_CANDIDATES = [
  '/opt/homebrew/bin/whisper-cli', '/usr/local/bin/whisper-cli',
  '/opt/homebrew/bin/whisper-cpp', '/usr/local/bin/whisper-cpp',
];

function findWhisper(cfg) {
  const bin = cfg.whisperBin || BIN_CANDIDATES.find(p => fs.existsSync(p));
  const model = cfg.whisperModel || path.join(cfg._dir, 'models', 'ggml-base.en.bin');
  if (!bin || !fs.existsSync(bin) || !fs.existsSync(model)) return null;
  return { bin, model };
}

function cleanTranscript(s) {
  return String(s)
    .replace(/\[[^\]]*\]|\([^)]*\)/g, ' ') // [BLANK_AUDIO], (music) etc.
    .replace(/\s+/g, ' ')
    .trim();
}

function transcribe(cfg, wavBuffer) {
  const w = findWhisper(cfg);
  if (!w) return Promise.reject(new Error('Voice is not set up. Run "npm run setup:voice".'));
  const file = path.join(os.tmpdir(), `buddy-${Date.now()}.wav`);
  fs.writeFileSync(file, Buffer.from(wavBuffer));
  return new Promise((resolve, reject) => {
    execFile(w.bin, ['-m', w.model, '-f', file, '-l', 'en', '-nt', '-np'], { timeout: 60000 }, (err, stdout) => {
      fs.rmSync(file, { force: true });
      if (err) return reject(err);
      resolve(cleanTranscript(stdout));
    });
  });
}

let sayProc = null;
function speak(cfg, text) {
  stopSpeaking();
  if (!cfg.speak || process.platform !== 'darwin' || !text) return;
  sayProc = spawn('say', ['-v', cfg.voice || 'Samantha', '-r', '195', text], { stdio: 'ignore' });
  sayProc.on('error', () => {});
}
function stopSpeaking() { if (sayProc) { sayProc.kill(); sayProc = null; } }

module.exports = { findWhisper, transcribe, cleanTranscript, speak, stopSpeaking };
