export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.listenerPos = { x: 0, y: 0, z: 0 };
  }

  ensure() {
    if (this.ctx) return;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    this.ctx = new Ctx();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.85;
    this.master.connect(this.ctx.destination);
    this.reverb = this._makeReverb(1.6, 2.2);
    this.reverbGain = this.ctx.createGain();
    this.reverbGain.gain.value = 0.22;
    this.reverb.connect(this.reverbGain).connect(this.master);
    this._ambience();
  }

  resume() {
    if (this.ctx && this.ctx.state === "suspended") this.ctx.resume();
  }

  _makeReverb(duration, decay) {
    const ctx = this.ctx;
    const rate = ctx.sampleRate;
    const len = rate * duration;
    const buf = ctx.createBuffer(2, len, rate);
    for (let ch = 0; ch < 2; ch++) {
      const data = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) {
        data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
      }
    }
    const conv = ctx.createConvolver();
    conv.buffer = buf;
    return conv;
  }

  // Cached per rounded duration and reused — this weapon can fire at
  // 720rpm, and generating a fresh random sample buffer on every shot
  // (gunshot + click alone is two per shot) is unnecessary CPU churn that
  // competes with rendering for the same thread budget.
  _noiseBuffer(duration = 1) {
    const key = Math.round(duration * 1000);
    this._noiseCache = this._noiseCache || new Map();
    const cached = this._noiseCache.get(key);
    if (cached) return cached;
    const ctx = this.ctx;
    const len = Math.max(1, Math.round(ctx.sampleRate * duration));
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    this._noiseCache.set(key, buf);
    return buf;
  }

  _panner(pos) {
    const ctx = this.ctx;
    if (!pos) return null;
    const p = ctx.createPanner();
    p.panningModel = "equalpower";
    p.distanceModel = "inverse";
    p.refDistance = 4;
    p.maxDistance = 80;
    p.rolloffFactor = 1.1;
    p.positionX.value = pos.x; p.positionY.value = pos.y; p.positionZ.value = pos.z;
    return p;
  }

  setListener(pos, forward) {
    if (!this.ctx) return;
    const l = this.ctx.listener;
    const t = this.ctx.currentTime;
    if (l.positionX) {
      l.positionX.setValueAtTime(pos.x, t);
      l.positionY.setValueAtTime(pos.y, t);
      l.positionZ.setValueAtTime(pos.z, t);
      l.forwardX.setValueAtTime(forward.x, t);
      l.forwardY.setValueAtTime(forward.y, t);
      l.forwardZ.setValueAtTime(forward.z, t);
      l.upX.setValueAtTime(0, t); l.upY.setValueAtTime(1, t); l.upZ.setValueAtTime(0, t);
    }
  }

  _ambience() {
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.value = 48;
    const gain = ctx.createGain();
    gain.gain.value = 0.02;
    const noise = ctx.createBufferSource();
    noise.buffer = this._noiseBuffer(4);
    noise.loop = true;
    const noiseFilter = ctx.createBiquadFilter();
    noiseFilter.type = "lowpass";
    noiseFilter.frequency.value = 340;
    const noiseGain = ctx.createGain();
    noiseGain.gain.value = 0.035;
    noise.connect(noiseFilter).connect(noiseGain).connect(this.master);
    noise.start();
    osc.connect(gain).connect(this.master);
    osc.start();
  }

  playGunshot(pos, { pitch = 1 } = {}) {
    this.ensure();
    const ctx = this.ctx; const t = ctx.currentTime;
    const out = this._panner(pos) || this.master;
    if (pos) out.connect(this.master);

    const noise = ctx.createBufferSource();
    noise.buffer = this._noiseBuffer(0.25);
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass"; bp.frequency.value = 1800 * pitch; bp.Q.value = 0.7;
    const env = ctx.createGain();
    env.gain.setValueAtTime(1.0, t);
    env.gain.exponentialRampToValueAtTime(0.001, t + 0.16);
    noise.connect(bp).connect(env).connect(out);
    if (pos) { env.connect(this.reverb); }
    noise.start(t); noise.stop(t + 0.2);

    const osc = ctx.createOscillator();
    osc.type = "triangle";
    osc.frequency.setValueAtTime(160 * pitch, t);
    osc.frequency.exponentialRampToValueAtTime(48 * pitch, t + 0.09);
    const oenv = ctx.createGain();
    oenv.gain.setValueAtTime(0.9, t);
    oenv.gain.exponentialRampToValueAtTime(0.001, t + 0.1);
    osc.connect(oenv).connect(out);
    osc.start(t); osc.stop(t + 0.12);

    const click = ctx.createBufferSource();
    click.buffer = this._noiseBuffer(0.02);
    const hp = ctx.createBiquadFilter();
    hp.type = "highpass"; hp.frequency.value = 3500;
    const cenv = ctx.createGain();
    cenv.gain.setValueAtTime(0.5, t);
    cenv.gain.exponentialRampToValueAtTime(0.001, t + 0.02);
    click.connect(hp).connect(cenv).connect(out);
    click.start(t);
  }

  playEnemyBolt(pos) {
    this.ensure();
    const ctx = this.ctx; const t = ctx.currentTime;
    const out = this._panner(pos) || this.master;
    if (pos) out.connect(this.master);
    const osc = ctx.createOscillator();
    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(900, t);
    osc.frequency.exponentialRampToValueAtTime(200, t + 0.18);
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.35, t);
    env.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
    const filt = ctx.createBiquadFilter();
    filt.type = "bandpass"; filt.frequency.value = 1200; filt.Q.value = 3;
    osc.connect(filt).connect(env).connect(out);
    osc.start(t); osc.stop(t + 0.22);
  }

  playEmptyClick() {
    this.ensure();
    const ctx = this.ctx; const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = "square"; osc.frequency.value = 220;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.25, t);
    env.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
    osc.connect(env).connect(this.master);
    osc.start(t); osc.stop(t + 0.06);
  }

  playReload(stage = 0) {
    this.ensure();
    const ctx = this.ctx; const t = ctx.currentTime;
    const freqs = [180, 260, 140, 320];
    const osc = ctx.createOscillator();
    osc.type = "square";
    osc.frequency.value = freqs[stage % freqs.length];
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.22, t);
    env.gain.exponentialRampToValueAtTime(0.001, t + 0.07);
    osc.connect(env).connect(this.master);
    osc.start(t); osc.stop(t + 0.08);
  }

  playFootstep(intensity = 0.7) {
    this.ensure();
    const ctx = this.ctx; const t = ctx.currentTime;
    const noise = ctx.createBufferSource();
    noise.buffer = this._noiseBuffer(0.12);
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass"; lp.frequency.value = 500 + Math.random() * 200;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.18 * intensity, t);
    env.gain.exponentialRampToValueAtTime(0.001, t + 0.09);
    noise.connect(lp).connect(env).connect(this.master);
    noise.start(t); noise.stop(t + 0.1);
  }

  playHitmarker(crit = false) {
    this.ensure();
    const ctx = this.ctx; const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(crit ? 1400 : 900, t);
    osc.frequency.exponentialRampToValueAtTime(crit ? 700 : 500, t + 0.05);
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.3, t);
    env.gain.exponentialRampToValueAtTime(0.001, t + 0.08);
    osc.connect(env).connect(this.master);
    osc.start(t); osc.stop(t + 0.09);
  }

  playCoreExplode(pos) {
    this.ensure();
    const ctx = this.ctx; const t = ctx.currentTime;
    const out = this._panner(pos) || this.master;
    if (pos) { out.connect(this.master); out.connect(this.reverb); }
    const noise = ctx.createBufferSource();
    noise.buffer = this._noiseBuffer(0.6);
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass"; lp.frequency.setValueAtTime(2200, t);
    lp.frequency.exponentialRampToValueAtTime(120, t + 0.5);
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.6, t);
    env.gain.exponentialRampToValueAtTime(0.001, t + 0.55);
    noise.connect(lp).connect(env).connect(out);
    noise.start(t); noise.stop(t + 0.6);
  }

  playAlert(pos) {
    this.ensure();
    const ctx = this.ctx; const t = ctx.currentTime;
    const out = this._panner(pos) || this.master;
    if (pos) out.connect(this.master);
    [0, 0.12].forEach((off, i) => {
      const osc = ctx.createOscillator();
      osc.type = "square";
      osc.frequency.setValueAtTime(520 + i * 180, t + off);
      const env = ctx.createGain();
      env.gain.setValueAtTime(0.12, t + off);
      env.gain.exponentialRampToValueAtTime(0.001, t + off + 0.1);
      osc.connect(env).connect(out);
      osc.start(t + off); osc.stop(t + off + 0.12);
    });
  }

  playDamage() {
    this.ensure();
    const ctx = this.ctx; const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = "sawtooth"; osc.frequency.setValueAtTime(150, t);
    osc.frequency.exponentialRampToValueAtTime(60, t + 0.25);
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.22, t);
    env.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
    osc.connect(env).connect(this.master);
    osc.start(t); osc.stop(t + 0.26);
  }
}
