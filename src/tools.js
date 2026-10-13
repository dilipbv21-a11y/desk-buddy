// Tool definitions Claude can call, and the handlers that run them against Google Calendar.
const { toRfc3339, localISO, normalizeLocal } = require('./time');

const TOOLS = [
  {
    name: 'list_events',
    description: 'List calendar events between two local times. Call this before rescheduling anything so you know the real event ids and times.',
    input_schema: {
      type: 'object',
      properties: {
        start: { type: 'string', description: 'Local start, YYYY-MM-DDTHH:MM:SS' },
        end: { type: 'string', description: 'Local end, YYYY-MM-DDTHH:MM:SS' },
        query: { type: 'string', description: 'Optional text to match in titles' },
      },
      required: ['start', 'end'],
    },
  },
  {
    name: 'create_event',
    description: 'Create a new event. For something that repeats, pass an RRULE such as "RRULE:FREQ=DAILY".',
    input_schema: {
      type: 'object',
      properties: {
        summary: { type: 'string' },
        start: { type: 'string', description: 'Local start, YYYY-MM-DDTHH:MM:SS' },
        end: { type: 'string', description: 'Local end, YYYY-MM-DDTHH:MM:SS' },
        description: { type: 'string' },
        recurrence: { type: 'string' },
      },
      required: ['summary', 'start', 'end'],
    },
  },
  {
    name: 'update_event',
    description: 'Change ONE event, or ONE occurrence of a recurring event (use the id from list_events). If you pass only a new start, the original duration is kept.',
    input_schema: {
      type: 'object',
      properties: {
        event_id: { type: 'string' },
        summary: { type: 'string' },
        start: { type: 'string', description: 'New local start, YYYY-MM-DDTHH:MM:SS' },
        end: { type: 'string', description: 'New local end, YYYY-MM-DDTHH:MM:SS' },
        description: { type: 'string' },
      },
      required: ['event_id'],
    },
  },
  {
    name: 'update_series_time',
    description: 'Change the clock time of EVERY occurrence of a recurring event. Only use when he says "every day", "always" or "from now on". Pass the recurringEventId from list_events.',
    input_schema: {
      type: 'object',
      properties: {
        series_id: { type: 'string' },
        start_time: { type: 'string', description: 'HH:MM, 24-hour' },
        end_time: { type: 'string', description: 'HH:MM, 24-hour' },
      },
      required: ['series_id', 'start_time', 'end_time'],
    },
  },
  {
    name: 'delete_event',
    description: 'Delete one event or one occurrence. Only call this after he has clearly confirmed.',
    input_schema: { type: 'object', properties: { event_id: { type: 'string' } }, required: ['event_id'] },
  },
];

const MUTATING = new Set(['create_event', 'update_event', 'update_series_time', 'delete_event']);

function makeHandlers(calendar, tz) {
  return {
    list_events: (i) => calendar.listEvents(toRfc3339(i.start, tz), toRfc3339(i.end, tz), i.query),
    create_event: (i) => calendar.createEvent(i),
    update_event: async (i) => {
      let { start, end } = i;
      if (start && !end) {
        const ev = await calendar.getEvent(i.event_id);
        const dur = new Date(ev.end.dateTime || ev.end.date) - new Date(ev.start.dateTime || ev.start.date);
        end = localISO(new Date(new Date(toRfc3339(start, tz)).getTime() + dur), tz);
      }
      if (start) start = normalizeLocal(start);
      return calendar.patchEvent(i.event_id, { summary: i.summary, description: i.description, start, end });
    },
    update_series_time: (i) => calendar.updateSeriesTime(i.series_id, i.start_time, i.end_time),
    delete_event: (i) => calendar.deleteEvent(i.event_id),
  };
}

module.exports = { TOOLS, MUTATING, makeHandlers };
