// WebSocket wrapper. Same-origin: ws://<current host>/ws (wss when the page is https).

export class Net {
  constructor() {
    this.ws = null;
    this.handlers = new Map();
    this.rtt = -1;
    this.onClose = () => {};
    this._ping = 0;
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
        this._ping = setInterval(() => this.send({ t: 'ping', ts: performance.now() }), 4000);
        resolve();
      });
      ws.addEventListener('message', (ev) => {
        let m;
        try {
          m = JSON.parse(ev.data);
        } catch {
          return; // skip: ignore a malformed frame, server never sends one
        }
        if (m.t === 'pong') this.rtt = performance.now() - m.ts;
        const hs = this.handlers.get(m.t);
        if (hs) for (const h of [...hs]) h(m);
      });
      ws.addEventListener('error', () => {
        if (!opened) reject(new Error('Cannot reach the game server'));
      });
      ws.addEventListener('close', (ev) => {
        clearInterval(this._ping);
        if (!opened) reject(new Error('Connection refused'));
        else this.onClose(ev);
      });
    });
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
    clearInterval(this._ping);
    if (this.ws) this.ws.close();
    this.ws = null;
  }
}
