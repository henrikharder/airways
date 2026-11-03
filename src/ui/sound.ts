// Small synthesized soundscape (Web Audio, no audio files): jet whoosh,
// cash chime, split-flap clatter, airport ambience and a fanfare.

const PREF = 'airways.sound';

export class Sound {
  enabled: boolean;
  private ac: AudioContext | null = null;
  private master: GainNode | null = null;
  private ambience: { src: AudioBufferSourceNode; gain: GainNode } | null = null;
  private last: Record<string, number> = {};

  constructor() {
    let v: string | null = null;
    try { v = localStorage.getItem(PREF); } catch { /* ignore */ }
    this.enabled = v !== 'off';
  }

  toggle(): void {
    this.enabled = !this.enabled;
    try { localStorage.setItem(PREF, this.enabled ? 'on' : 'off'); } catch { /* ignore */ }
    if (!this.enabled) this.setAmbience(false);
  }

  /** Must be called from a user gesture before audio can play. */
  unlock(): void {
    if (!this.ac) {
      try {
        this.ac = new AudioContext();
        this.master = this.ac.createGain();
        this.master.gain.value = 0.5;
        this.master.connect(this.ac.destination);
      } catch {
        return;
      }
    }
    if (this.ac.state === 'suspended') void this.ac.resume();
  }

  private ready(key: string, gapMs: number): AudioContext | null {
    if (!this.enabled || !this.ac || this.ac.state !== 'running') return null;
    const now = performance.now();
    if (now - (this.last[key] ?? 0) < gapMs) return null;
    this.last[key] = now;
    return this.ac;
  }

  private noise(ac: AudioContext, seconds: number, brown = false): AudioBuffer {
    const buf = ac.createBuffer(1, Math.floor(ac.sampleRate * seconds), ac.sampleRate);
    const d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < d.length; i++) {
      const w = Math.random() * 2 - 1;
      if (brown) { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; } else d[i] = w;
    }
    return buf;
  }

  whoosh(): void {
    const ac = this.ready('whoosh', 1500);
    if (!ac) return;
    const src = ac.createBufferSource();
    src.buffer = this.noise(ac, 1.6);
    const f = ac.createBiquadFilter();
    f.type = 'bandpass';
    f.Q.value = 0.8;
    f.frequency.setValueAtTime(300, ac.currentTime);
    f.frequency.exponentialRampToValueAtTime(1400, ac.currentTime + 1.4);
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, ac.currentTime);
    g.gain.exponentialRampToValueAtTime(0.09, ac.currentTime + 0.5);
    g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + 1.5);
    src.connect(f).connect(g).connect(this.master!);
    src.start();
  }

  private tone(ac: AudioContext, freq: number, at: number, dur: number, vol: number, type: OscillatorType = 'sine'): void {
    const o = ac.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, ac.currentTime + at);
    g.gain.exponentialRampToValueAtTime(vol, ac.currentTime + at + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + at + dur);
    o.connect(g).connect(this.master!);
    o.start(ac.currentTime + at);
    o.stop(ac.currentTime + at + dur + 0.05);
  }

  cash(): void {
    const ac = this.ready('cash', 900);
    if (!ac) return;
    this.tone(ac, 1318.5, 0, 0.12, 0.05, 'triangle');
    this.tone(ac, 1975.5, 0.07, 0.25, 0.05, 'triangle');
  }

  flap(count: number): void {
    const ac = this.ready('flap', 120);
    if (!ac || count <= 0) return;
    const n = Math.min(14, count);
    for (let i = 0; i < n; i++) {
      const src = ac.createBufferSource();
      src.buffer = this.noise(ac, 0.015);
      const f = ac.createBiquadFilter();
      f.type = 'highpass';
      f.frequency.value = 2500;
      const g = ac.createGain();
      g.gain.value = 0.05;
      src.connect(f).connect(g).connect(this.master!);
      src.start(ac.currentTime + i * 0.018 + Math.random() * 0.01);
    }
  }

  chime(): void {
    const ac = this.ready('chime', 2000);
    if (!ac) return;
    this.tone(ac, 659.3, 0, 0.6, 0.06);
    this.tone(ac, 523.3, 0.35, 0.9, 0.06);
  }

  fanfare(): void {
    const ac = this.ready('fanfare', 1500);
    if (!ac) return;
    [523.3, 659.3, 784, 1046.5].forEach((f, i) => this.tone(ac, f, i * 0.11, 0.45, 0.06, 'triangle'));
  }

  click(): void {
    const ac = this.ready('click', 40);
    if (!ac) return;
    this.tone(ac, 1800, 0, 0.03, 0.02, 'square');
  }

  /** Low airport hum while the clock is running. */
  setAmbience(on: boolean): void {
    const ac = this.ac;
    if (!on || !this.enabled || !ac || ac.state !== 'running') {
      if (this.ambience) {
        const { src, gain } = this.ambience;
        gain.gain.setTargetAtTime(0.0001, ac?.currentTime ?? 0, 0.3);
        setTimeout(() => src.stop(), 1200);
        this.ambience = null;
      }
      return;
    }
    if (this.ambience) return;
    const src = ac.createBufferSource();
    src.buffer = this.noise(ac, 4, true);
    src.loop = true;
    const f = ac.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 420;
    const gain = ac.createGain();
    gain.gain.value = 0.0001;
    gain.gain.setTargetAtTime(0.05, ac.currentTime, 1);
    src.connect(f).connect(gain).connect(this.master!);
    src.start();
    this.ambience = { src, gain };
  }
}
