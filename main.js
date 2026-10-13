const path = require('path');
const fs = require('fs');
const { app, BrowserWindow, ipcMain, screen, Menu, Tray, nativeImage, shell, Notification, systemPreferences } = require('electron');
const Anthropic = require('@anthropic-ai/sdk');
const { loadConfig } = require('./src/config');
const { Calendar } = require('./src/calendar');
const { makeHandlers } = require('./src/tools');
const { runAgent, systemPrompt } = require('./src/agent');
const { runOllamaAgent, BrainOffline } = require('./src/ollama');
const { journaled } = require('./src/journal');
const { dueReminders, waterDue, WATER_LINES } = require('./src/reminders');
const { inWindow } = require('./src/time');
const speech = require('./src/speech');

app.setPath('userData', path.join(app.getPath('appData'), 'desk-buddy'));
if (!app.requestSingleInstanceLock()) app.quit();

const W = 300, H = 420;
let cfg, calendar, win, tray;
let history = [];
let events = [];
const fired = new Set();
let lastWater = null;

// ---------- walking ----------
const walk = { x: 0, dir: 1, mode: 'walk', until: 0, paused: false, busy: false, sent: '' };

function workArea() { return screen.getPrimaryDisplay().workArea; }
function asleep() { return !inWindow(new Date(), cfg.timeZone, cfg.awake.from, cfg.awake.to); }

function sendState() {
  const mode = asleep() ? 'sleep' : walk.busy ? 'busy' : walk.mode;
  const key = `${mode}:${walk.dir}`;
  if (key !== walk.sent && win) { walk.sent = key; win.webContents.send('buddy:state', { mode, dir: walk.dir }); }
}

function tick() {
  if (!win || win.isDestroyed()) return;
  const wa = workArea();
  const y = wa.y + wa.height - H;
  const now = Date.now();
  const still = walk.paused || walk.busy || asleep();
  if (!still) {
    if (walk.mode === 'walk') {
      walk.x += walk.dir * cfg.walkSpeed;
      if (walk.x <= wa.x) { walk.x = wa.x; walk.dir = 1; }
      if (walk.x >= wa.x + wa.width - W) { walk.x = wa.x + wa.width - W; walk.dir = -1; }
      if (Math.random() < 0.002) { walk.mode = 'idle'; walk.until = now + 3000 + Math.random() * 6000; }
    } else if (now > walk.until) {
      walk.mode = 'walk';
      if (Math.random() < 0.35) walk.dir *= -1;
    }
  }
  const [cx, cy] = win.getPosition();
  const nx = Math.round(walk.x);
  if (nx !== cx || y !== cy) win.setPosition(nx, y);
  sendState();
}

let lastCursor = '';
function trackCursor() {
  if (!win || win.isDestroyed()) return;
  const p = screen.getCursorScreenPoint();
  const [x, y] = win.getPosition();
  const rel = { x: p.x - (x + W / 2), y: p.y - (y + H - 70) };
  const key = `${Math.round(rel.x / 8)}:${Math.round(rel.y / 8)}`;
  if (key !== lastCursor) { lastCursor = key; win.webContents.send('buddy:look', rel); }
}

// ---------- window ----------
function createWindow() {
  const wa = workArea();
  walk.x = wa.x + wa.width - W - 40;
  win = new BrowserWindow({
    width: W, height: H, x: Math.round(walk.x), y: wa.y + wa.height - H,
    transparent: true, frame: false, resizable: false, hasShadow: false,
    alwaysOnTop: true, skipTaskbar: true, fullscreenable: false, backgroundColor: '#00000000',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false },
  });
  win.setAlwaysOnTop(true, 'floating');
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  win.setIgnoreMouseEvents(true, { forward: true });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.webContents.on('did-finish-load', () => {
    walk.sent = '';
    win.webContents.send('buddy:init', { name: cfg.name, voice: !!speech.findWhisper(cfg) });
    sendState();
  });
  setInterval(tick, 33);
  setInterval(trackCursor, 120);
}

// ---------- reminders ----------
function remind(text, opts = {}) {
  if (!win) return;
  win.webContents.send('buddy:remind', { text, snooze: opts.snooze !== false });
  speech.speak(cfg, text);
  if (Notification.isSupported()) new Notification({ title: cfg.name, body: text, silent: true }).show();
}

async function refreshEvents() {
  if (!calendar.isSignedIn()) return;
  try {
    const now = new Date();
    events = await calendar.listEvents(now.toISOString(), new Date(now.getTime() + 36 * 3600e3).toISOString());
  } catch (e) { console.error('calendar refresh failed:', e.message); }
}

function checkReminders() {
  const now = new Date();
  for (const r of dueReminders(events, now, fired, { leadMinutes: cfg.reminderLeadMinutes, timeZone: cfg.timeZone })) remind(r.text);
  const w = waterDue(now, lastWater, cfg.water, cfg.awake, cfg.timeZone);
  lastWater = w.last;
  if (w.due && !walk.busy) remind(WATER_LINES[Math.floor(Math.random() * WATER_LINES.length)]);
}

