/**
 * @file Audio: a Web Audio synthesiser and mixer.
 *
 * ## Why synthesis rather than audio files
 * The same reason there are no image assets: everything the game plays is
 * generated at runtime from oscillators and noise, so the soundtrack and effects
 * are original by construction and the whole game ships as source with no binary
 * payload.
 *
 * It also buys real advantages. Sounds are *parameterised*, so a hit can be
 * pitched by damage dealt and a footstep by surface material, without authoring
 * a variant per case. And the music can respond continuously to game state —
 * layers fading in as combat starts — rather than crossfading between fixed
 * stems.
 *
 * ## Architecture
 * A conventional bus layout:
 *
 *     voices -> [sfx bus]   -\
 *     voices -> [music bus] --> [master] -> destination
 *     voices -> [ambience]  -/
 *
 * Each bus has its own gain so the options screen can mix them independently,
 * and the master has a compressor so a boss death cannot clip.
 *
 * ## The autoplay policy
 * Browsers refuse to start an AudioContext without a user gesture. The manager
 * therefore constructs lazily and exposes `unlock()`, called from the first
 * input event. Everything before that is silently discarded rather than queued —
 * a burst of stale sounds on unlock would be worse than silence.
 */

import { clamp } from '../math/math-utils.js';

export class AudioManager {
  constructor() {
    /** @type {AudioContext|null} */
    this.ctx = null;
    /** @type {GainNode|null} */
    this.master = null;
    /** @type {Record<string, GainNode>} */
    this.buses = {};
    this.unlocked = false;
    this.enabled = true;

    this.volumes = { master: 0.7, sfx: 0.85, music: 0.55, ambience: 0.45 };

    /** Currently playing music generator. @type {any} */
    this._music = null;
    this._musicId = '';
    /** Scheduled note lookahead, seconds. */
    this._lookahead = 0.12;
    this._nextNoteTime = 0;
    this._step = 0;
    /** Combat intensity 0..1, drives adaptive music layers. */
    this.intensity = 0;
    this._targetIntensity = 0;

    /** Rate limiting: identical sounds within this window are dropped. */
    this._recent = new Map();
    this.minRepeatInterval = 0.035;
  }

  /**
   * Create the AudioContext. Must be called from a user gesture handler.
   * @returns {boolean} whether audio is now available
   */
  unlock() {
    if (this.unlocked) return true;
    const Ctor = typeof AudioContext !== 'undefined'
      ? AudioContext
      : /** @type {any} */ (globalThis).webkitAudioContext;
    if (!Ctor) return false;

    try {
      this.ctx = new Ctor();
    } catch {
      return false;
    }

    const ctx = this.ctx;
    // A compressor on the master keeps a boss death from clipping when twenty
    // voices land on the same frame.
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.knee.value = 22;
    comp.ratio.value = 8;
    comp.attack.value = 0.004;
    comp.release.value = 0.18;

    this.master = ctx.createGain();
    this.master.gain.value = this.volumes.master;
    this.master.connect(comp);
    comp.connect(ctx.destination);

    for (const name of ['sfx', 'music', 'ambience']) {
      const g = ctx.createGain();
      g.gain.value = this.volumes[name];
      g.connect(this.master);
      this.buses[name] = g;
    }

    this.unlocked = true;
    if (ctx.state === 'suspended') ctx.resume();
    return true;
  }

  /**
   * @param {string} bus
   * @param {number} value 0..1
   */
  setVolume(bus, value) {
    this.volumes[bus] = clamp(value, 0, 1);
    if (!this.unlocked) return;
    if (bus === 'master' && this.master) this.master.gain.value = this.volumes.master;
    else if (this.buses[bus]) this.buses[bus].gain.value = this.volumes[bus];
  }

  /** @returns {number} */
  now() {
    return this.ctx ? this.ctx.currentTime : 0;
  }

