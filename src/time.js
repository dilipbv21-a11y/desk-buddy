// Time-zone helpers. All "local" strings are wall-clock times in the user's
// configured zone, formatted YYYY-MM-DDTHH:MM:SS with no offset.

function parts(date, tz) {
  const f = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23', weekday: 'long',
  });
  const o = {};
  for (const p of f.formatToParts(date)) o[p.type] = p.value;
  return o;
}

function tzOffset(tz, date = new Date()) {
  const name = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'longOffset' })
    .formatToParts(date).find(p => p.type === 'timeZoneName').value; // e.g. "GMT+05:30"
  const m = name.match(/GMT([+-]\d{2}):?(\d{2})?/);
  return m ? `${m[1]}:${m[2] || '00'}` : '+00:00';
}

function localISO(date, tz) {
  const p = parts(date, tz);
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}`;
}

function describeNow(date, tz) {
  const p = parts(date, tz);
  return `${p.weekday}, ${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`;
}

function normalizeLocal(s) {
  s = String(s).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return `${s}T00:00:00`;
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(s)) return `${s}:00`;
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(s)) return s;
  throw new Error(`Bad local time "${s}". Use YYYY-MM-DDTHH:MM:SS.`);
}

// Local wall-clock string -> RFC3339 with the zone's offset at that moment.
function toRfc3339(s, tz) {
  if (/(Z|[+-]\d{2}:\d{2})$/.test(String(s).trim())) return String(s).trim();
  const local = normalizeLocal(s);
  const guess = new Date(`${local}Z`);
  return local + tzOffset(tz, guess);
}

function minutesOfDay(date, tz) {
  const p = parts(date, tz);
  return Number(p.hour) * 60 + Number(p.minute);
}

function hhmmToMinutes(hhmm) {
  const [h, m] = String(hhmm).split(':').map(Number);
  return h * 60 + (m || 0);
}

// True if `date` falls in [from, to) local time; handles windows that cross midnight.
function inWindow(date, tz, from, to) {
  const m = minutesOfDay(date, tz), a = hhmmToMinutes(from), b = hhmmToMinutes(to);
  return a <= b ? m >= a && m < b : m >= a || m < b;
}

module.exports = { parts, tzOffset, localISO, describeNow, normalizeLocal, toRfc3339, minutesOfDay, hhmmToMinutes, inWindow };
