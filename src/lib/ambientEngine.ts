/**
 * ambientEngine.ts
 * Procedural pond ambience — water, crickets, occasional frog croaks.
 * No audio files. Pure Web Audio API.
 */

class AmbientEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private running = false;
  private cronkTimer: ReturnType<typeof setTimeout> | null = null;

  // ── Bootstrap ────────────────────────────────────────────────────────────────

  private getCtx(): AudioContext {
    if (!this.ctx) this.ctx = new AudioContext();
    return this.ctx;
  }

  // ── White noise buffer (shared) ──────────────────────────────────────────────

  private makeNoiseBuffer(ctx: AudioContext, seconds = 3): AudioBuffer {
    const length = ctx.sampleRate * seconds;
    const buf = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
    return buf;
  }

  // ── Water layer ──────────────────────────────────────────────────────────────
  // Looping white noise → lowpass → slow LFO tremolo

  private buildWater(ctx: AudioContext, dest: GainNode): void {
    const buf = this.makeNoiseBuffer(ctx, 4);

    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;

    // Lowpass to get a soft water wash
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 360;
    lp.Q.value = 0.8;

    // Very slow LFO for subtle ripple effect
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 0.045;

    const lfo = ctx.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.value = 0.18; // ~once per 5.5s

    const waterGain = ctx.createGain();
    waterGain.gain.value = 0.11;

    lfo.connect(lfoGain);
    lfoGain.connect(waterGain.gain);

    src.connect(lp);
    lp.connect(waterGain);
    waterGain.connect(dest);

    src.start();
    lfo.start();
  }

  // ── Cricket layer ────────────────────────────────────────────────────────────
  // 4 oscillators around 4.8kHz, each AM-modulated at slightly different rates

  private buildCrickets(ctx: AudioContext, dest: GainNode): void {
    const configs = [
      { freq: 4780, modRate: 43.2, pan: -0.6, gain: 0.028 },
      { freq: 4820, modRate: 46.7, pan:  0.5, gain: 0.022 },
      { freq: 4755, modRate: 49.1, pan: -0.2, gain: 0.018 },
      { freq: 4840, modRate: 51.4, pan:  0.7, gain: 0.020 },
    ];

    for (const cfg of configs) {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = cfg.freq;

      // AM modulator
      const modOsc = ctx.createOscillator();
      modOsc.type = 'sine';
      modOsc.frequency.value = cfg.modRate;

      const modGain = ctx.createGain();
      modGain.gain.value = 0.5;

      const carrierGain = ctx.createGain();
      carrierGain.gain.value = 0.5; // DC offset so AM goes 0→1

      // Panner
      const panner = ctx.createStereoPanner();
      panner.pan.value = cfg.pan;

      const gain = ctx.createGain();
      gain.gain.value = cfg.gain;

      modOsc.connect(modGain);
      modGain.connect(carrierGain.gain);

      osc.connect(carrierGain);
      carrierGain.connect(panner);
      panner.connect(gain);
      gain.connect(dest);

      osc.start();
      modOsc.start();
    }
  }

  // ── Frog croak ───────────────────────────────────────────────────────────────
  // Single bandpass-filtered noise burst with attack/decay envelope

  private scheduleCroak(): void {
    if (!this.running || !this.ctx || !this.master) return;
    const ctx = this.ctx;
    const dest = this.master;

    const delay = (8 + Math.random() * 18) * 1000;

    this.cronkTimer = setTimeout(() => {
      if (!this.running) return;

      const buf = this.makeNoiseBuffer(ctx, 0.3);
      const src = ctx.createBufferSource();
      src.buffer = buf;

      // Bandpass centred around a frog-ish frequency (220–420Hz)
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 220 + Math.random() * 200;
      bp.Q.value = 8;

      // Second harmonic layer for richness
      const bp2 = ctx.createBiquadFilter();
      bp2.type = 'bandpass';
      bp2.frequency.value = bp.frequency.value * 1.6;
      bp2.Q.value = 12;

      const env = ctx.createGain();
      env.gain.setValueAtTime(0, ctx.currentTime);
      env.gain.linearRampToValueAtTime(0.22, ctx.currentTime + 0.02);
      env.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.28);

      const pan = ctx.createStereoPanner();
      pan.pan.value = (Math.random() - 0.5) * 1.2;

      src.connect(bp);
      src.connect(bp2);
      bp.connect(env);
      bp2.connect(env);
      env.connect(pan);
      pan.connect(dest);

      src.start(ctx.currentTime);

      this.scheduleCroak();
    }, delay);
  }

  // ── Public API ───────────────────────────────────────────────────────────────

  start(): void {
    if (this.running) return;
    this.running = true;

    const ctx = this.getCtx();
    if (ctx.state === 'suspended') ctx.resume();

    this.master = ctx.createGain();
    this.master.gain.setValueAtTime(0, ctx.currentTime);
    this.master.gain.linearRampToValueAtTime(1, ctx.currentTime + 2.5); // 2.5s fade-in
    this.master.connect(ctx.destination);

    this.buildWater(ctx, this.master);
    this.buildCrickets(ctx, this.master);
    this.scheduleCroak();
  }

  stop(): void {
    if (!this.running) return;
    this.running = false;

    if (this.cronkTimer) { clearTimeout(this.cronkTimer); this.cronkTimer = null; }

    if (this.master && this.ctx) {
      const ctx = this.ctx;
      this.master.gain.setValueAtTime(this.master.gain.value, ctx.currentTime);
      this.master.gain.linearRampToValueAtTime(0, ctx.currentTime + 1.2); // 1.2s fade-out
      const m = this.master;
      setTimeout(() => { try { m.disconnect(); } catch {} }, 1500);
      this.master = null;
    }

    // Close and nullify so next start() gets a fresh context
    if (this.ctx) {
      const c = this.ctx;
      this.ctx = null;
      setTimeout(() => { try { c.close(); } catch {} }, 1600);
    }
  }

  /** Returns new muted state */
  toggle(): boolean {
    if (this.running) { this.stop(); return true; }
    else { this.start(); return false; }
  }

  get isRunning(): boolean { return this.running; }
}

export const ambient = new AmbientEngine();