  /**
   * Play a named sound effect.
   * @param {string} id
   * @param {object} [options]
   * @param {number} [options.volume]
   * @param {number} [options.pitch] multiplier on the sound's base frequency
   * @param {number} [options.pan] -1..1
   */
  play(id, options = {}) {
    if (!this.enabled || !this.unlocked || !this.ctx) return;
    const def = SFX[id];
    if (!def) return;

    // Rate limit: a dozen identical impacts in one frame is noise, not impact.
    const t = this.now();
    const last = this._recent.get(id) ?? -1;
    if (t - last < this.minRepeatInterval) return;
    this._recent.set(id, t);

    def(this, {
      volume: options.volume ?? 1,
      pitch: options.pitch ?? 1,
      pan: options.pan ?? 0,
      time: t,
    });
  }

  /**
   * Build a single synth voice. The workhorse both the SFX table and the music
   * sequencer are written in terms of.
   *
   * @param {object} spec
   * @param {OscillatorType|'noise'} spec.type
   * @param {number} spec.freq Hz
   * @param {number} [spec.freqEnd] glide target
   * @param {number} [spec.duration] seconds
   * @param {number} [spec.attack]
   * @param {number} [spec.decay]
   * @param {number} [spec.sustain] 0..1
   * @param {number} [spec.release]
   * @param {number} [spec.volume]
   * @param {string} [spec.bus]
   * @param {number} [spec.pan]
   * @param {number} [spec.filter] low-pass cutoff, Hz
   * @param {number} [spec.filterEnd]
   * @param {number} [spec.q]
   * @param {number} [spec.time] when to start; defaults to now
   * @param {number} [spec.detune] cents
   */
  voice(spec) {
    if (!this.unlocked || !this.ctx) return;
    const ctx = this.ctx;
    const t0 = spec.time ?? this.now();
    const duration = spec.duration ?? 0.2;
    const attack = spec.attack ?? 0.005;
    const decay = spec.decay ?? 0.05;
    const sustain = spec.sustain ?? 0.5;
    const release = spec.release ?? 0.08;
    const volume = spec.volume ?? 0.4;

    /** @type {AudioNode} */
    let source;
    if (spec.type === 'noise') {
      source = this._makeNoise(duration + release);
    } else {
      const osc = ctx.createOscillator();
      osc.type = /** @type {OscillatorType} */ (spec.type);
      osc.frequency.setValueAtTime(Math.max(1, spec.freq), t0);
      if (spec.freqEnd !== undefined) {
        // Exponential ramps cannot reach or cross zero.
        osc.frequency.exponentialRampToValueAtTime(Math.max(1, spec.freqEnd), t0 + duration);
      }
      if (spec.detune) osc.detune.value = spec.detune;
      osc.start(t0);
      osc.stop(t0 + duration + release + 0.02);
      source = osc;
    }

    /** @type {AudioNode} */
    let node = source;

    if (spec.filter) {
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(spec.filter, t0);
      if (spec.filterEnd !== undefined) {
        filter.frequency.exponentialRampToValueAtTime(Math.max(20, spec.filterEnd), t0 + duration);
      }
      filter.Q.value = spec.q ?? 1;
      node.connect(filter);
      node = filter;
    }

    const gain = ctx.createGain();
    // ADSR. Values are set explicitly at each breakpoint rather than relying on
    // ramp defaults, which behave differently across browsers.
    gain.gain.setValueAtTime(0, t0);
    gain.gain.linearRampToValueAtTime(volume, t0 + attack);
    gain.gain.linearRampToValueAtTime(volume * sustain, t0 + attack + decay);
    gain.gain.setValueAtTime(volume * sustain, t0 + duration);
    gain.gain.linearRampToValueAtTime(0, t0 + duration + release);
    node.connect(gain);
    node = gain;

    if (spec.pan && ctx.createStereoPanner) {
      const panner = ctx.createStereoPanner();
      panner.pan.value = clamp(spec.pan, -1, 1);
      node.connect(panner);
      node = panner;
    }

    node.connect(this.buses[spec.bus ?? 'sfx'] ?? this.master);
  }

