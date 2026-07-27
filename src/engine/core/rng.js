/**
 * @file Deterministic pseudo-random number generation.
 *
 * ## Why a custom RNG?
 * `Math.random()` cannot be seeded, which makes it useless for:
 *  - reproducible world generation (the same seed must always build the same world),
 *  - deterministic tests of AI and procedural systems,
 *  - replay/debug tooling.
 *
 * We use **Mulberry32**: a 32-bit generator with a 2^32 period. It is not
 * cryptographically secure (and must never be used for anything security related),
 * but it is fast, has good statistical distribution for games, and is trivially
 * portable so the exact same sequence is produced in Node and in the browser.
 *
 * Every subsystem that needs randomness receives an `Rng` instance rather than
 * reaching for a global, so that (for example) particle jitter can never perturb
 * the world-generation sequence.
 */

/** Maximum value of a uint32, used to normalise into [0,1). */
const UINT32 = 4294967296;

export class Rng {
  /**
   * @param {number|string} [seed] Numeric seed, or a string that will be hashed.
   */
  constructor(seed = 0x9e3779b9) {
    this._state = (typeof seed === 'string' ? Rng.hashString(seed) : seed >>> 0) >>> 0;
    // A zero state is a fixed point for some generators; nudge it off zero.
    if (this._state === 0) this._state = 0x6d2b79f5;
    this._initial = this._state;
  }

  /**
   * FNV-1a style string hash, so human-readable seeds ("aetherweir") work.
   * @param {string} str
   * @returns {number} uint32
   */
  static hashString(str) {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619) >>> 0;
    }
    return h >>> 0;
  }

  /** Restore the generator to its construction state. */
  reset() {
    this._state = this._initial;
  }

  /**
   * Capture the internal state so it can be saved and restored exactly.
   * @returns {number}
   */
  getState() {
    return this._state >>> 0;
  }

  /** @param {number} state */
  setState(state) {
    this._state = state >>> 0;
  }

  /**
   * Core generator step (Mulberry32).
   * @returns {number} uint32
   */
  nextUint32() {
    this._state = (this._state + 0x6d2b79f5) >>> 0;
    let t = this._state;
    t = Math.imul(t ^ (t >>> 15), t | 1) >>> 0;
    t = (t ^ (t + Math.imul(t ^ (t >>> 7), t | 61))) >>> 0;
    return (t ^ (t >>> 14)) >>> 0;
  }

  /** @returns {number} float in [0, 1) */
  next() {
    return this.nextUint32() / UINT32;
  }

  /**
   * @param {number} min inclusive
   * @param {number} max exclusive
   * @returns {number} float in [min, max)
   */
  range(min, max) {
    return min + this.next() * (max - min);
  }

  /**
   * @param {number} min inclusive
   * @param {number} max inclusive
   * @returns {number} integer in [min, max]
   */
  int(min, max) {
    if (max < min) return min;
    return min + (this.nextUint32() % (max - min + 1));
  }

  /**
   * @param {number} [chance] probability of `true`, default 0.5
   * @returns {boolean}
   */
  bool(chance = 0.5) {
    return this.next() < chance;
  }

  /** @returns {number} -1 or 1 */
  sign() {
    return this.next() < 0.5 ? -1 : 1;
  }

  /**
   * Uniformly pick one element.
   * @template T
   * @param {readonly T[]} arr
   * @returns {T}
   */
  pick(arr) {
    if (arr.length === 0) throw new Error('Rng.pick: empty array');
    return arr[this.nextUint32() % arr.length];
  }

  /**
   * Pick one element using per-element weights. Weights need not sum to 1.
   * @template T
   * @param {readonly T[]} arr
   * @param {readonly number[]} weights
   * @returns {T}
   */
  pickWeighted(arr, weights) {
    if (arr.length === 0) throw new Error('Rng.pickWeighted: empty array');
    let total = 0;
    for (let i = 0; i < arr.length; i++) total += Math.max(0, weights[i] ?? 0);
    if (total <= 0) return this.pick(arr);
    let roll = this.next() * total;
    for (let i = 0; i < arr.length; i++) {
      roll -= Math.max(0, weights[i] ?? 0);
      if (roll <= 0) return arr[i];
    }
    return arr[arr.length - 1];
  }

  /**
   * In-place Fisher-Yates shuffle.
   * @template T
   * @param {T[]} arr
   * @returns {T[]} the same array, shuffled
   */
  shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = this.nextUint32() % (i + 1);
      const tmp = arr[i];
      arr[i] = arr[j];
      arr[j] = tmp;
    }
    return arr;
  }

  /**
   * Approximately normally distributed value via the Box-Muller transform.
   * @param {number} [mean]
   * @param {number} [stdDev]
   * @returns {number}
   */
  gaussian(mean = 0, stdDev = 1) {
    // Guard against log(0).
    let u = 0;
    while (u === 0) u = this.next();
    const v = this.next();
    return mean + stdDev * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  /**
   * Derive an independent child generator. Used so that, say, the decoration
   * pass of a room cannot shift the layout pass's sequence.
   * @param {string|number} salt
   * @returns {Rng}
   */
  fork(salt) {
    const s = typeof salt === 'string' ? Rng.hashString(salt) : salt >>> 0;
    return new Rng((this.nextUint32() ^ s) >>> 0);
  }
}

