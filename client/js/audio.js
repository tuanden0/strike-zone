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
  _out(pos, listener, vol, panOff = 0) {
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
    } else if (panOff && c.createStereoPanner) { // non-positional but panned (own footsteps: left / right foot)
      const pan = c.createStereoPanner();
      pan.pan.value = panOff;
      g.connect(pan);
      node = pan;
    }
    g.gain.value = gain;
    node.connect(this.master);
    return g;
  }

  _noise(out, t0, dur, f0, f1, type = 'lowpass', q = 1, vol = 1) {
    const c = this.ctx;
    const src = c.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = c.createBiquadFilter();
    f.type = type;
    f.Q.value = q;
    f.frequency.setValueAtTime(f0, t0);
    f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t0 + dur);
    const e = c.createGain();
    e.gain.setValueAtTime(vol, t0);
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

  // One footfall on a surface (footsteps.js picks the surface). p = pitch factor (left / right foot, hard landings go lower).
  _stepSound(surface, o, t, p) {
    switch (surface) {
      case 'sand': // soft crunch: long low-passed hiss with a bit of grit
        this._noise(o, t, 0.16, 1600 * p, 350 * p, 'lowpass', 1, 0.9);
        this._noise(o, t + 0.02, 0.09, 3500 * p, 1800 * p, 'bandpass', 0.8, 0.35);
        this._tone(o, t, 0.08, 90 * p, 60 * p, 'sine', 0.3);
        break;
      case 'stone': // hard tock with a sharp click on top
        this._tone(o, t, 0.05, 240 * p, 120 * p, 'sine', 0.6);
        this._noise(o, t, 0.045, 3000 * p, 1200 * p, 'bandpass', 2.5, 0.9);
        this._noise(o, t, 0.012, 6000, 4000, 'highpass', 0.7, 0.35);
        break;
      case 'wood': // hollow knock
        this._tone(o, t, 0.1, 200 * p, 120 * p, 'triangle', 0.8);
        this._tone(o, t, 0.06, 400 * p, 250 * p, 'sine', 0.35);
        this._noise(o, t, 0.06, 1000 * p, 550 * p, 'bandpass', 3, 0.6);
        break;
      case 'metal': // clank: ringing partials + thump
        this._tone(o, t, 0.22, 640 * p, 600 * p, 'sine', 0.35);
        this._tone(o, t, 0.16, 1230 * p, 1180 * p, 'sine', 0.25);
        this._noise(o, t, 0.03, 3200 * p, 2200 * p, 'bandpass', 1.5, 0.7);
        this._tone(o, t, 0.08, 110 * p, 70 * p, 'sine', 0.6);
        break;
      default: // concrete / asphalt: dry heel tap
        this._tone(o, t, 0.06, 140 * p, 70 * p, 'sine', 0.8);
        this._noise(o, t, 0.07, 1800 * p, 700 * p, 'bandpass', 1.2, 0.8);
        this._noise(o, t, 0.015, 4500, 3000, 'highpass', 0.7, 0.3);
    }
  }

  // opts (optional): {gain, pitch, pan, surface} - used by footsteps.js (gain multiplies the sound, pan offsets non-positional sounds)
  play(name, pos = null, listener = null, opts = null) {
    const c = this.ctx;
    if (!c || c.state !== 'running') return;
    const t = c.currentTime;
    const gm = opts && opts.gain !== undefined ? opts.gain : 1;
    const pit = (opts && opts.pitch) || 1;
    const v = (x) => this._out(pos, listener, x * gm, (opts && opts.pan) || 0);
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
      case 'step': // generic footfall (the game plays step_<surface>)
      case 'step_concrete':
      case 'step_sand':
      case 'step_stone':
      case 'step_wood':
      case 'step_metal':
        this._stepSound(name === 'step' ? 'concrete' : name.slice(5), v(0.6), t, pit);
        break;
      case 'land': { // thud (louder / deeper for harder landings) + the surface's own sound
        this._stepSound((opts && opts.surface) || 'concrete', v(0.45), t, pit * 0.85);
        const o = v(0.8);
        this._noise(o, t, 0.14, 700 * pit, 110, 'lowpass', 1, 0.9);
        this._tone(o, t, 0.16, 95 * pit, 38, 'sine', 1.0);
        break;
      }
      case 'jump':
        this._noise(v(0.15), t, 0.08, 900, 300, 'bandpass', 1);
        break;
      case 'switch':
        this._tone(v(0.3), t, 0.05, 500, 700, 'square', 0.3);
        break;
      case 'impact':
        this._noise(v(0.4), t, 0.07, 3500, 600, 'bandpass', 1);
        break;
      case 'throw':
        this._noise(v(0.25), t, 0.12, 700, 2200, 'bandpass', 1);
        break;
      case 'boom': {
        const o = v(1.4);
        this._noise(o, t, 0.9, 1800, 60);
        this._tone(o, t, 0.7, 90, 25, 'sine', 1.4);
        break;
      }
      case 'flashbang': {
        const o = v(1.0);
        this._noise(o, t, 0.25, 9000, 1500, 'highpass', 0.7);
        this._tone(o, t + 0.02, 1.2, 3200, 3000, 'sine', 0.25);
        break;
      }
      case 'smoke':
        this._noise(v(0.5), t, 1.4, 5000, 800, 'highpass', 0.5);
        break;
      case 'scope_in': { // servo whirr rising, then the lens-lock click
        const o = v(0.35);
        this._tone(o, t, 0.2, 260, 820, 'triangle', 0.5);
        this._noise(o, t, 0.2, 1200, 3200, 'bandpass', 2.5);
        this._tone(o, t + 0.2, 0.025, 2000, 900, 'square', 0.4);
        break;
      }
      case 'scope_out': { // click, then the whirr falling away
        const o = v(0.3);
        this._tone(o, t, 0.025, 1500, 700, 'square', 0.4);
        this._tone(o, t + 0.02, 0.16, 780, 240, 'triangle', 0.4);
        this._noise(o, t + 0.02, 0.16, 3000, 1000, 'bandpass', 2.5);
        break;
      }
      case 'end':
        this._tone(v(0.5), t, 0.6, 440, 220, 'triangle');
        break;
      default:
    }
  }
}
