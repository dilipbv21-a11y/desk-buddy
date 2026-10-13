// Renderer: draws the buddy's mood, handles click/drag, voice capture, and the speech bubble.
(function () {
  const $ = (id) => document.getElementById(id);
  const el = { buddy: $('buddy'), bubble: $('bubble'), who: $('who'), text: $('text'), meter: $('meter'),
    form: $('form'), input: $('input'), actions: $('actions'), ok: $('ok'), snooze: $('snooze'), undo: $('undo'), changes: $('changes'), close: $('close') };
  const api = window.buddy;
  const rec = new window.BuddyAudio.Recorder();

  let name = 'Mario', voice = false, base = 'walk', dir = 1, overlay = null;
  let listening = false, hideTimer = null, reminderText = '';

  // ---------- robot beeps (tiny synth, no audio files) ----------
  let actx = null;
  function beep(notes) {
    try {
      actx = actx || new AudioContext();
      let t = actx.currentTime;
      for (const [freq, dur] of notes) {
        const o = actx.createOscillator(), g = actx.createGain();
        o.type = 'square'; o.frequency.setValueAtTime(freq, t);
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.06, t + 0.01);
        g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        o.connect(g).connect(actx.destination);
        o.start(t); o.stop(t + dur + 0.02);
        t += dur + 0.03;
      }
    } catch { /* audio is a nice-to-have */ }
  }
  const SOUNDS = {
    hello: [[660, .07], [990, .09]],
    heard: [[880, .06], [660, .08]],
    reply: [[520, .06], [780, .06], [1040, .08]],
    alert: [[1200, .07], [1200, .07], [1500, .12]],
  };

  // He's been alone down there. He's always glad you clicked.
  const GREETINGS = [
    "Oh! You're back. Beep.",
    'Company! Finally. What do you need?',
    "Beep! I was hoping you'd click. Talk to me.",
    'Oh hi. It gets quiet down here. What can I do?',
    'Boop. I was just counting the icons again. What do you need?',
  ];
  const greet = () => GREETINGS[Math.floor(Math.random() * GREETINGS.length)];

  // ---------- mood ----------
  function paint() {
    const mode = overlay || (base === 'busy' ? 'attentive' : base);
    el.buddy.className = `hit ${mode}${dir < 0 ? ' left' : ''}`;
  }
  function setOverlay(m) { overlay = m; paint(); syncBusy(); }
  function syncBusy() { api.setBusy(!!overlay || !el.bubble.hidden || listening); }

  api.onInit((d) => { name = d.name; voice = d.voice; });
  api.onState((s) => { base = s.mode; dir = s.dir; paint(); });
  api.onLook((p) => {
    const len = Math.hypot(p.x, p.y) || 1, k = Math.min(3.2, len / 40);
    const x = (p.x / len) * k * dir, y = (p.y / len) * k;
    document.querySelectorAll('.pupil').forEach(n => { n.style.transform = `translate(${x}px, ${y}px)`; });
  });

  // ---------- bubble ----------
  function showBubble({ who = '', text = '', meter = false, form = false, actions = false, hideAfter = 0, changes = [], undo = false, snooze = false }) {
    clearTimeout(hideTimer);
    el.changes.replaceChildren(...changes.map(c => { const li = document.createElement('li'); li.textContent = c; return li; }));
    el.changes.hidden = !changes.length;
    el.undo.hidden = !undo;
    el.snooze.hidden = !snooze;
    el.who.textContent = who;
    el.text.textContent = text;
    el.meter.hidden = !meter;
    el.form.hidden = !form;
    el.actions.hidden = !actions;
    el.bubble.hidden = false;
    if (hideAfter) hideTimer = setTimeout(hideBubble, hideAfter);
    syncBusy();
  }
  function hideBubble() {
    clearTimeout(hideTimer);
    el.bubble.hidden = true;
    el.input.value = '';
    if (!listening && overlay !== 'think') setOverlay(null);
    api.ignoreMouse(true);
    syncBusy();
  }
  const readTime = (t) => Math.min(30000, Math.max(7000, t.length * 75));
  el.bubble.addEventListener('mouseenter', () => clearTimeout(hideTimer));
  el.bubble.addEventListener('mouseleave', () => {
    if (el.form.hidden && el.actions.hidden && !listening && overlay !== 'think') hideTimer = setTimeout(hideBubble, 4000);
  });
  el.close.addEventListener('click', () => { api.hush(); if (listening) cancelListening(); hideBubble(); });

  // ---------- click-through: only the buddy and bubble catch the mouse ----------
  let ignoring = true;
  document.addEventListener('mousemove', (e) => {
    const over = !!e.target.closest('.hit');
    if (over === ignoring) { ignoring = !over; api.ignoreMouse(ignoring); }
  });

  // ---------- click vs drag ----------
  let down = null;
  el.buddy.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    down = { x: e.screenX, moved: 0 };
    el.buddy.setPointerCapture(e.pointerId);
  });
  el.buddy.addEventListener('pointermove', (e) => {
    if (!down) return;
    const dx = e.screenX - down.x;
    down.x = e.screenX;
    down.moved += Math.abs(dx);
    if (down.moved > 4) api.drag(dx);
  });
  el.buddy.addEventListener('pointerup', () => {
    const click = down && down.moved <= 4;
    down = null;
    if (click) onClick();
  });
  el.buddy.addEventListener('contextmenu', (e) => { e.preventDefault(); api.menu(); });

  function onClick() {
    if (listening) return finishListening();
    if (overlay === 'think') return;
    api.hush();
    voice ? startListening() : openTyping();
  }

  // ---------- voice ----------
  let heard = false, silentMs = 0, totalMs = 0;
  async function startListening() {
    const ok = await api.askMic();
    if (!ok) {
      showBubble({ who: name, text: 'I need microphone access. Allow it in System Settings → Privacy & Security → Microphone. You can type for now.', form: true });
      return focusInput();
    }
    listening = true; heard = false; silentMs = 0; totalMs = 0;
    beep(SOUNDS.hello);
    setOverlay('listen');
    showBubble({ who: name, text: `${greet()}\n(Talk, then click me when you're done.)`, meter: true });
    try {
      await rec.start((rms, ms) => {
        el.meter.firstElementChild.style.width = `${Math.min(100, rms * 900)}%`;
        totalMs += ms;
        if (rms > 0.02) { heard = true; silentMs = 0; } else if (heard && rms < 0.012) silentMs += ms;
        if ((heard && silentMs > 1400) || totalMs > 20000 || (!heard && totalMs > 7000)) finishListening();
      });
    } catch (e) {
      listening = false;
      setOverlay(null);
      showBubble({ who: name, text: `Couldn't open the mic (${e.message}). Type instead:`, form: true });
      focusInput();
    }
  }

  async function cancelListening() { listening = false; await rec.stop(); setOverlay(null); }

  async function finishListening() {
    if (!listening) return;
    listening = false;
    beep(SOUNDS.heard);
    setOverlay('think');
    showBubble({ who: name, text: 'Processing… beep boop.' });
    const wav = await rec.stop();
    let text = '';
    try { text = wav ? await api.transcribe(wav) : ''; } catch (e) {
      setOverlay(null);
      showBubble({ who: name, text: `Voice didn't work (${e.message}). Type it instead:`, form: true });
      return focusInput();
    }
    if (!text) {
      setOverlay(null);
      showBubble({ who: name, text: "I didn't catch that. Try again, or type it:", form: true });
      return focusInput();
    }
    send(text);
  }

  // ---------- typing ----------
  function focusInput() { api.focus(); setTimeout(() => el.input.focus(), 50); }
  function openTyping() {
    showBubble({ who: name, text: greet(), form: true });
    focusInput();
  }
  el.form.addEventListener('submit', (e) => {
    e.preventDefault();
    const t = el.input.value.trim();
    if (t) send(t);
  });
  el.input.addEventListener('keydown', (e) => { if (e.key === 'Escape') hideBubble(); });

  // ---------- Claude ----------
  async function send(text) {
    setOverlay('think');
    showBubble({ who: 'You said', text });
    let r;
    try { r = await api.ask(text); } catch (e) { r = { text: `Hmm, that failed: ${e.message}`, changes: [] }; }
    const reply = r.text || '';
    beep(SOUNDS.reply);
    setOverlay('talk');
    const changed = (r.changes || []).length > 0;
    // When the calendar changed, keep the bubble up so he can check it and hit Undo.
    showBubble({ who: name, text: reply, changes: r.changes || [], actions: changed, undo: !!r.undoable,
      hideAfter: changed ? 120000 : readTime(reply) });
    setTimeout(() => { if (overlay === 'talk') setOverlay(null); }, Math.min(12000, reply.length * 65));
  }

  // ---------- reminders ----------
  api.onRemind(({ text, snooze }) => {
    if (listening || overlay === 'think') return; // don't interrupt a conversation
    reminderText = text;
    beep(SOUNDS.alert);
    setOverlay('alert');
    setTimeout(() => { if (overlay === 'alert') setOverlay(null); }, 1700);
    showBubble({ who: 'Reminder', text, actions: true, snooze, hideAfter: 90000 });
  });
  el.ok.addEventListener('click', hideBubble);
  el.undo.addEventListener('click', async () => {
    setOverlay('think');
    showBubble({ who: name, text: 'Rolling it back…' });
    const msg = await api.undo();
    setOverlay('talk');
    showBubble({ who: name, text: msg, hideAfter: readTime(msg) });
    setTimeout(() => { if (overlay === 'talk') setOverlay(null); }, 3000);
  });
  el.snooze.addEventListener('click', () => { api.snooze(reminderText); hideBubble(); });

  api.onCommand((c) => { if (c === 'listen') onClick(); if (c === 'type') openTyping(); });
  paint();
})();
