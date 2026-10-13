const fs = require('fs');
const path = require('path');

const DEFAULTS = {
  name: 'Mario',
  anthropicApiKey: '',
  model: 'claude-sonnet-5-5',
  timeZone: 'Asia/Kolkata',
  calendarId: 'primary',
  reminderLeadMinutes: 5,
  speak: true,
  voice: 'Zarvox',
  walkSpeed: 1.2,
  water: { enabled: true, everyMinutes: 60 },
  awake: { from: '07:00', to: '22:30' },
  whisperBin: '',
  whisperModel: '',
  boardUrl: '',
};

function merge(base, over) {
  const out = { ...base };
  for (const [k, v] of Object.entries(over || {})) {
    out[k] = v && typeof v === 'object' && !Array.isArray(v) && base[k] && typeof base[k] === 'object'
      ? { ...base[k], ...v } : v;
  }
  return out;
}

// v0.2: the sprout "Mochi" became the robot "Mario". Upgrade untouched old defaults only.
function migrate(user) {
  let changed = false;
  if (user.name === 'Mochi') { user.name = 'Mario'; changed = true; }
  if (user.voice === 'Samantha') { user.voice = 'Zarvox'; changed = true; }
  return changed;
}

function loadConfig(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'config.json');
  if (!fs.existsSync(file)) {
    fs.writeFileSync(file, JSON.stringify(DEFAULTS, null, 2), { mode: 0o600 });
  }
  let user = {};
  try { user = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { console.error('config.json is not valid JSON:', e.message); }
  if (migrate(user)) fs.writeFileSync(file, JSON.stringify(user, null, 2), { mode: 0o600 });
  const cfg = merge(DEFAULTS, user);
  if (process.env.ANTHROPIC_API_KEY) cfg.anthropicApiKey = process.env.ANTHROPIC_API_KEY;
  cfg._file = file;
  cfg._dir = dir;
  return cfg;
}

module.exports = { loadConfig, DEFAULTS, merge, migrate };
