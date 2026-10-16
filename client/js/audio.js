// All sounds synthesized with WebAudio. No assets, no secure-context-only APIs.

export class Sfx {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.noiseBuf = null;
    this.volume = 0.7;
  }

  // Must be called from a user gesture (click) to satisfy autoplay policy.
  unlock() {
    try {
      if (!this.ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        this.ctx = new AC();
        this.master = this.ctx.createGain();
        this.master.gain.value = this.volume;
        this.master.connect(this.ctx.destination);
        const n = this.ctx.sampleRate;
        this.noiseBuf = this.ctx.createBuffer(1, n, n);
        const d = this.noiseBuf.getChannelData(0);
        for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
      }
      if (this.ctx.state === 'suspended') this.ctx.resume();
    } catch (e) {
      console.warn('audio unavailable', e);
      this.ctx = null;
    }
  }

  setVolume(v) {
    this.volume = v;
    if (this.master) this.master.gain.value = v;
  }

  // listener: {x,y,z,yaw}; pos: [x,y,z]. Returns output node (gain+pan) or null.
  _out(pos, listener, vol) {
    const c = this.ctx;
    const g = c.createGain();
    let node = g;
    let gain = vol;
    if (pos && listener) {
      const dx = pos[0] - listener.x;
      const dz = pos[2] - listener.z;
      const dist = Math.hypot(dx, dz, pos[1] - listener.y);
      gain = vol / (1 + dist * 0.18);
      if (c.createStereoPanner) {
        const pan = c.createStereoPanner();
        // right vector of listener = (cos yaw, -sin yaw)
        const rx = Math.cos(listener.yaw);
        const rz = -Math.sin(listener.yaw);
        const l = Math.hypot(dx, dz) || 1;
        pan.pan.value = Math.max(-1, Math.min(1, ((dx * rx + dz * rz) / l) * 0.9));
        g.connect(pan);
        node = pan;
      }
    }
    g.gain.value = gain;
    node.connect(this.master);
    return g;
  }

  _noise(out, t0, dur, f0, f1, type = 'lowpass', q = 1) {
    const c = this.ctx;
    const src = c.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = c.createBiquadFilter();
    f.type = type;
    f.Q.value = q;
    f.frequency.setValueAtTime(f0, t0);
    f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t0 + dur);
    const e = c.createGain();
    e.gain.setValueAtTime(1, t0);
    e.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    src.connect(f).connect(e).connect(out);
    src.start(t0, Math.random() * 0.5);
    src.stop(t0 + dur + 0.02);
  }

  _tone(out, t0, dur, f0, f1, type = 'sine', vol = 1) {
    const c = this.ctx;
    const o = c.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t0);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t0 + dur);
    const e = c.createGain();
    e.gain.setValueAtTime(vol, t0);
    e.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    o.connect(e).connect(out);
    o.start(t0);
    o.stop(t0 + dur + 0.02);
  }

  play(name, pos = null, listener = null) {
    const c = this.ctx;
    if (!c || c.state !== 'running') return;
    const t = c.currentTime;
    const v = (x) => this._out(pos, listener, x);
    switch (name) {
      case 'rifle': {
        const o = v(0.9);
        this._noise(o, t, 0.16, 5000, 300);
        this._tone(o, t, 0.12, 140, 45, 'triangle', 0.9);
        break;
      }
      case 'pistol': {
        const o = v(0.8);
        this._noise(o, t, 0.1, 6000, 500);
        this._tone(o, t, 0.09, 190, 70, 'triangle', 0.8);
        break;
      }
      case 'knife':
        this._noise(v(0.5), t, 0.16, 800, 3000, 'bandpass', 2);
        break;
      case 'reload': {
        const o = v(0.5);
        this._tone(o, t, 0.04, 900, 500, 'square', 0.4);
        this._tone(o, t + 0.5, 0.05, 600, 300, 'square', 0.4);
        this._noise(o, t + 0.9, 0.06, 2500, 800, 'bandpass', 3);
        break;
      }
      case 'empty':
        this._tone(v(0.4), t, 0.03, 1200, 800, 'square', 0.5);
        break;
      case 'hit':
        this._tone(v(0.5), t, 0.06, 1400, 1000, 'sine');
        break;
      case 'headshot': {
        const o = v(0.6);
        this._tone(o, t, 0.12, 2200, 1800, 'sine');
        this._tone(o, t, 0.08, 1100, 900, 'square', 0.3);
        break;
      }
      case 'hurt': {
        const o = v(0.8);
        this._noise(o, t, 0.18, 400, 100);
        this._tone(o, t, 0.2, 110, 60, 'sine', 0.9);
        break;
      }
      case 'kill': {
        const o = v(0.5);
        this._tone(o, t, 0.09, 660, 660, 'triangle');
        this._tone(o, t + 0.09, 0.14, 880, 880, 'triangle');
        break;
      }
      case 'death':
        this._tone(v(0.7), t, 0.5, 220, 40, 'sawtooth', 0.6);
        break;
      case 'spawn':
        this._tone(v(0.4), t, 0.3, 200, 800, 'sine');
        break;
      case 'step':
        this._noise(v(0.25), t, 0.06, 500, 150);
        break;
      case 'land':
        this._noise(v(0.35), t, 0.1, 350, 80);
        break;
      case 'jump':
        this._noise(v(0.15), t, 0.08, 900, 300, 'bandpass', 1);
        break;
      case 'switch':
        this._tone(v(0.3), t, 0.05, 500, 700, 'square', 0.3);
        break;
      case 'impact':
        this._noise(v(0.4), t, 0.07, 3500, 600, 'bandpass', 1);
        break;
      case 'end':
        this._tone(v(0.5), t, 0.6, 440, 220, 'triangle');
        break;
      default:
    }
  }
}