// ---------- brain: local Ollama (free) or Claude API ----------
let lastJournal = null;
async function ask(text) {
  const system = systemPrompt({ name: cfg.name, timeZone: cfg.timeZone, events });
  const journal = journaled(makeHandlers(calendar, cfg.timeZone), calendar, cfg.timeZone);
  const reply = (t) => ({ text: t, changes: journal.lines(), undoable: journal.undoable() });
  try {
    let out;
    if (cfg.brain === 'claude') {
      if (!cfg.anthropicApiKey) return reply('I need your Anthropic API key first. Right-click me and open Settings.');
      const client = new Anthropic({ apiKey: cfg.anthropicApiKey });
      out = await runAgent({ client, model: cfg.model, system, history, userText: text, handlers: journal.handlers });
    } else {
      out = await runOllamaAgent({ host: cfg.ollamaHost, model: cfg.ollamaModel, system, history, userText: text, handlers: journal.handlers });
    }
    history = out.history;
    if (journal.entries.length) { lastJournal = journal; refreshEvents(); }
    return reply(out.text);
  } catch (e) {
    console.error(e);
    if (journal.entries.length) { lastJournal = journal; refreshEvents(); }
    if (e instanceof BrainOffline) return reply(`My brain is switched off. ${e.message} Run "npm run setup:brain" in Terminal, then restart me.`);
    if (e.status === 401) return reply('Claude rejected the API key. Check it in Settings.');
    return reply(`Something went wrong in my head: ${e.message}`);
  }
}

async function undoLast() {
  if (!lastJournal) return 'Nothing to undo.';
  try {
    const n = await lastJournal.undo();
    lastJournal = null;
    history.push({ role: 'user', content: '(He pressed Undo. All the calendar changes from your last reply were reverted.)' },
      { role: 'assistant', content: cfg.brain === 'claude' ? [{ type: 'text', text: 'Understood, changes reverted.' }] : 'Understood, changes reverted.' });
    refreshEvents();
    return n ? `Undone. ${n === 1 ? 'That change is' : `All ${n} changes are`} rolled back. Beep.` : 'Nothing to undo.';
  } catch (e) {
    return `I couldn't undo everything: ${e.message}`;
  }
}

// ---------- menu ----------
function menuTemplate() {
  return [
    { label: `Talk to ${cfg.name}`, click: () => win.webContents.send('buddy:command', 'listen') },
    { label: 'Type instead', click: () => win.webContents.send('buddy:command', 'type') },
    { type: 'separator' },
    { label: walk.paused ? 'Start walking' : 'Stay here', click: () => { walk.paused = !walk.paused; rebuildTray(); } },
    { label: 'New conversation', click: () => { history = []; } },
    { label: 'Open Claude (app)', click: () => shell.openExternal('https://claude.ai/new') },
    { type: 'separator' },
    { label: calendar.isSignedIn() ? 'Google Calendar connected ✓' : 'Sign in to Google…', click: signIn },
    { label: 'Settings (config.json)…', click: () => shell.openPath(cfg._file) },
    { label: 'Open settings folder', click: () => shell.openPath(cfg._dir) },
    ...(cfg.boardUrl ? [{ label: 'Open Daily OS board', click: () => shell.openExternal(cfg.boardUrl) }] : []),
    { type: 'separator' },
    { label: 'Quit', click: () => app.quit() },
  ];
}

function rebuildTray() {
  if (!tray) return;
  tray.setContextMenu(Menu.buildFromTemplate(menuTemplate()));
}

async function signIn() {
  try {
    await calendar.signIn();
    await refreshEvents();
    remind(`Connected to your calendar. ${events.length} events coming up.`, { snooze: false });
  } catch (e) {
    remind(e.message, { snooze: false });
  }
  rebuildTray();
}

// ---------- IPC ----------
ipcMain.on('buddy:ignore', (_e, ignore) => win && win.setIgnoreMouseEvents(ignore, { forward: true }));
ipcMain.on('buddy:busy', (_e, busy) => {
  if (walk.busy && !busy) { walk.mode = 'idle'; walk.until = Date.now() + 2500; }
  walk.busy = !!busy;
});
ipcMain.on('buddy:drag', (_e, dx) => { const wa = workArea(); walk.x = Math.min(Math.max(walk.x + dx, wa.x), wa.x + wa.width - W); });
ipcMain.on('buddy:menu', () => Menu.buildFromTemplate(menuTemplate()).popup({ window: win }));
ipcMain.on('buddy:focus', () => { win.setFocusable(true); win.focus(); });
ipcMain.on('buddy:hush', () => speech.stopSpeaking());
ipcMain.on('buddy:snooze', (_e, text) => setTimeout(() => remind(text), 10 * 60 * 1000));
ipcMain.handle('buddy:mic', async () => process.platform !== 'darwin' || systemPreferences.askForMediaAccess('microphone'));
ipcMain.handle('buddy:transcribe', (_e, wav) => speech.transcribe(cfg, wav));
ipcMain.handle('buddy:ask', async (_e, text) => {
  const reply = await ask(text);
  speech.speak(cfg, reply.text);
  return reply;
});
ipcMain.handle('buddy:undo', async () => {
  const msg = await undoLast();
  speech.speak(cfg, msg);
  return msg;
});

// ---------- boot ----------
app.whenReady().then(async () => {
  if (process.platform === 'darwin' && app.dock) app.dock.hide();
  cfg = loadConfig(app.getPath('userData'));
  fs.watchFile(cfg._file, { interval: 2000 }, () => { const prev = cfg.brain; cfg = loadConfig(app.getPath('userData')); if (cfg.brain !== prev) history = []; calendar.timeZone = cfg.timeZone; calendar.calendarId = cfg.calendarId; });
  calendar = new Calendar({
    credentialsPath: path.join(cfg._dir, 'google-credentials.json'),
    tokenPath: path.join(cfg._dir, 'google-token.json'),
    calendarId: cfg.calendarId, timeZone: cfg.timeZone,
    openUrl: (u) => shell.openExternal(u),
  });

  tray = new Tray(nativeImage.createEmpty());
  tray.setTitle('🤖');
  tray.setToolTip(cfg.name);
  rebuildTray();

  createWindow();
  await refreshEvents();
  setInterval(refreshEvents, 5 * 60 * 1000);
  setInterval(checkReminders, 30 * 1000);
  setTimeout(checkReminders, 4000);
});

app.on('window-all-closed', (e) => e.preventDefault());
