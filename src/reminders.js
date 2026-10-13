// Pure reminder logic so it can be unit-tested without Electron or Google.
const { inWindow } = require('./time');

const START_GRACE_MS = 2 * 60 * 1000;

function fmtClock(d, tz) {
  return new Intl.DateTimeFormat('en-IN', { timeZone: tz, hour: 'numeric', minute: '2-digit', hour12: true }).format(d);
}

// events: [{id, summary, start: ISO string with offset, allDay}]
// fired: Set of keys already shown. Returns reminders to show now and adds their keys to `fired`.
function dueReminders(events, now, fired, { leadMinutes = 5, timeZone = 'Asia/Kolkata' } = {}) {
  const out = [];
  const t = now.getTime();
  for (const ev of events) {
    if (ev.allDay || !ev.start) continue;
    const start = new Date(ev.start);
    const s = start.getTime();
    const title = (ev.summary || 'Untitled').trim();
    const leadKey = `${ev.id}@${ev.start}:lead`;
    const startKey = `${ev.id}@${ev.start}:start`;
    if (leadMinutes > 0 && t >= s - leadMinutes * 60000 && t < s && !fired.has(leadKey)) {
      fired.add(leadKey);
      const mins = Math.max(1, Math.round((s - t) / 60000));
      out.push({ key: leadKey, kind: 'lead', text: `${title} in ${mins} min (${fmtClock(start, timeZone)}).`, event: ev });
    }
    if (t >= s && t < s + START_GRACE_MS && !fired.has(startKey)) {
      fired.add(startKey);
      fired.add(leadKey);
      out.push({ key: startKey, kind: 'start', text: `Time for: ${title}.`, event: ev });
    }
  }
  return out;
}

// Returns {due, last}. First call just starts the clock.
function waterDue(now, last, { enabled = true, everyMinutes = 60 } = {}, awake, tz) {
  if (!enabled) return { due: false, last };
  if (awake && !inWindow(now, tz, awake.from, awake.to)) return { due: false, last: null };
  if (last == null) return { due: false, last: now.getTime() };
  if (now.getTime() - last >= everyMinutes * 60000) return { due: true, last: now.getTime() };
  return { due: false, last };
}

const WATER_LINES = [
  'Water break! A full glass, please.',
  'Sip sip. Drink some water.',
  'Hydration check: one glass now.',
  'Your brain is 75% water. Top it up.',
];

module.exports = { dueReminders, waterDue, WATER_LINES, fmtClock };
