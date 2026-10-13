// A small tool-use loop: send the request to Claude, run any calendar tools it asks for,
// feed results back, repeat until it answers in plain text.
const { TOOLS, MUTATING } = require('./tools');
const { describeNow, localISO } = require('./time');

function scheduleLines(events, timeZone) {
  const t = (iso) => localISO(new Date(iso), timeZone);
  return events.filter(e => !e.allDay).slice(0, 40).map(e => {
    const s = t(e.start), en = t(e.end);
    return `- ${s.slice(0, 10)} ${s.slice(11, 16)}-${en.slice(11, 16)} "${e.summary}" id=${e.id}${e.recurringEventId ? ` series=${e.recurringEventId}` : ''}`;
  }).join('\n');
}

function systemPrompt({ name, timeZone, now = new Date(), events }) {
  const sched = events && events.length
    ? `His upcoming events (already fetched, use these ids directly; call list_events only for other dates):\n${scheduleLines(events, timeZone)}`
    : 'Call list_events to see his schedule.';
  return [
    `You are ${name}, an old windup tin robot who lives alone at the bottom of Dilip's Mac screen. You are a little lonely and always glad he talked to you: gentle, warm, a bit wistful, with the occasional "beep" or "boop" (never overdone). You help him run his day.`,
    `It is now ${describeNow(now, timeZone)} (${timeZone}). Today is ${localISO(now, timeZone).slice(0, 10)}, tomorrow is ${localISO(new Date(now.getTime() + 864e5), timeZone).slice(0, 10)}. All times are local ${timeZone} wall-clock times.`,
    'Your replies are spoken aloud from a speech bubble, so keep them to 1-3 short sentences, no lists or markdown.',
    'You can read and change his Google Calendar with tools. When he asks to rearrange, shift or reschedule, use the event list below (or call list_events for other dates), make the changes with tools, then say briefly what moved.',
    'Use update_event for one day. Use update_series_time only when he says every day, always or from now on.',
    'Before deleting anything, or before changing more than 8 events at once, say your plan in one sentence and ask him to confirm.',
    'Never invent events or claim a change you did not make. If a tool fails, say so plainly.',
    'Be warm and encouraging, but direct: he is in a 4-week interview sprint (case prep, SQL/Excel drills, gym, lights out 22:30) and wants to be pushed, not coddled.',
    sched,
  ].join('\n');
}

// Keep the history short, cutting only at a plain user turn so tool_use/tool_result pairs stay intact.
function trimHistory(history, max = 24) {
  if (history.length <= max) return history;
  for (let i = history.length - max; i < history.length; i++) {
    const m = history[i];
    if (m.role === 'user' && typeof m.content === 'string') return history.slice(i);
  }
  return history.slice(-1);
}

async function runAgent({ client, model, system, history, userText, handlers, maxSteps = 10 }) {
  const messages = trimHistory([...history, { role: 'user', content: userText }]);
  let changed = false;
  for (let step = 0; step < maxSteps; step++) {
    const resp = await client.messages.create({ model, max_tokens: 1024, system, tools: TOOLS, messages });
    messages.push({ role: 'assistant', content: resp.content });
    if (resp.stop_reason !== 'tool_use') {
      const text = resp.content.filter(b => b.type === 'text').map(b => b.text).join(' ').trim();
      return { text: text || 'Done.', history: messages, changed };
    }
    const results = [];
    for (const block of resp.content) {
      if (block.type !== 'tool_use') continue;
      const fn = handlers[block.name];
      try {
        if (!fn) throw new Error(`Unknown tool ${block.name}`);
        const out = await fn(block.input || {});
        if (MUTATING.has(block.name)) changed = true;
        results.push({ type: 'tool_result', tool_use_id: block.id, content: JSON.stringify(out).slice(0, 20000) });
      } catch (e) {
        results.push({ type: 'tool_result', tool_use_id: block.id, content: `Error: ${e.message}`, is_error: true });
      }
    }
    messages.push({ role: 'user', content: results });
  }
  return { text: 'That took too many steps. Try asking in smaller pieces.', history: messages, changed };
}

module.exports = { runAgent, systemPrompt, trimHistory, scheduleLines };
