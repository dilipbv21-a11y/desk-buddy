const test = require('node:test');
const assert = require('node:assert/strict');
const { toRfc3339, localISO, inWindow, tzOffset } = require('../src/time');
const { dueReminders, waterDue } = require('../src/reminders');
const { runAgent, trimHistory } = require('../src/agent');
const { makeHandlers } = require('../src/tools');
const { downsample, encodeWav } = require('../renderer/recorder');
const { cleanTranscript } = require('../src/speech');
const { merge, DEFAULTS } = require('../src/config');

const TZ = 'Asia/Kolkata';

test('time helpers', () => {
  assert.equal(tzOffset(TZ), '+05:30');
  assert.equal(toRfc3339('2026-10-13T14:30', TZ), '2026-10-13T14:30:00+05:30');
  assert.equal(toRfc3339('2026-10-13', TZ), '2026-10-13T00:00:00+05:30');
  assert.equal(localISO(new Date('2026-10-13T09:00:00Z'), TZ), '2026-10-13T14:30:00');
  assert.equal(inWindow(new Date('2026-10-13T17:30:00Z'), TZ, '22:30', '07:00'), true); // 23:00 IST
  assert.equal(inWindow(new Date('2026-10-13T06:00:00Z'), TZ, '22:30', '07:00'), false); // 11:30 IST
  assert.throws(() => toRfc3339('tomorrow 3pm', TZ));
});

test('reminders fire once before and at start', () => {
  const ev = [{ id: 'g', summary: 'GYM: Pull A', start: '2026-10-13T14:30:00+05:30' }];
  const fired = new Set();
  const at = (s) => new Date(s);
  assert.equal(dueReminders(ev, at('2026-10-13T14:20:00+05:30'), fired).length, 0);
  const lead = dueReminders(ev, at('2026-10-13T14:26:00+05:30'), fired);
  assert.equal(lead.length, 1);
  assert.match(lead[0].text, /GYM: Pull A in 4 min/);
  assert.equal(dueReminders(ev, at('2026-10-13T14:27:00+05:30'), fired).length, 0);
  const start = dueReminders(ev, at('2026-10-13T14:30:30+05:30'), fired);
  assert.equal(start[0].kind, 'start');
  assert.equal(dueReminders(ev, at('2026-10-13T14:31:00+05:30'), fired).length, 0);
  // app opened late: no stale reminder
  assert.equal(dueReminders(ev, at('2026-10-13T14:40:00+05:30'), new Set()).length, 0);
  // all-day events are skipped
  assert.equal(dueReminders([{ id: 'a', summary: 'x', start: '2026-10-13', allDay: true }], at('2026-10-13T00:00:30+05:30'), new Set()).length, 0);
});

test('water reminder respects interval and sleep window', () => {
  const awake = { from: '07:00', to: '22:30' };
  const t0 = new Date('2026-10-13T07:00:00Z'); // 12:30 IST
  let w = waterDue(t0, null, { enabled: true, everyMinutes: 60 }, awake, TZ);
  assert.equal(w.due, false);
  w = waterDue(new Date(t0.getTime() + 59 * 60000), w.last, { everyMinutes: 60 }, awake, TZ);
  assert.equal(w.due, false);
  w = waterDue(new Date(t0.getTime() + 61 * 60000), w.last, { everyMinutes: 60 }, awake, TZ);
  assert.equal(w.due, true);
  const night = waterDue(new Date('2026-10-13T18:00:00Z'), 0, { everyMinutes: 60 }, awake, TZ); // 23:30 IST
  assert.equal(night.due, false);
});

test('agent runs tools then answers', async () => {
  const calls = [];
  const calendar = {
    listEvents: async (a, b) => { calls.push(['list', a, b]); return [{ id: 'e1', summary: 'Case block', start: '2026-10-13T09:00:00+05:30' }]; },
    getEvent: async () => ({ start: { dateTime: '2026-10-13T09:00:00+05:30' }, end: { dateTime: '2026-10-13T12:40:00+05:30' } }),
    patchEvent: async (id, p) => { calls.push(['patch', id, p]); return { id }; },
  };
  const script = [
    { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 't1', name: 'list_events', input: { start: '2026-10-13T00:00', end: '2026-10-13T23:59' } }] },
    { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 't2', name: 'update_event', input: { event_id: 'e1', start: '2026-10-13T13:30' } }] },
    { stop_reason: 'end_turn', content: [{ type: 'text', text: 'Moved your case block to 1:30.' }] },
  ];
  const sent = [];
  const client = { messages: { create: async (req) => { sent.push(JSON.parse(JSON.stringify(req.messages))); return script.shift(); } } };
  const out = await runAgent({ client, model: 'm', system: 's', history: [], userText: 'push case block to 1:30', handlers: makeHandlers(calendar, TZ) });
  assert.equal(out.text, 'Moved your case block to 1:30.');
  assert.equal(out.changed, true);
  assert.deepEqual(calls[0], ['list', '2026-10-13T00:00:00+05:30', '2026-10-13T23:59:00+05:30']);
  assert.deepEqual(calls[1][2].start, '2026-10-13T13:30:00');
  assert.deepEqual(calls[1][2].end, '2026-10-13T17:10:00'); // kept 3h40 duration
  assert.equal(sent[1].at(-1).content[0].tool_use_id, 't1');
});

test('agent reports tool errors to Claude instead of crashing', async () => {
  const script = [
    { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 't1', name: 'delete_event', input: { event_id: 'x' } }] },
    { stop_reason: 'end_turn', content: [{ type: 'text', text: 'Could not delete it.' }] },
  ];
  let seen;
  const client = { messages: { create: async (req) => { seen = JSON.parse(JSON.stringify(req.messages)); return script.shift(); } } };
  const handlers = { delete_event: async () => { throw new Error('not signed in'); } };
  const out = await runAgent({ client, model: 'm', system: 's', history: [], userText: 'delete it', handlers });
  assert.equal(out.changed, false);
  assert.equal(seen.at(-1).content[0].is_error, true);
});

test('history trimming keeps tool pairs intact', () => {
  const h = [];
  for (let i = 0; i < 20; i++) {
    h.push({ role: 'user', content: `q${i}` });
    h.push({ role: 'assistant', content: [{ type: 'tool_use', id: `t${i}` }] });
    h.push({ role: 'user', content: [{ type: 'tool_result', tool_use_id: `t${i}` }] });
  }
  const t = trimHistory(h, 10);
  assert.equal(typeof t[0].content, 'string');
  assert.ok(t.length <= 10);
});

test('wav encoding for whisper', () => {
  const s = new Float32Array(48000).fill(0.5);
  const d = downsample(s, 48000, 16000);
  assert.equal(d.length, 16000);
  const wav = new DataView(encodeWav(d, 16000));
  assert.equal(wav.byteLength, 44 + 32000);
  assert.equal(wav.getUint32(24, true), 16000);
  assert.equal(String.fromCharCode(wav.getUint8(0), wav.getUint8(1), wav.getUint8(2), wav.getUint8(3)), 'RIFF');
});

test('transcript cleanup and config merge', () => {
  assert.equal(cleanTranscript(' [BLANK_AUDIO]\n Move gym to 3pm. '), 'Move gym to 3pm.');
  const c = merge(DEFAULTS, { water: { everyMinutes: 45 }, name: 'Bolt' });
  assert.equal(c.water.enabled, true);
  assert.equal(c.water.everyMinutes, 45);
  assert.equal(c.name, 'Bolt');
});
