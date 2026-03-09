/**
 * soundEngine.ts
 *
 * Procedural sound effects via Web Audio API.
 * No samples, no dependencies, no network requests.
 * All sounds are synthesised from oscillators and noise.
 *
 * Usage:
 *   import { sounds } from '@/lib/soundEngine'
 *   sounds.pop()
 *   sounds.splash()
 *   sounds.switchFrog()
 *   sounds.poke()
 *   sounds.silence()  // eerie tone when frog speaks unprompted
 *
 * Volume is kept deliberately subtle — this is atmosphere, not UI feedback.
 * The engine lazy-initialises AudioContext on first call (browser autoplay policy).
 */

type SoundName = 'pop' | 'splash' | 'switchFrog' | 'poke' | 'silence';

class SoundEngine {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private _muted = false;

  private getCtx(): AudioContext {
    if (!this.ctx) {
      this.ctx = new AudioContext();
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.value = 0.18; // global subtle volume
      this.masterGain.connect(this.ctx.destination);
    }
    // Resume if suspended (browser autoplay policy)
    if (this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
    return this.ctx;
  }

  get muted() { return this._muted; }

  toggle() {
    this._muted = !this._muted;
    return this._muted;
  }

  /** Soft bubble pop — interruption lands */
  pop() {
    if (this._muted) return;
    try {
      const ctx = this.getCtx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.connect(gain);
      gain.connect(this.masterGain!);

      osc.type = 'sine';
      const now = ctx.currentTime;
      osc.frequency.setValueAtTime(520, now);
      osc.frequency.exponentialRampToValueAtTime(180, now + 0.12);

      gain.gain.setValueAtTime(0.5, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.14);

      osc.start(now);
      osc.stop(now + 0.15);
    } catch { /* AudioContext may be unavailable in SSR */ }
  }

  /** Water splash — frog switch */
  switchFrog() {
    if (this._muted) return;
    try {
      const ctx = this.getCtx();
      const bufferSize = ctx.sampleRate * 0.2;
      const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
      const data = buffer.getChannelData(0);

      for (let i = 0; i < bufferSize; i++) {
        data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / bufferSize, 2.5);
      }

      const source = ctx.createBufferSource();
      source.buffer = buffer;

      const filter = ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.value = 800;
      filter.Q.value = 0.8;

      const gain = ctx.createGain();
      gain.gain.value = 0.55;

      source.connect(filter);
      filter.connect(gain);
      gain.connect(this.masterGain!);
      source.start();
    } catch { }
  }

  /** Deep splash — frog speaks unprompted from silence */
  silence() {
    if (this._muted) return;
    try {
      const ctx = this.getCtx();
      const now = ctx.currentTime;

      // Low eerie tone
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(110, now);
      osc.frequency.linearRampToValueAtTime(95, now + 0.6);

      gain.gain.setValueAtTime(0, now);
      gain.gain.linearRampToValueAtTime(0.4, now + 0.08);
      gain.gain.linearRampToValueAtTime(0, now + 0.65);

      osc.connect(gain);
      gain.connect(this.masterGain!);
      osc.start(now);
      osc.stop(now + 0.7);

      // Brief noise underlayer
      const bufSize = Math.floor(ctx.sampleRate * 0.15);
      const buf = ctx.createBuffer(1, bufSize, ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < bufSize; i++) {
        d[i] = (Math.random() * 2 - 1) * (1 - i / bufSize);
      }
      const ns = ctx.createBufferSource();
      ns.buffer = buf;
      const ng = ctx.createGain();
      ng.gain.value = 0.12;
      ns.connect(ng);
      ng.connect(this.masterGain!);
      ns.start(now + 0.05);
    } catch { }
  }

  /** Light poke blip — user taps a message */
  poke() {
    if (this._muted) return;
    try {
      const ctx = this.getCtx();
      const now = ctx.currentTime;

      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'triangle';
      osc.frequency.setValueAtTime(660, now);
      osc.frequency.exponentialRampToValueAtTime(440, now + 0.09);

      gain.gain.setValueAtTime(0.4, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.11);

      osc.connect(gain);
      gain.connect(this.masterGain!);
      osc.start(now);
      osc.stop(now + 0.12);
    } catch { }
  }

  /** Soft chime — easter egg fires */
  easterEgg() {
    if (this._muted) return;
    try {
      const ctx = this.getCtx();
      const now = ctx.currentTime;

      [523, 659, 784].forEach((freq, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        const t = now + i * 0.07;

        osc.type = 'sine';
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.3, t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.25);

        osc.connect(gain);
        gain.connect(this.masterGain!);
        osc.start(t);
        osc.stop(t + 0.26);
      });
    } catch { }
  }
}

// Singleton — one AudioContext per page
export const sounds = new SoundEngine();