// Sound, synthesised with Web Audio (no audio files): terminal ambience that
// follows the crowd, jet noise for aircraft on the runway, the airport chime
// for announcements, and small UI sounds. Starts on the first user gesture.

import type { GameState } from '../game/types';

export interface SoundSettings { volume: number; ambience: boolean; effects: boolean }

export class Sound {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private hum!: GainNode;
  private crowd!: GainNode;
  private jets!: GainNode;
  private jetFilter!: BiquadFilterNode;
  constructor(private settings: SoundSettings) {}

  /** Browsers only allow audio after a click or key press. */
  unlock(): void {
    if (this.ctx) { void this.ctx.resume(); return; }
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.settings.volume;
    this.master.connect(ctx.destination);
    const noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = noise.getChannelData(0);
    let b = 0;
    for (let i = 0; i < d.length; i++) { b = 0.97 * b + 0.03 * (Math.random() * 2 - 1); d[i] = b * 6; } // soft brown-ish noise
    const loop = () => { const src = ctx.createBufferSource(); src.buffer = noise; src.loop = true; src.start(); return src; };
    // terminal: low air-conditioning hum plus a murmur that grows with the crowd
    this.hum = ctx.createGain(); this.hum.gain.value = 0;
    const humF = ctx.createBiquadFilter(); humF.type = 'lowpass'; humF.frequency.value = 180;
    loop().connect(humF).connect(this.hum).connect(this.master);
    this.crowd = ctx.createGain(); this.crowd.gain.value = 0;
    const crowdF = ctx.createBiquadFilter(); crowdF.type = 'bandpass'; crowdF.frequency.value = 650; crowdF.Q.value = 0.7;
    loop().connect(crowdF).connect(this.crowd).connect(this.master);
    // jets: filtered roar, brighter when loud
    this.jets = ctx.createGain(); this.jets.gain.value = 0;
    this.jetFilter = ctx.createBiquadFilter(); this.jetFilter.type = 'lowpass'; this.jetFilter.frequency.value = 500;
    loop().connect(this.jetFilter).connect(this.jets).connect(this.master);
  }

  apply(settings: SoundSettings): void {
    this.settings = settings;
    if (this.ctx) this.master.gain.setTargetAtTime(settings.volume, this.ctx.currentTime, 0.1);
  }

  /** Every frame: ambience follows the airport (silent while paused). */
  update(s: GameState, running: boolean): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    const amb = this.settings.ambience && running;
    const people = Math.min(1, s.pax.length / 900);
    this.hum.gain.setTargetAtTime(amb ? 0.05 : 0, t, 0.5);
    this.crowd.gain.setTargetAtTime(amb ? 0.015 + 0.07 * people : 0, t, 0.8);
    let roar = 0;
    for (const f of s.flights) {
      if (f.phase === 'takeoff') roar += 1;
      else if (f.phase === 'landing') roar += 0.6;
      else if (f.phase === 'approach' && f.alt < 4) roar += 0.4;
      else if (f.phase === 'taxi_in' || f.phase === 'taxi_out') roar += 0.08;
    }
    const jet = amb ? Math.min(0.25, roar * 0.12) : 0;
    this.jets.gain.setTargetAtTime(jet, t, 0.6);
    this.jetFilter.frequency.setTargetAtTime(350 + jet * 2400, t, 0.6);
  }

  private tone(freq: number, start: number, dur: number, gain: number, type: OscillatorType = 'sine'): void {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.value = freq;
    g.gain.setValueAtTime(0, start);
    g.gain.linearRampToValueAtTime(gain, start + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
    o.connect(g).connect(this.master);
    o.start(start);
    o.stop(start + dur + 0.05);
  }

  /** One-shot effects. */
  play(kind: 'click' | 'build' | 'cash' | 'chime' | 'alert'): void {
    const ctx = this.ctx;
    if (!ctx || !this.settings.effects) return;
    const t = ctx.currentTime;
    switch (kind) {
      case 'click': this.tone(1400, t, 0.04, 0.05, 'triangle'); break;
      case 'build': this.tone(140, t, 0.18, 0.25, 'triangle'); this.tone(90, t + 0.03, 0.22, 0.2); break;
      case 'cash': this.tone(1320, t, 0.12, 0.08); this.tone(1980, t + 0.07, 0.18, 0.07); break;
      case 'chime': // the classic three-note airport announcement chime
        this.tone(523.25, t, 0.9, 0.12); this.tone(659.25, t + 0.32, 0.9, 0.12); this.tone(783.99, t + 0.64, 1.3, 0.12);
        break;
      case 'alert': this.tone(392, t, 0.35, 0.1, 'triangle'); this.tone(311.13, t + 0.18, 0.5, 0.1, 'triangle'); break;
    }
  }
}