/**
 * A shared generator for purely cosmetic effects (particle jitter, idle sway).
 * Never use this for anything that must be reproducible.
 */
export const cosmeticRng = new Rng(Date.now() & 0xffffffff);

/**
 * Deterministic value noise in 1D, useful for organic wobble on background
 * elements without needing a full Perlin implementation.
 * @param {number} x
 * @param {number} [seed]
 * @returns {number} in [-1, 1]
 */
export function valueNoise1D(x, seed = 0) {
  const i = Math.floor(x);
  const f = x - i;
  const smooth = f * f * (3 - 2 * f); // smoothstep
  const a = hashToUnit(i, seed);
  const b = hashToUnit(i + 1, seed);
  return (a + (b - a) * smooth) * 2 - 1;
}

/**
 * Deterministic 2D value noise. Used by biome decorators.
 * @param {number} x
 * @param {number} y
 * @param {number} [seed]
 * @returns {number} in [-1, 1]
 */
export function valueNoise2D(x, y, seed = 0) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const sx = xf * xf * (3 - 2 * xf);
  const sy = yf * yf * (3 - 2 * yf);
  const n00 = hashToUnit(xi + yi * 57, seed);
  const n10 = hashToUnit(xi + 1 + yi * 57, seed);
  const n01 = hashToUnit(xi + (yi + 1) * 57, seed);
  const n11 = hashToUnit(xi + 1 + (yi + 1) * 57, seed);
  const ix0 = n00 + (n10 - n00) * sx;
  const ix1 = n01 + (n11 - n01) * sx;
  return (ix0 + (ix1 - ix0) * sy) * 2 - 1;
}

/**
 * Multi-octave fractal noise.
 * @param {number} x
 * @param {number} y
 * @param {number} [octaves]
 * @param {number} [seed]
 * @returns {number} roughly in [-1, 1]
 */
export function fbm2D(x, y, octaves = 4, seed = 0) {
  let sum = 0;
  let amp = 1;
  let freq = 1;
  let norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += valueNoise2D(x * freq, y * freq, seed + o * 131) * amp;
    norm += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return norm > 0 ? sum / norm : 0;
}

/**
 * Integer hash normalised to [0,1). Deterministic across platforms.
 * @param {number} n
 * @param {number} seed
 * @returns {number}
 */
function hashToUnit(n, seed) {
  let h = (n ^ seed) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b) >>> 0;
  h = (h ^ (h >>> 16)) >>> 0;
  return h / UINT32;
}
