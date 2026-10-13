// Google Calendar access with a desktop (loopback) OAuth flow.
const fs = require('fs');
const http = require('http');
const { google } = require('googleapis');
const { normalizeLocal } = require('./time');

const SCOPES = ['https://www.googleapis.com/auth/calendar.events'];

class Calendar {
  constructor({ credentialsPath, tokenPath, calendarId = 'primary', timeZone, openUrl }) {
    Object.assign(this, { credentialsPath, tokenPath, calendarId, timeZone, openUrl });
    this._api = null;
  }

  hasCredentials() { return fs.existsSync(this.credentialsPath); }
  isSignedIn() { return fs.existsSync(this.tokenPath); }

  _readCreds() {
    if (!this.hasCredentials()) {
      throw new Error(`Google credentials missing. Put your OAuth client JSON at ${this.credentialsPath} (see README).`);
    }
    const raw = JSON.parse(fs.readFileSync(this.credentialsPath, 'utf8'));
    const c = raw.installed || raw.web;
    if (!c) throw new Error('google-credentials.json must be a "Desktop app" OAuth client.');
    return c;
  }

  _oauth(redirectUri) {
    const c = this._readCreds();
    const auth = new google.auth.OAuth2(c.client_id, c.client_secret, redirectUri);
    auth.on('tokens', (tokens) => {
      const prev = fs.existsSync(this.tokenPath) ? JSON.parse(fs.readFileSync(this.tokenPath, 'utf8')) : {};
      fs.writeFileSync(this.tokenPath, JSON.stringify({ ...prev, ...tokens }, null, 2), { mode: 0o600 });
    });
    return auth;
  }

  async signIn() {
    const server = http.createServer();
    await new Promise(r => server.listen(0, '127.0.0.1', r));
    const redirect = `http://127.0.0.1:${server.address().port}`;
    const auth = this._oauth(redirect);
    const url = auth.generateAuthUrl({ access_type: 'offline', prompt: 'consent', scope: SCOPES });
    const code = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Google sign-in timed out.')), 5 * 60 * 1000);
      server.on('request', (req, res) => {
        const q = new URL(req.url, redirect).searchParams;
        if (!q.get('code') && !q.get('error')) { res.end(); return; }
        res.setHeader('Content-Type', 'text/html');
        res.end('<body style="font:18px system-ui;padding:40px">All set. Your buddy can see your calendar now. You can close this tab.</body>');
        clearTimeout(timer);
        q.get('code') ? resolve(q.get('code')) : reject(new Error(q.get('error')));
      });
      this.openUrl(url);
    }).finally(() => server.close());
    const { tokens } = await auth.getToken(code);
    fs.writeFileSync(this.tokenPath, JSON.stringify(tokens, null, 2), { mode: 0o600 });
    this._api = null;
  }

  api() {
    if (this._api) return this._api;
    if (!this.isSignedIn()) throw new Error('Google Calendar is not connected yet. Right-click the buddy and choose "Sign in to Google".');
    const auth = this._oauth('http://127.0.0.1');
    auth.setCredentials(JSON.parse(fs.readFileSync(this.tokenPath, 'utf8')));
    this._api = google.calendar({ version: 'v3', auth });
    return this._api;
  }

  _when(local) { return { dateTime: normalizeLocal(local), timeZone: this.timeZone }; }

  static simplify(e) {
    return {
      id: e.id,
      summary: e.summary || '',
      start: e.start?.dateTime || e.start?.date,
      end: e.end?.dateTime || e.end?.date,
      allDay: !e.start?.dateTime,
      recurringEventId: e.recurringEventId || undefined,
      description: e.description ? e.description.slice(0, 200) : undefined,
    };
  }

  async listEvents(timeMin, timeMax, q) {
    const res = await this.api().events.list({
      calendarId: this.calendarId, timeMin, timeMax, q: q || undefined,
      singleEvents: true, orderBy: 'startTime', maxResults: 100,
    });
    return (res.data.items || []).filter(e => e.status !== 'cancelled').map(Calendar.simplify);
  }

  async getEvent(id) {
    const res = await this.api().events.get({ calendarId: this.calendarId, eventId: id });
    return res.data;
  }

  async createEvent({ summary, start, end, description, recurrence }) {
    const res = await this.api().events.insert({
      calendarId: this.calendarId,
      requestBody: {
        summary, description,
        start: this._when(start), end: this._when(end),
        recurrence: recurrence ? [recurrence] : undefined,
      },
    });
    return Calendar.simplify(res.data);
  }

  async patchEvent(id, { summary, start, end, description }) {
    const body = {};
    if (summary !== undefined) body.summary = summary;
    if (description !== undefined) body.description = description;
    if (start) body.start = this._when(start);
    if (end) body.end = this._when(end);
    const res = await this.api().events.patch({ calendarId: this.calendarId, eventId: id, requestBody: body });
    return Calendar.simplify(res.data);
  }

  async deleteEvent(id) {
    await this.api().events.delete({ calendarId: this.calendarId, eventId: id });
    return { deleted: id };
  }

  // Move every occurrence of a recurring series to new clock times, keeping its first date.
  async updateSeriesTime(seriesId, startHHMM, endHHMM) {
    const master = await this.getEvent(seriesId);
    if (!master.recurrence) throw new Error('That event is not a recurring series. Use update_event instead.');
    const date = (master.start.dateTime || master.start.date).slice(0, 10);
    return this.patchEvent(seriesId, { start: `${date}T${startHHMM}`, end: `${date}T${endHHMM}` });
  }
}

module.exports = { Calendar };