  /**
   * @param {number} duration
   * @returns {AudioBufferSourceNode}
   * @private
   */
  _makeNoise(duration) {
    const ctx = /** @type {AudioContext} */ (this.ctx);
    const length = Math.max(1, Math.ceil(ctx.sampleRate * duration));
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    // Deterministic white noise; a seeded generator keeps the sound consistent
    // between plays instead of occasionally landing on an unusual burst.
    let seed = 0x9e3779b9;
    for (let i = 0; i < length; i++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      data[i] = (seed / 2147483648) - 1;
    }
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.start(this.now());
    return src;
  }

  // ==========================================================================
  // Music
  // ==========================================================================

  /**
   * Start a track. Tracks are procedural: a chord progression, a bass pattern
   * and an arpeggio, sequenced live.
   * @param {string} id
   */
  playMusic(id) {
    if (this._musicId === id) return;
    this._musicId = id;
    this._music = MUSIC[id] ?? MUSIC.shallows;
    this._step = 0;
    this._nextNoteTime = this.now();
  }

  stopMusic() {
    this._music = null;
    this._musicId = '';
  }

  /**
   * Set how intense the music should feel, 0 (exploring) to 1 (boss fight).
   * @param {number} value
   */
  setIntensity(value) {
    this._targetIntensity = clamp(value, 0, 1);
  }

  /**
   * Advance the music sequencer. Called every frame; schedules ahead so timing
   * is sample-accurate rather than frame-accurate.
   * @param {number} dt
   */
  update(dt) {
    // Intensity eases so combat transitions are musical rather than abrupt.
    this.intensity += (this._targetIntensity - this.intensity) * Math.min(1, dt * 1.5);

    if (!this.unlocked || !this._music || !this.ctx) return;
    const track = this._music;
    const secondsPerStep = 60 / track.bpm / 2; // eighth notes

    while (this._nextNoteTime < this.now() + this._lookahead) {
      this._scheduleStep(track, this._step, this._nextNoteTime, secondsPerStep);
      this._nextNoteTime += secondsPerStep;
      this._step++;
    }
  }

  /**
   * @param {any} track
   * @param {number} step
   * @param {number} time
   * @param {number} stepDur
   * @private
   */
  _scheduleStep(track, step, time, stepDur) {
    const bar = Math.floor(step / 16) % track.progression.length;
    const beat = step % 16;
    const root = track.progression[bar];
    const scale = track.scale;

    // Bass: root of the current chord, on the downbeats.
    if (beat % 8 === 0) {
      this.voice({
        type: 'triangle',
        freq: midiToFreq(root - 24),
        duration: stepDur * 3,
        attack: 0.01,
        decay: 0.1,
        sustain: 0.55,
        release: 0.25,
        volume: 0.32,
        filter: 420,
        bus: 'music',
        time,
      });
    }

    // Pad: a sustained chord at the start of each bar.
    if (beat === 0) {
      for (const interval of [0, 3, 7]) {
        this.voice({
          type: 'sine',
          freq: midiToFreq(root + interval),
          duration: stepDur * 14,
          attack: 0.4,
          decay: 0.2,
          sustain: 0.7,
          release: 0.9,
          volume: 0.09 + this.intensity * 0.04,
          filter: 900 + this.intensity * 700,
          bus: 'music',
          time,
          detune: interval === 0 ? 0 : 4,
        });
      }
    }

    // Melody: sparse when exploring, denser and higher in combat. This is what
    // makes the score respond to play rather than merely loop under it.
    const melodyChance = 0.18 + this.intensity * 0.5;
    if (hash01(step * 31 + track.seed) < melodyChance) {
      const degree = scale[(step * 5 + bar * 3) % scale.length];
      const octave = this.intensity > 0.6 && hash01(step * 7) > 0.6 ? 12 : 0;
      this.voice({
        type: this.intensity > 0.5 ? 'square' : 'triangle',
        freq: midiToFreq(root + degree + 12 + octave),
        duration: stepDur * 0.8,
        attack: 0.008,
        decay: 0.06,
        sustain: 0.3,
        release: 0.16,
        volume: 0.1 + this.intensity * 0.07,
        filter: 2200,
        bus: 'music',
        time,
        pan: (hash01(step * 13) - 0.5) * 0.5,
      });
    }

    // Percussion appears only at higher intensity, which is a strong and cheap
    // signal that a fight has started.
    if (this.intensity > 0.35 && beat % 4 === 0) {
      this.voice({
        type: 'noise',
        freq: 200,
        duration: 0.04,
        attack: 0.001,
        decay: 0.02,
        sustain: 0.1,
        release: 0.04,
        volume: 0.06 * this.intensity,
        filter: 1400,
        bus: 'music',
        time,
      });
    }
  }

