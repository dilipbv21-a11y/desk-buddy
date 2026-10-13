const fs = require('fs');
const path = require('path');

const DEFAULTS = {
  name: 'Mochi',
  anthropicApiKey: '',
  model: 'claude-sonnet-5-5',
  timeZone: 'Asia/Kolkata',
  calendarId: 'primary',
  reminderLeadMinutes: 5,
  speak: true,
  voice: 'Samantha',
  walkSpeed: 1.2,
  water: { enabled: true, everyMinutes: 60 },
  awake: { from: '07:00', to: '22:30' },
  whisperBin: '',
  whisperModel: '',
  boardUrl: 'https://claude.ai/artifact/TM6xqtxoobV27RE4z2qH9w',
};

function merge(base, over) {
  const out = { ...base };
  for (const [k, v] of Object.entries(over || {})) {
    out[k] = v && typeof v === 'object' && !Array.isArray(v) && base[k] && typeof base[k] === 'object'
      ? { ...base[k], ...v } : v;
  }
  return out;
}

function loadConfig(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'config.json');
  if (!fs.existsSync(file)) {
    fs.writeFileSync(file, JSON.stringify(DEFAULTS, null, 2), { mode: 0o600 });
  }
  let user = {};
  try { user = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { console.error('config.json is not valid JSON:', e.message); }
  const cfg = merge(DEFAULTS, user);
  if (process.env.ANTHROPIC_API_KEY) cfg.anthropicApiKey = process.env.ANTHROPIC_API_KEY;
  cfg._file = file;
  cfg._dir = dir;
  return cfg;
}

module.exports = { loadConfig, DEFAULTS, merge };
