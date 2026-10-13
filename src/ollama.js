// Free, on-device brain: a small open model served by Ollama (https://ollama.com) on this Mac.
// Same calendar tools as the Claude path, sent in Ollama's /api/chat tool-calling format.
const { TOOLS, MUTATING } = require('./tools');

// Best first. Small models that handle tool calls well; setup:brain pulls one that fits your RAM.
const PREFERRED = ['qwen2.5:7b', 'qwen2.5:3b', 'llama3.2:3b'];

const OLLAMA_TOOLS = TOOLS.map(t => ({
  type: 'function',
  function: { name: t.name, description: t.description, parameters: t.input_schema },
}));

class BrainOffline extends Error {}

async function call(host, path, body, fetchImpl = fetch) {
  let res;
  try {
    res = await fetchImpl(`${host}${path}`, body ? {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    } : undefined);
  } catch (e) {
    throw new BrainOffline('Ollama is not running.');
  }
  if (!res.ok) throw new Error(`Ollama ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

// "auto" -> the best installed model from PREFERRED, else the first installed one.
async function resolveModel(host, wanted, fetchImpl) {
  if (wanted && wanted !== 'auto') return wanted;
  const { models = [] } = await call(host, '/api/tags', null, fetchImpl);
  const names = models.map(m => m.name);
  const pick = PREFERRED.find(p => names.includes(p) || names.includes(`${p}:latest`)) || names[0];
  if (!pick) throw new BrainOffline('No Ollama model installed.');
  return pick;
}

// Small models fumble am/pm maths, so turn "3:30 pm" into "15:30" before they see it.
function to24h(text) {
  return String(text).replace(/\b(\d{1,2})(?:[:.](\d{2}))?\s*(a\.?m\.?|p\.?m\.?)(?=\W|$)/gi, (all, h, m, ap) => {
    let hh = Number(h);
    if (hh < 1 || hh > 12) return all;
    const pm = ap[0].toLowerCase() === 'p';
    if (pm && hh < 12) hh += 12;
    if (!pm && hh === 12) hh = 0;
    return `${String(hh).padStart(2, '0')}:${m || '00'}`;
  });
}

function parseArgs(a) {
  if (a && typeof a === 'object') return a;
  try { return JSON.parse(a || '{}'); } catch { return {}; }
}

function trim(history, max = 16) {
  if (history.length <= max) return history;
  for (let i = history.length - max; i < history.length; i++) {
    if (history[i].role === 'user') return history.slice(i);
  }
  return history.slice(-1);
}

async function runOllamaAgent({ host = 'http://127.0.0.1:11434', model, system, history, userText, handlers, maxSteps = 8, fetchImpl }) {
  const name = await resolveModel(host, model, fetchImpl);
  const messages = trim([...history, { role: 'user', content: to24h(userText) }]);
  let changed = false;
  for (let step = 0; step < maxSteps; step++) {
    const out = await call(host, '/api/chat', {
      model: name, stream: false, tools: OLLAMA_TOOLS,
      messages: [{ role: 'system', content: system }, ...messages],
      options: { temperature: 0.2 },
    }, fetchImpl);
    const msg = out.message || {};
    const calls = msg.tool_calls || [];
    messages.push({ role: 'assistant', content: msg.content || '', ...(calls.length ? { tool_calls: calls } : {}) });
    if (!calls.length) {
      const text = String(msg.content || '').replace(/<think>[\s\S]*?<\/think>/g, '').trim();
      return { text: text || 'Done. Beep.', history: messages, changed, model: name };
    }
    for (const c of calls) {
      const tool = c.function?.name;
      const fn = handlers[tool];
      let content;
      try {
        if (!fn) throw new Error(`Unknown tool ${tool}`);
        const result = await fn(parseArgs(c.function.arguments));
        if (MUTATING.has(tool)) changed = true;
        content = JSON.stringify(result).slice(0, 8000);
      } catch (e) {
        content = `Error: ${e.message}`;
      }
      messages.push({ role: 'tool', tool_name: tool, content });
    }
  }
  return { text: 'I got a bit tangled. Try asking in smaller steps?', history: messages, changed, model: name };
}

module.exports = { runOllamaAgent, resolveModel, BrainOffline, PREFERRED, OLLAMA_TOOLS, to24h };