  /**
   * Play a looping ambience bed for a region.
   * @param {string} id
   */
  playAmbience(id) {
    if (!this.unlocked) return;
    const def = AMBIENCE[id];
    if (!def) return;
    def(this);
  }
}

/**
 * @param {number} midi
 * @returns {number} Hz
 */
function midiToFreq(midi) {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

/**
 * @param {number} n
 * @returns {number} deterministic value in [0,1)
 */
function hash01(n) {
  let h = (n | 0) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/**
 * The sound-effect table. Each entry synthesises its sound from scratch.
 * @type {Record<string, (a: AudioManager, o: {volume: number, pitch: number, pan: number, time: number}) => void>}
 */
const SFX = {
  jump: (a, o) => a.voice({
    type: 'triangle', freq: 300 * o.pitch, freqEnd: 520 * o.pitch,
    duration: 0.1, attack: 0.004, decay: 0.03, sustain: 0.3, release: 0.06,
    volume: 0.18 * o.volume, filter: 2200, pan: o.pan, time: o.time,
  }),
  land: (a, o) => a.voice({
    type: 'noise', freq: 200, duration: 0.06, attack: 0.001, decay: 0.03,
    sustain: 0.2, release: 0.05, volume: 0.14 * o.volume, filter: 900, time: o.time,
  }),
  landHard: (a, o) => {
    a.voice({
      type: 'noise', freq: 200, duration: 0.11, attack: 0.001, decay: 0.05,
      sustain: 0.3, release: 0.1, volume: 0.26 * o.volume, filter: 640, time: o.time,
    });
    a.voice({
      type: 'sine', freq: 90, freqEnd: 46, duration: 0.16, attack: 0.002,
      decay: 0.05, sustain: 0.3, release: 0.1, volume: 0.24 * o.volume, time: o.time,
    });
  },
  dash: (a, o) => a.voice({
    type: 'noise', freq: 400, duration: 0.16, attack: 0.004, decay: 0.06,
    sustain: 0.35, release: 0.1, volume: 0.2 * o.volume,
    filter: 3400, filterEnd: 500, q: 3, pan: o.pan, time: o.time,
  }),
  slashA: (a, o) => a.voice({
    type: 'noise', freq: 800, duration: 0.09, attack: 0.002, decay: 0.03,
    sustain: 0.2, release: 0.06, volume: 0.2 * o.volume,
    filter: 5200, filterEnd: 1200, q: 2, pan: o.pan, time: o.time,
  }),
  slashB: (a, o) => a.voice({
    type: 'noise', freq: 900, duration: 0.085, attack: 0.002, decay: 0.03,
    sustain: 0.2, release: 0.055, volume: 0.2 * o.volume,
    filter: 6200, filterEnd: 1500, q: 2.4, pan: o.pan, time: o.time,
  }),
  slashTerrain: (a, o) => {
    a.voice({
      type: 'noise', freq: 1200, duration: 0.06, attack: 0.001, decay: 0.02,
      sustain: 0.1, release: 0.05, volume: 0.22 * o.volume,
      filter: 7000, filterEnd: 2400, q: 4, time: o.time,
    });
    a.voice({
      type: 'square', freq: 1400 * o.pitch, freqEnd: 700, duration: 0.05,
      attack: 0.001, decay: 0.02, sustain: 0.1, release: 0.04,
      volume: 0.1 * o.volume, time: o.time,
    });
  },
  hit: (a, o) => {
    a.voice({
      type: 'noise', freq: 300, duration: 0.07, attack: 0.001, decay: 0.03,
      sustain: 0.2, release: 0.05, volume: 0.24 * o.volume, filter: 2200, time: o.time,
    });
    a.voice({
      type: 'square', freq: 180 * o.pitch, freqEnd: 90, duration: 0.08,
      attack: 0.001, decay: 0.03, sustain: 0.2, release: 0.06,
      volume: 0.16 * o.volume, time: o.time,
    });
  },
  playerHurt: (a, o) => {
    a.voice({
      type: 'sawtooth', freq: 260, freqEnd: 120, duration: 0.22,
      attack: 0.003, decay: 0.08, sustain: 0.35, release: 0.14,
      volume: 0.26 * o.volume, filter: 1600, time: o.time,
    });
    a.voice({
      type: 'noise', freq: 200, duration: 0.14, attack: 0.001, decay: 0.05,
      sustain: 0.2, release: 0.1, volume: 0.18 * o.volume, filter: 800, time: o.time,
    });
  },
  enemyDeath: (a, o) => {
    a.voice({
      type: 'sawtooth', freq: 340 * o.pitch, freqEnd: 70, duration: 0.26,
      attack: 0.002, decay: 0.08, sustain: 0.3, release: 0.16,
      volume: 0.2 * o.volume, filter: 2400, filterEnd: 300, time: o.time,
    });
    a.voice({
      type: 'noise', freq: 300, duration: 0.2, attack: 0.001, decay: 0.08,
      sustain: 0.2, release: 0.12, volume: 0.16 * o.volume, filter: 1400, time: o.time,
    });
  },
  death: (a, o) => {
    a.voice({
      type: 'sine', freq: 220, freqEnd: 55, duration: 1.4, attack: 0.02,
      decay: 0.4, sustain: 0.4, release: 0.9, volume: 0.3 * o.volume,
      filter: 1200, filterEnd: 200, time: o.time,
    });
  },
  heal: (a, o) => {
    for (let i = 0; i < 3; i++) {
      a.voice({
        type: 'sine', freq: 440 * Math.pow(2, i / 12) * 1.5, duration: 0.2,
        attack: 0.02, decay: 0.08, sustain: 0.5, release: 0.25,
        volume: 0.12 * o.volume, time: o.time + i * 0.05,
      });
    }
  },
  focusStart: (a, o) => a.voice({
    type: 'sine', freq: 180, freqEnd: 360, duration: 0.4, attack: 0.06,
    decay: 0.1, sustain: 0.6, release: 0.2, volume: 0.12 * o.volume, time: o.time,
  }),
  pogo: (a, o) => a.voice({
    type: 'square', freq: 420, freqEnd: 780, duration: 0.1, attack: 0.002,
    decay: 0.03, sustain: 0.25, release: 0.08, volume: 0.2 * o.volume,
    filter: 3000, time: o.time,
  }),
  wallJump: (a, o) => a.voice({
    type: 'triangle', freq: 260, freqEnd: 460, duration: 0.1, attack: 0.003,
    decay: 0.03, sustain: 0.3, release: 0.07, volume: 0.18 * o.volume, time: o.time,
  }),
  wallGrab: (a, o) => a.voice({
    type: 'noise', freq: 300, duration: 0.12, attack: 0.01, decay: 0.05,
    sustain: 0.2, release: 0.08, volume: 0.1 * o.volume, filter: 1200, time: o.time,
  }),
  enemyShoot: (a, o) => a.voice({
    type: 'square', freq: 620 * o.pitch, freqEnd: 300, duration: 0.09,
    attack: 0.002, decay: 0.03, sustain: 0.2, release: 0.06,
    volume: 0.13 * o.volume, filter: 2600, pan: o.pan, time: o.time,
  }),
  bossTelegraph: (a, o) => a.voice({
    type: 'sawtooth', freq: 110, freqEnd: 190, duration: 0.4, attack: 0.05,
    decay: 0.1, sustain: 0.6, release: 0.15, volume: 0.15 * o.volume,
    filter: 900, time: o.time,
  }),
  bossSlam: (a, o) => {
    a.voice({
      type: 'sine', freq: 120, freqEnd: 38, duration: 0.34, attack: 0.002,
      decay: 0.1, sustain: 0.4, release: 0.2, volume: 0.38 * o.volume, time: o.time,
    });
    a.voice({
      type: 'noise', freq: 200, duration: 0.24, attack: 0.001, decay: 0.09,
      sustain: 0.3, release: 0.16, volume: 0.28 * o.volume, filter: 700, time: o.time,
    });
  },
  bossPhase: (a, o) => {
    for (let i = 0; i < 4; i++) {
      a.voice({
        type: 'sawtooth', freq: 160 * Math.pow(2, i / 4), duration: 0.5,
        attack: 0.02, decay: 0.15, sustain: 0.5, release: 0.4,
        volume: 0.16 * o.volume, filter: 1800, time: o.time + i * 0.06,
      });
    }
  },
  roomTransition: (a, o) => a.voice({
    type: 'sine', freq: 520, freqEnd: 240, duration: 0.2, attack: 0.01,
    decay: 0.06, sustain: 0.3, release: 0.12, volume: 0.09 * o.volume, time: o.time,
  }),
  pickup: (a, o) => {
    for (let i = 0; i < 2; i++) {
      a.voice({
        type: 'sine', freq: 660 * (1 + i * 0.5), duration: 0.14,
        attack: 0.005, decay: 0.05, sustain: 0.4, release: 0.1,
        volume: 0.14 * o.volume, time: o.time + i * 0.06,
      });
    }
  },
  unlock: (a, o) => {
    const notes = [0, 4, 7, 12];
    notes.forEach((n, i) => a.voice({
      type: 'triangle', freq: midiToFreq(64 + n), duration: 0.45,
      attack: 0.01, decay: 0.1, sustain: 0.5, release: 0.4,
      volume: 0.16 * o.volume, filter: 3000, time: o.time + i * 0.09,
    }));
  },
  rest: (a, o) => {
    [0, 5, 9].forEach((n, i) => a.voice({
      type: 'sine', freq: midiToFreq(57 + n), duration: 0.9,
      attack: 0.06, decay: 0.2, sustain: 0.6, release: 0.6,
      volume: 0.12 * o.volume, time: o.time + i * 0.12,
    }));
  },
  menuMove: (a, o) => a.voice({
    type: 'square', freq: 620, duration: 0.03, attack: 0.001, decay: 0.01,
    sustain: 0.2, release: 0.03, volume: 0.07 * o.volume, filter: 2600, time: o.time,
  }),
  menuSelect: (a, o) => a.voice({
    type: 'square', freq: 500, freqEnd: 780, duration: 0.07, attack: 0.002,
    decay: 0.02, sustain: 0.3, release: 0.05, volume: 0.1 * o.volume,
    filter: 3000, time: o.time,
  }),
  arenaSeal: (a, o) => a.voice({
    type: 'sawtooth', freq: 200, freqEnd: 60, duration: 0.5, attack: 0.01,
    decay: 0.14, sustain: 0.5, release: 0.3, volume: 0.24 * o.volume,
    filter: 700, time: o.time,
  }),
  arenaOpen: (a, o) => a.voice({
    type: 'sawtooth', freq: 90, freqEnd: 300, duration: 0.5, attack: 0.02,
    decay: 0.12, sustain: 0.5, release: 0.3, volume: 0.2 * o.volume,
    filter: 1600, time: o.time,
  }),
  transcribe: (a, o) => {
    for (let i = 0; i < 5; i++) {
      a.voice({
        type: 'square', freq: 900 + i * 70, duration: 0.02, attack: 0.001,
        decay: 0.008, sustain: 0.1, release: 0.02,
        volume: 0.05 * o.volume, filter: 4000, time: o.time + i * 0.045,
      });
    }
  },
};

// Aliases so a missing sound never silently does nothing surprising.
SFX.hop = SFX.jump;
SFX.drop = SFX.land;
SFX.swimStroke = SFX.dash;
SFX.burrow = SFX.land;
SFX.charge = SFX.dash;
SFX.chargeWindup = SFX.bossTelegraph;
SFX.turretCharge = SFX.bossTelegraph;
SFX.bossWindup = SFX.bossTelegraph;
SFX.bossWindupHeavy = SFX.bossTelegraph;
SFX.bossCharge = SFX.bossTelegraph;
SFX.bossAim = SFX.bossTelegraph;
SFX.bossGuard = SFX.bossTelegraph;
SFX.bossBeamCharge = SFX.bossTelegraph;
SFX.bossRumble = SFX.bossTelegraph;
SFX.bossSkyfall = SFX.bossTelegraph;
SFX.bossSummon = SFX.bossPhase;
SFX.bossDash = SFX.dash;
SFX.bossDive = SFX.dash;
SFX.bossLeap = SFX.jump;
SFX.bossSweep = SFX.slashA;
SFX.bossShoot = SFX.enemyShoot;
SFX.bossBeam = SFX.bossSlam;
SFX.bossBlink = SFX.roomTransition;
SFX.bossRegroup = SFX.dash;
SFX.enemyHit = SFX.hit;

/**
 * Procedural music tracks. A track is a chord progression (MIDI note numbers)
 * plus a scale and a tempo; the sequencer improvises within it, so a track never
 * repeats exactly and never needs to loop.
 */
const MUSIC = {
  shallows: { bpm: 68, seed: 11, progression: [45, 50, 43, 48], scale: [0, 2, 3, 5, 7, 8, 10] },
  quillrest: { bpm: 76, seed: 21, progression: [48, 53, 55, 50], scale: [0, 2, 4, 5, 7, 9, 11] },
  archive: { bpm: 62, seed: 31, progression: [43, 48, 41, 46], scale: [0, 2, 3, 5, 7, 8, 10] },
  verdigris: { bpm: 84, seed: 41, progression: [45, 47, 50, 43], scale: [0, 2, 3, 5, 7, 9, 10] },
  cinderloom: { bpm: 104, seed: 51, progression: [40, 43, 45, 41], scale: [0, 1, 4, 5, 7, 8, 11] },
  glasswake: { bpm: 72, seed: 61, progression: [47, 52, 49, 54], scale: [0, 2, 4, 6, 7, 9, 11] },
  marrow: { bpm: 58, seed: 71, progression: [41, 44, 39, 46], scale: [0, 2, 3, 5, 7, 8, 10] },
  gallery: { bpm: 66, seed: 81, progression: [46, 51, 48, 53], scale: [0, 2, 4, 5, 7, 9, 11] },
  fen: { bpm: 54, seed: 91, progression: [38, 41, 36, 43], scale: [0, 1, 3, 5, 6, 8, 10] },
  clockspill: { bpm: 116, seed: 101, progression: [44, 46, 49, 51], scale: [0, 2, 3, 5, 7, 9, 10] },
  auric: { bpm: 60, seed: 111, progression: [42, 47, 45, 50], scale: [0, 2, 4, 7, 9] },
  spire: { bpm: 92, seed: 121, progression: [49, 54, 52, 56], scale: [0, 2, 4, 5, 7, 9, 11] },
  lastweir: { bpm: 88, seed: 131, progression: [38, 43, 41, 45], scale: [0, 1, 3, 5, 7, 8, 10] },
  margin: { bpm: 50, seed: 141, progression: [55, 55, 55, 55], scale: [0, 5, 7] },
  inkbelow: { bpm: 46, seed: 151, progression: [33, 34, 33, 32], scale: [0, 1, 3, 6, 8] },
  trial: { bpm: 124, seed: 161, progression: [45, 45, 48, 50], scale: [0, 1, 4, 5, 7, 8, 11] },
  boss: { bpm: 132, seed: 171, progression: [40, 41, 43, 38], scale: [0, 1, 4, 5, 7, 8, 11] },
};

/**
 * Ambience beds, played as one-shot swells that the game re-triggers.
 * @type {Record<string, (a: AudioManager) => void>}
 */
const AMBIENCE = {
  wind_thin: (a) => a.voice({
    type: 'noise', freq: 200, duration: 4, attack: 1.5, decay: 0.5,
    sustain: 0.6, release: 2, volume: 0.05, filter: 480, q: 0.7, bus: 'ambience',
  }),
  high_wind: (a) => a.voice({
    type: 'noise', freq: 200, duration: 4, attack: 1.2, decay: 0.5,
    sustain: 0.7, release: 2, volume: 0.08, filter: 900, q: 1.2, bus: 'ambience',
  }),
  drip: (a) => a.voice({
    type: 'sine', freq: 900, freqEnd: 420, duration: 0.1, attack: 0.002,
    decay: 0.04, sustain: 0.2, release: 0.1, volume: 0.06, bus: 'ambience',
  }),
  machinery_wet: (a) => a.voice({
    type: 'sawtooth', freq: 58, duration: 3, attack: 0.8, decay: 0.4,
    sustain: 0.6, release: 1.4, volume: 0.05, filter: 260, bus: 'ambience',
  }),
  forge_roar: (a) => a.voice({
    type: 'noise', freq: 200, duration: 3.5, attack: 1, decay: 0.4,
    sustain: 0.7, release: 1.6, volume: 0.07, filter: 320, bus: 'ambience',
  }),
  bog: (a) => a.voice({
    type: 'sine', freq: 46, duration: 4, attack: 1.4, decay: 0.6,
    sustain: 0.6, release: 2, volume: 0.06, filter: 180, bus: 'ambience',
  }),
  ticking: (a) => a.voice({
    type: 'square', freq: 1600, duration: 0.015, attack: 0.001, decay: 0.005,
    sustain: 0.1, release: 0.01, volume: 0.04, filter: 3000, bus: 'ambience',
  }),
  submerged: (a) => a.voice({
    type: 'noise', freq: 200, duration: 4, attack: 1.6, decay: 0.6,
    sustain: 0.6, release: 2, volume: 0.06, filter: 200, bus: 'ambience',
  }),
  rain: (a) => a.voice({
    type: 'noise', freq: 200, duration: 3, attack: 0.8, decay: 0.4,
    sustain: 0.7, release: 1.4, volume: 0.07, filter: 2200, bus: 'ambience',
  }),
  glass_chime: (a) => a.voice({
    type: 'sine', freq: 2100, duration: 0.6, attack: 0.01, decay: 0.2,
    sustain: 0.3, release: 0.4, volume: 0.04, bus: 'ambience',
  }),
  low_drone: (a) => a.voice({
    type: 'triangle', freq: 42, duration: 5, attack: 2, decay: 0.6,
    sustain: 0.7, release: 2.4, volume: 0.06, filter: 200, bus: 'ambience',
  }),
  town_murmur: (a) => a.voice({
    type: 'noise', freq: 200, duration: 4, attack: 1.6, decay: 0.6,
    sustain: 0.5, release: 2, volume: 0.03, filter: 400, bus: 'ambience',
  }),
  pressure: (a) => a.voice({
    type: 'sawtooth', freq: 36, duration: 4, attack: 1.2, decay: 0.6,
    sustain: 0.7, release: 2, volume: 0.07, filter: 160, bus: 'ambience',
  }),
  abyss: (a) => a.voice({
    type: 'sine', freq: 30, duration: 6, attack: 2.5, decay: 0.8,
    sustain: 0.7, release: 3, volume: 0.07, filter: 120, bus: 'ambience',
  }),
  silence: () => {},
  arena: (a) => a.voice({
    type: 'noise', freq: 200, duration: 3, attack: 1.2, decay: 0.5,
    sustain: 0.4, release: 1.4, volume: 0.03, filter: 500, bus: 'ambience',
  }),
};

export { SFX, MUSIC, AMBIENCE };
