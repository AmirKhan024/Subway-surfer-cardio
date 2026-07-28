/**
 * Kriya Runner audio — 100% procedural Web Audio. Zero asset files, zero
 * license surface (nothing recorded, nothing attributed), zip stays
 * self-contained.
 *
 * NOTE (music): the pad is a gentle synthesized loop — Cmaj7 → Am7 → Fmaj7
 * → G, ~6s per chord, two slightly-detuned triangle oscillators per voice
 * through a low-pass filter with a slow breathing LFO. If Govind prefers a
 * recorded CC0 loop later: drop the file in public/audio/, replace
 * startPad() with an <audio>/BufferSource loop, keep this API.
 *
 * Purity contract: the ENGINE never imports this — the layer drains engine
 * events and calls sfx() at the edge. Every public method is SSR-guarded
 * and no-throw (audio failure must never break the game).
 */

export type SfxName =
  | 'coin'
  | 'kosha'
  | 'jump'
  | 'squat'
  | 'stumble'
  | 'gameover'
  | 'countdown'
  | 'go'
  | 'whoosh'
  | 'land';

const PREF_KEY = 'kr1-audio';

interface AudioPrefs {
  muted: boolean;
  volume: number; // 0..1
}

function loadPrefs(): AudioPrefs {
  try {
    const raw = localStorage.getItem(PREF_KEY);
    if (raw) {
      const p = JSON.parse(raw) as AudioPrefs;
      return { muted: !!p.muted, volume: clamp01(p.volume ?? 0.7) };
    }
  } catch {
    /* defaults */
  }
  return { muted: false, volume: 0.7 };
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

class AudioManager {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private musicGain: GainNode | null = null;
  private padNodes: { osc: OscillatorNode; gain: GainNode }[] = [];
  private padTimer: ReturnType<typeof setInterval> | null = null;
  private padChordIdx = 0;
  private prefs: AudioPrefs = { muted: false, volume: 0.7 };
  private initialized = false;

  /** Create the AudioContext — MUST be called from a user gesture. */
  init(): void {
    if (typeof window === 'undefined' || this.initialized) return;
    try {
      const Ctx =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctx) return;
      this.ctx = new Ctx();
      this.prefs = loadPrefs();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.prefs.muted ? 0 : this.prefs.volume;
      this.master.connect(this.ctx.destination);
      this.musicGain = this.ctx.createGain();
      this.musicGain.gain.value = 0.22; // music sits well under the SFX
      this.musicGain.connect(this.master);
      this.initialized = true;
      if (this.ctx.state === 'suspended') void this.ctx.resume();
    } catch {
      this.ctx = null;
    }
  }

  isMuted(): boolean {
    return this.prefs.muted;
  }

  setMuted(muted: boolean): void {
    this.prefs.muted = muted;
    this.persist();
    try {
      this.master?.gain.setTargetAtTime(
        muted ? 0 : this.prefs.volume,
        this.ctx?.currentTime ?? 0,
        0.05,
      );
    } catch {
      /* no-op */
    }
  }

  setVolume(volume: number): void {
    this.prefs.volume = clamp01(volume);
    this.persist();
    if (!this.prefs.muted) {
      try {
        this.master?.gain.setTargetAtTime(this.prefs.volume, this.ctx?.currentTime ?? 0, 0.05);
      } catch {
        /* no-op */
      }
    }
  }

  private persist(): void {
    try {
      localStorage.setItem(PREF_KEY, JSON.stringify(this.prefs));
    } catch {
      /* storage unavailable */
    }
  }

  // ── music: gentle ambient pad ─────────────────────────────────────────

  /**
   * "The Final Run" pad: a drone-and-fifth shape rather than the old jazz
   * ii-V colour — a low tonic held under a moving upper voice, which is the
   * cheapest honest gesture toward a bansuri over a drone.
   *
   * TODO (audio assets): the design calls for a real bansuri melody, a
   * cadence drum tracking stride rate, mithun bells panning in the dark, and
   * a dungchen at the dawn. All of those need SAMPLE FILES, and this repo
   * ships zero audio assets by design (see the header note). When assets
   * land, drop them in public/audio/ and replace startPad() with a
   * BufferSource loop — this API does not need to change.
   */
  private static CHORDS: number[][] = [
    [146.83, 220.0, 293.66, 440.0], // D drone + fifth, open
    [146.83, 220.0, 261.63, 392.0], // upper voice steps down
    [146.83, 196.0, 293.66, 349.23], // suspended, unresolved
    [146.83, 220.0, 293.66, 329.63], // settles back toward the drone
  ];

  playMusic(): void {
    if (!this.ctx || !this.musicGain || this.padTimer) return;
    try {
      this.startChord(AudioManager.CHORDS[this.padChordIdx]);
      this.padTimer = setInterval(() => {
        this.padChordIdx = (this.padChordIdx + 1) % AudioManager.CHORDS.length;
        this.crossfadeToChord(AudioManager.CHORDS[this.padChordIdx]);
      }, 6000);
    } catch {
      /* audio unavailable */
    }
  }

  private startChord(freqs: number[]): void {
    if (!this.ctx || !this.musicGain) return;
    const now = this.ctx.currentTime;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 900;
    filter.connect(this.musicGain);
    for (const f of freqs) {
      for (const detune of [-4, 4]) {
        const osc = this.ctx.createOscillator();
        osc.type = 'triangle';
        osc.frequency.value = f;
        osc.detune.value = detune;
        const gain = this.ctx.createGain();
        gain.gain.setValueAtTime(0, now);
        gain.gain.linearRampToValueAtTime(0.06, now + 2.2); // slow breathe-in
        osc.connect(gain);
        gain.connect(filter);
        osc.start();
        this.padNodes.push({ osc, gain });
      }
    }
  }

  private crossfadeToChord(freqs: number[]): void {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    const old = this.padNodes;
    this.padNodes = [];
    for (const n of old) {
      try {
        n.gain.gain.setTargetAtTime(0, now, 0.8);
        n.osc.stop(now + 3);
      } catch {
        /* already stopped */
      }
    }
    this.startChord(freqs);
  }

  stopMusic(): void {
    if (this.padTimer) {
      clearInterval(this.padTimer);
      this.padTimer = null;
    }
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    for (const n of this.padNodes) {
      try {
        n.gain.gain.setTargetAtTime(0, now, 0.4);
        n.osc.stop(now + 1.5);
      } catch {
        /* already stopped */
      }
    }
    this.padNodes = [];
  }

  /** Briefly duck the music (e.g. under the gameover sting). */
  duckMusic(seconds = 2): void {
    if (!this.ctx || !this.musicGain) return;
    try {
      const now = this.ctx.currentTime;
      this.musicGain.gain.setTargetAtTime(0.06, now, 0.1);
      this.musicGain.gain.setTargetAtTime(0.22, now + seconds, 0.5);
    } catch {
      /* no-op */
    }
  }

  // ── SFX: short synthesized blips ──────────────────────────────────────

  sfx(name: SfxName): void {
    if (!this.ctx || !this.master) return;
    try {
      switch (name) {
        case 'coin':
          // a mohur landing on stone: metal-on-metal tick, not a game chime.
          // Quiet and quick on purpose — dozens are picked up per run, and
          // the old bright rising ping dominated a level built on restraint.
          this.blip(2093, 0.028, 'square', 0.05);
          this.blip(1244.51, 0.07, 'triangle', 0.09, 0.012);
          break;
        case 'kosha':
          // sealing the pay-casket: the lid swings over on a brass hinge, the
          // latch drops, the box takes the weight, and the metal rings off.
          // Deliberately warmer and LONGER than 'coin' (a 28ms tick) — a mohur
          // is a tick, a Kosha is an event. It earns the length by being rare:
          // five clean actions, so at most a handful in a whole run.
          // NOTE: sweep() always starts at ctx.currentTime (no delay param),
          // so only the hinge sweeps; every later layer is a delayed blip.
          this.sweep(1480, 560, 0.11, 'triangle', 0.11); // hinge, lid coming over
          this.blip(880.0, 0.045, 'square', 0.075, 0.085); // latch, A5
          this.blip(1174.66, 0.05, 'square', 0.065, 0.105); // latch, D6
          this.blip(196.0, 0.17, 'triangle', 0.15, 0.115); // the casket's weight
          this.blip(130.81, 0.24, 'sine', 0.11, 0.135); // body, sub layer
          this.blip(1567.98, 0.34, 'sine', 0.055, 0.15); // brass ring-off
          break;
        case 'jump':
          this.sweep(300, 700, 0.18, 'sine', 0.2);
          break;
        case 'squat':
          this.sweep(420, 240, 0.2, 'sine', 0.16);
          break;
        case 'stumble':
          // boots losing the trail: a scuff of scree, then the heavier
          // catch of the body. Grounded and physical, NOT a failure buzzer —
          // the run carries on, and the sound should say so.
          this.sweep(520, 180, 0.14, 'triangle', 0.14);
          this.blip(96, 0.2, 'triangle', 0.2, 0.05);
          this.blip(62, 0.26, 'sine', 0.16, 0.09);
          break;
        case 'gameover':
          this.blip(392, 0.22, 'triangle', 0.2);
          this.blip(329.63, 0.22, 'triangle', 0.2, 0.22);
          this.blip(261.63, 0.4, 'triangle', 0.2, 0.44);
          break;
        case 'countdown':
          this.blip(660, 0.09, 'sine', 0.18);
          break;
        case 'go':
          this.blip(880, 0.16, 'sine', 0.2);
          break;
        case 'whoosh':
          // beam ripping overhead: fast falling airy sweep, punchy
          this.sweep(1600, 180, 0.26, 'triangle', 0.16);
          break;
        case 'land':
          // landing thud: low body hit + sub layer + short falling knock
          this.blip(150, 0.09, 'sine', 0.26);
          this.blip(90, 0.12, 'sine', 0.25);
          this.sweep(220, 70, 0.12, 'triangle', 0.22);
          break;
      }
    } catch {
      /* audio must never break the game */
    }
  }

  private blip(
    freq: number,
    duration: number,
    type: OscillatorType,
    peak: number,
    delay = 0,
  ): void {
    if (!this.ctx || !this.master) return;
    const t0 = this.ctx.currentTime + delay;
    const osc = this.ctx.createOscillator();
    osc.type = type;
    osc.frequency.value = freq;
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0, t0);
    gain.gain.linearRampToValueAtTime(peak, t0 + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + duration);
    osc.connect(gain);
    gain.connect(this.master);
    osc.start(t0);
    osc.stop(t0 + duration + 0.05);
  }

  private sweep(
    from: number,
    to: number,
    duration: number,
    type: OscillatorType,
    peak: number,
  ): void {
    if (!this.ctx || !this.master) return;
    const t0 = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(from, t0);
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, to), t0 + duration);
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0, t0);
    gain.gain.linearRampToValueAtTime(peak, t0 + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + duration);
    osc.connect(gain);
    gain.connect(this.master);
    osc.start(t0);
    osc.stop(t0 + duration + 0.05);
  }
}

export const audioManager = new AudioManager();
