// WebSocket wrapper. Same-origin: ws://<current host>/ws (wss when the page is https).
// A connection that drops after the welcome is re-dialled automatically and the session is taken back with the secret token from
// `welcome`/`resumed` (server holds the seat for 30 s). Handlers stay registered across sockets. `onStatus('down'|'up')` reports the gap;
// `onClose` fires only when the connection is gone for good (manual close, token refused, or the retry window ran out).

const RETRY_WINDOW_MS = 25000; // a bit under the server's 30 s seat hold
const FINAL_CLOSE = new Set([1001, 1008, 1013]); // going away (server stopping), policy violation (kicked), try again later (full)
const DEAD_LINK_MS = 10000;
const RETRY_DELAYS = [300, 700, 1200, 2000, 3000];

export class Net {
  constructor() {
    this.ws = null;
    this.handlers = new Map();
    this.rtt = -1;
    this.onClose = () => {};
    this.onStatus = () => {};
    this._ping = 0;
    this.token = '';
    this.down = false; // true while re-dialling
    this._retry = 0;
    this._timer = 0;
    this._gone = false; // close() was called
  }

  connect() {
    return new Promise((resolve, reject) => {
      const proto = location.protocol === 'https:' ? 'wss' : 'ws';
      let ws;
      try {
        ws = new WebSocket(`${proto}://${location.host}/ws`);
      } catch (e) {
        reject(e);
        return;
      }
      this.ws = ws;
      let opened = false;
      ws.addEventListener('open', () => {
        opened = true;
        this._lastMsg = performance.now();
        this._ping = setInterval(() => {
          // a half-open socket (Wi-Fi roam, phone sleep) never reports a close: no message (not even a pong) for 10 s means the link is dead
          if (performance.now() - this._lastMsg > DEAD_LINK_MS) {
            clearInterval(this._ping);
            ws.close(); // (its close event may take a minute on a dead link: treat the link as lost now)
            if (this.ws === ws) this.ws = null;
            if (this.token && !this._gone) this._lost();
            else this.onClose({});
          } else this.send({ t: 'ping', ts: performance.now() });
        }, 4000);
        resolve();
      });
      ws.addEventListener('message', (ev) => {
        this._lastMsg = performance.now();
        let m;
        try {
          m = JSON.parse(ev.data);
        } catch {
          return; // skip: ignore a malformed frame, server never sends one
        }
        if (m.t === 'pong') this.rtt = performance.now() - m.ts;
        else if (m.t === 'welcome' || m.t === 'resumed') this.token = m.token || '';
        if (m.t === 'resumed') this._up();
        if (m.t === 'error' && m.code === 'bad_token' && this.down) {
          this._giveUp();
          return;
        }
        const hs = this.handlers.get(m.t);
        if (hs) for (const h of [...hs]) h(m);
      });
      ws.addEventListener('error', () => {
        if (!opened) reject(new Error('Cannot reach the game server'));
      });
      ws.addEventListener('close', (ev) => {
        clearInterval(this._ping);
        if (this.ws !== ws) return; // a superseded socket
        if (!opened) {
          if (this.down) this._schedule();
          else reject(new Error('Connection refused'));
        } else if (this._gone || !this.token || FINAL_CLOSE.has(ev.code)) this.onClose(ev);
        else this._lost();
      });
    });
  }

  _lost() {
    if (!this.down) {
      this.down = true;
      this._since = performance.now();
      this._retry = 0;
      this.onStatus('down');
    }
    this._schedule();
  }

  _schedule() {
    if (this._gone) return;
    if (performance.now() - this._since > RETRY_WINDOW_MS) {
      this._giveUp();
      return;
    }
    const d = RETRY_DELAYS[Math.min(this._retry++, RETRY_DELAYS.length - 1)];
    this._timer = setTimeout(() => this._redial(), d);
  }

  _redial() {
    if (this._gone) return;
    this.connect()
      .then(() => this.send({ t: 'resume', token: this.token }))
      .catch(() => {}); // skip: the close handler of the failed socket schedules the next attempt
  }

  _up() {
    if (!this.down) return;
    this.down = false;
    this.onStatus('up');
  }

  _giveUp() {
    clearTimeout(this._timer);
    this.down = false;
    this.token = '';
    if (this.ws) this.ws.close();
    this.ws = null;
    this.onClose({});
  }

  on(type, fn) {
    if (!this.handlers.has(type)) this.handlers.set(type, new Set());
    this.handlers.get(type).add(fn);
    return () => this.handlers.get(type).delete(fn);
  }

  send(obj) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(obj));
  }

  close() {
    this._gone = true;
    clearTimeout(this._timer);
    clearInterval(this._ping);
    if (this.ws) this.ws.close();
    this.ws = null;
  }
}
