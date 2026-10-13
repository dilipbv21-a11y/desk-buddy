// Records every calendar change made during one request so Mario can (1) show exactly what
// really changed, whatever the model claims, and (2) undo it with one click.
const { localISO } = require('./time');

function fmt(iso, tz) {
  const d = new Date(iso);
  const day = new Intl.DateTimeFormat('en-IN', { timeZone: tz, weekday: 'short' }).format(d);
  const t = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(d);
  return { day, t };
}

function describe(summary, start, end, tz) {
  const a = fmt(start, tz), b = fmt(end, tz);
  return `${summary || 'Event'} → ${a.day} ${a.t}–${b.t}`;
}

function journaled(handlers, calendar, tz) {
  const entries = [];
  const wrap = {
    ...handlers,
    update_event: async (i) => {
      const before = await calendar.getEvent(i.event_id);
      const after = await handlers.update_event(i);
      entries.push({ kind: 'patch', id: i.event_id, before, after });
      return after;
    },
    update_series_time: async (i) => {
      const before = await calendar.getEvent(i.series_id);
      const after = await handlers.update_series_time(i);
      entries.push({ kind: 'series', id: i.series_id, before, after });
      return after;
    },
    create_event: async (i) => {
      const after = await handlers.create_event(i);
      entries.push({ kind: 'create', id: after.id, after });
      return after;
    },
    delete_event: async (i) => {
      const before = await calendar.getEvent(i.event_id).catch(() => null);
      const out = await handlers.delete_event(i);
      entries.push({ kind: 'delete', id: i.event_id, before });
      return out;
    },
  };

  function lines() {
    return entries.map(e => {
      if (e.kind === 'delete') return `Deleted: ${e.before?.summary || 'an event'}`;
      const a = e.after;
      const line = describe(a.summary || e.before?.summary, a.start, a.end, tz);
      return e.kind === 'create' ? `Added: ${line}` : e.kind === 'series' ? `Every day: ${line}` : line;
    });
  }

  // Undo in reverse order. Deletions can't be undone (Mario asks before deleting).
  async function undo() {
    const done = [];
    for (const e of [...entries].reverse()) {
      if (e.kind === 'create') { await calendar.deleteEvent(e.id); done.push(e); }
      if (e.kind === 'patch' || e.kind === 'series') {
        const b = e.before;
        await calendar.patchEvent(e.id, {
          summary: b.summary,
          start: localISO(new Date(b.start.dateTime), tz),
          end: localISO(new Date(b.end.dateTime), tz),
        });
        done.push(e);
      }
    }
    entries.length = 0;
    return done.length;
  }

  const undoable = () => entries.some(e => e.kind !== 'delete');
  return { handlers: wrap, lines, undo, undoable, entries };
}

module.exports = { journaled, describe };
