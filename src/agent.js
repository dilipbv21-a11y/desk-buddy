// A small tool-use loop: send the request to Claude, run any calendar tools it asks for,
// feed results back, repeat until it answers in plain text.
const { TOOLS, MUTATING } = require('./tools');
const { describeNow } = require('./time');

function systemPrompt({ name, timeZone, now = new Date() }) {
  return [
    `You are ${name}, Dilip's small, cheerful desktop buddy. You live on his Mac and help him run his day.`,
    `It is now ${describeNow(now, timeZone)} (${timeZone}). All times you send or receive are local ${timeZone} wall-clock times, format YYYY-MM-DDTHH:MM:SS.`,
    'Your replies are spoken aloud from a speech bubble, so keep them to 1-3 short sentences, no lists or markdown.',
    'You can read and change his Google Calendar with tools. When he asks to rearrange, shift or reschedule, first call list_events for the relevant window, then make the changes, then say briefly what moved.',
    'Use update_event for one day. Use update_series_time only when he says every day, always or from now on.',
    'Before deleting anything, or before changing more than 8 events at once, say your plan in one sentence and ask him to confirm.',
    'Never invent events or claim a change you did not make. If a tool fails, say so plainly.',
    'Be warm and encouraging, but direct: he is in a 4-week interview sprint (case prep, SQL/Excel drills, gym, lights out 22:30) and wants to be pushed, not coddled.',
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

module.exports = { runAgent, systemPrompt, trimHistory };
