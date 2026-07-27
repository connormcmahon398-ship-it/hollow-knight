/**
 * @file Particle system.
 *
 * ## Structure-of-arrays, not array-of-objects
 * Particles are stored in parallel typed arrays rather than as objects. At the
 * peak counts this game reaches — a boss death sprays ~600 at once, and ambient
 * emitters run continuously in every room — an object-per-particle design
 * allocates and collects thousands of short-lived objects per second, producing
 * exactly the GC hitches the fixed-timestep loop is designed to avoid.
 *
 * Typed arrays also make the update loop a flat numeric pass with no property
 * lookups, which is roughly an order of magnitude faster in practice.
 *
 * The cost is ergonomics: emitting takes a parameter object, but internally
 * everything is indices. That trade is worth it precisely here and nowhere else
 * in the codebase.
 *
 * ## Free-list allocation
 * Dead particles are recycled through a free list. `count` is a high-water mark
 * of *used slots*, and iteration skips dead ones by checking `life`. This avoids
 * the compaction pass a swap-remove scheme would need, which would reorder
 * particles and break draw ordering for trails.
 */

import { clamp } from '../math/math-utils.js';
import { cosmeticRng } from '../core/rng.js';

/**
 * Rendering styles a particle can use.
 * @type {Readonly<Record<string, number>>}
 */
export const ParticleShape = Object.freeze({
  DOT: 0,
  SQUARE: 1,
  LINE: 2,      // stretched along the velocity vector
  SPARK: 3,     // bright core with additive blending
  RING: 4,
  GLYPH: 5,     // a small ink-mark, the game's signature effect
  SMOKE: 6,     // large soft circle, low alpha
});

/**
 * @typedef {Object} EmitOptions
 * @property {number} x
 * @property {number} y
 * @property {number} [count]
 * @property {number} [vx] base velocity
 * @property {number} [vy]
 * @property {number} [spread] random velocity added on each axis
 * @property {number} [speed] additional random speed in a random direction
 * @property {number} [angle] direction in radians for `speed`
 * @property {number} [angleSpread] randomisation of `angle`
 * @property {number} [life] seconds
 * @property {number} [lifeSpread]
 * @property {number} [size]
 * @property {number} [sizeSpread]
 * @property {number} [gravity]
 * @property {number} [drag] per-second velocity retention exponent
 * @property {string} [color]
 * @property {string} [colorEnd] particles fade toward this colour
 * @property {number} [shape] one of ParticleShape
 * @property {number} [spin] radians per second
 * @property {number} [fadeIn] fraction of life spent fading in
 * @property {boolean} [additive]
 * @property {number} [areaW] emit within a rectangle
 * @property {number} [areaH]
 */

export class ParticleSystem {
  /**
   * @param {number} [capacity] Hard cap on simultaneous particles.
   */
  constructor(capacity = 3000) {
    this.capacity = capacity;
    this.x = new Float32Array(capacity);
    this.y = new Float32Array(capacity);
    this.vx = new Float32Array(capacity);
    this.vy = new Float32Array(capacity);
    this.life = new Float32Array(capacity);       // remaining, seconds
    this.maxLife = new Float32Array(capacity);
    this.size = new Float32Array(capacity);
    this.gravity = new Float32Array(capacity);
    this.drag = new Float32Array(capacity);
    this.rotation = new Float32Array(capacity);
    this.spin = new Float32Array(capacity);
    this.shape = new Uint8Array(capacity);
    this.additive = new Uint8Array(capacity);
    this.fadeIn = new Float32Array(capacity);
    /** Colours are strings, so they live in a plain array. @type {string[]} */
    this.color = new Array(capacity).fill('#ffffff');
    /** @type {string[]} */
    this.colorEnd = new Array(capacity).fill('');

    /** Highest slot index ever used; iteration stops here. */
    this.count = 0;
    /** @type {number[]} */
    this._free = [];
    this.alive = 0;

    /**
     * When the system is full, new emissions are dropped rather than replacing
     * live particles: recycling the oldest produces visible popping, and
     * dropping is invisible because the screen is already saturated.
     */
    this.droppedEmissions = 0;
  }

  /**
   * Allocate a slot.
   * @returns {number} index, or -1 when full
   * @private
   */
  _alloc() {
    if (this._free.length > 0) return /** @type {number} */ (this._free.pop());
    if (this.count < this.capacity) return this.count++;
    return -1;
  }

  /**
   * Emit a burst.
   * @param {EmitOptions} opts
   * @returns {number} how many particles were actually created
   */
  emit(opts) {
    const n = opts.count ?? 1;
    const rng = cosmeticRng;
    let created = 0;

    for (let i = 0; i < n; i++) {
      const idx = this._alloc();
      if (idx < 0) {
        this.droppedEmissions++;
        break;
      }

      const areaW = opts.areaW ?? 0;
      const areaH = opts.areaH ?? 0;
      this.x[idx] = opts.x + (areaW ? rng.range(-areaW / 2, areaW / 2) : 0);
      this.y[idx] = opts.y + (areaH ? rng.range(-areaH / 2, areaH / 2) : 0);

      let vx = opts.vx ?? 0;
      let vy = opts.vy ?? 0;
      const spread = opts.spread ?? 0;
      if (spread) {
        vx += rng.range(-spread, spread);
        vy += rng.range(-spread, spread);
      }
      if (opts.speed) {
        const baseAngle = opts.angle ?? 0;
        const aSpread = opts.angleSpread ?? Math.PI * 2;
        const a = baseAngle + rng.range(-aSpread / 2, aSpread / 2);
        const s = opts.speed * rng.range(0.55, 1);
        vx += Math.cos(a) * s;
        vy += Math.sin(a) * s;
      }
      this.vx[idx] = vx;
      this.vy[idx] = vy;

      const life = (opts.life ?? 0.5) + (opts.lifeSpread ? rng.range(0, opts.lifeSpread) : 0);
      this.life[idx] = life;
      this.maxLife[idx] = life;

      this.size[idx] = (opts.size ?? 2) + (opts.sizeSpread ? rng.range(-opts.sizeSpread, opts.sizeSpread) : 0);
      if (this.size[idx] < 0.2) this.size[idx] = 0.2;

      this.gravity[idx] = opts.gravity ?? 0;
      this.drag[idx] = opts.drag ?? 0;
      this.rotation[idx] = rng.range(0, Math.PI * 2);
      this.spin[idx] = opts.spin ?? 0;
      this.shape[idx] = opts.shape ?? ParticleShape.DOT;
      this.additive[idx] = opts.additive ? 1 : 0;
      this.fadeIn[idx] = opts.fadeIn ?? 0;
      this.color[idx] = opts.color ?? '#ffffff';
      this.colorEnd[idx] = opts.colorEnd ?? '';

      this.alive++;
      created++;
    }
    return created;
  }

  /**
   * @param {number} dt
   * @param {import('../physics/tilemap.js').Tilemap} [map] optional, for collision
   */
  update(dt, map) {
    for (let i = 0; i < this.count; i++) {
      const life = this.life[i];
      if (life <= 0) continue;

      const newLife = life - dt;
      if (newLife <= 0) {
        this.life[i] = 0;
        this._free.push(i);
        this.alive--;
        continue;
      }
      this.life[i] = newLife;

      if (this.gravity[i] !== 0) this.vy[i] += this.gravity[i] * dt;
      if (this.drag[i] !== 0) {
        const d = Math.exp(-this.drag[i] * dt);
        this.vx[i] *= d;
        this.vy[i] *= d;
      }

      this.x[i] += this.vx[i] * dt;
      this.y[i] += this.vy[i] * dt;
      if (this.spin[i] !== 0) this.rotation[i] += this.spin[i] * dt;
    }
  }

  /**
   * Draw every live particle.
   *
   * Particles are grouped by blend mode in two passes rather than toggling
   * `globalCompositeOperation` per particle — that toggle is one of the more
   * expensive Canvas2D state changes, and doing it 600 times a frame is
   * measurably worse than iterating the array twice.
   *
   * @param {import('../render/renderer.js').Renderer} renderer
   */
  render(renderer) {
    if (this.alive === 0) return;
    const g = renderer.g;
    this._renderPass(g, false);
    const prevOp = g.globalCompositeOperation;
    g.globalCompositeOperation = 'lighter';
    this._renderPass(g, true);
    g.globalCompositeOperation = prevOp;
    g.globalAlpha = 1;
  }

  /**
   * @param {CanvasRenderingContext2D} g
   * @param {boolean} additivePass
   * @private
   */
  _renderPass(g, additivePass) {
    const wantAdditive = additivePass ? 1 : 0;
    for (let i = 0; i < this.count; i++) {
      const life = this.life[i];
      if (life <= 0) continue;
      if (this.additive[i] !== wantAdditive) continue;

      const t = 1 - life / this.maxLife[i]; // 0 at birth, 1 at death
      let alpha = 1 - t;
      const fi = this.fadeIn[i];
      if (fi > 0 && t < fi) alpha = t / fi;

      g.globalAlpha = clamp(alpha, 0, 1);
      g.fillStyle = this.colorEnd[i] ? blendCached(this.color[i], this.colorEnd[i], t) : this.color[i];

      const x = this.x[i];
      const y = this.y[i];
      const s = this.size[i];

      switch (this.shape[i]) {
        case ParticleShape.SQUARE:
          g.fillRect(x - s / 2, y - s / 2, s, s);
          break;

        case ParticleShape.LINE: {
          // Stretch along velocity, which reads as speed far better than a dot.
          const vx = this.vx[i];
          const vy = this.vy[i];
          const len = Math.hypot(vx, vy);
          if (len < 0.01) break;
          const nx = vx / len;
          const ny = vy / len;
          const stretch = Math.min(len * 0.035, 14) + s;
          g.strokeStyle = g.fillStyle;
          g.lineWidth = Math.max(0.6, s * 0.5);
          g.beginPath();
          g.moveTo(x, y);
          g.lineTo(x - nx * stretch, y - ny * stretch);
          g.stroke();
          break;
        }

        case ParticleShape.RING:
          g.strokeStyle = g.fillStyle;
          g.lineWidth = Math.max(0.5, s * 0.22);
          g.beginPath();
          g.arc(x, y, s * (0.4 + t * 1.6), 0, Math.PI * 2);
          g.stroke();
          break;

        case ParticleShape.GLYPH: {
          // A short angular ink stroke: the visual motif of the whole game.
          const r = this.rotation[i];
          const c = Math.cos(r);
          const sn = Math.sin(r);
          g.strokeStyle = g.fillStyle;
          g.lineWidth = Math.max(0.6, s * 0.4);
          g.beginPath();
          g.moveTo(x - c * s, y - sn * s);
          g.lineTo(x + c * s * 0.3, y + sn * s * 0.3);
          g.lineTo(x + sn * s * 0.7, y - c * s * 0.7);
          g.stroke();
          break;
        }

        case ParticleShape.SMOKE:
          g.globalAlpha = clamp(alpha * 0.42, 0, 1);
          g.beginPath();
          g.arc(x, y, s * (1 + t * 1.4), 0, Math.PI * 2);
          g.fill();
          break;

        case ParticleShape.SPARK:
          g.beginPath();
          g.arc(x, y, Math.max(0.3, s * (1 - t * 0.6)), 0, Math.PI * 2);
          g.fill();
          break;

        case ParticleShape.DOT:
        default:
          g.beginPath();
          g.arc(x, y, Math.max(0.3, s), 0, Math.PI * 2);
          g.fill();
          break;
      }
    }
  }

  /** Remove every particle immediately (room change). */
  clear() {
    for (let i = 0; i < this.count; i++) this.life[i] = 0;
    this.count = 0;
    this._free.length = 0;
    this.alive = 0;
  }

  /** @returns {{alive: number, capacity: number, dropped: number}} */
  stats() {
    return { alive: this.alive, capacity: this.capacity, dropped: this.droppedEmissions };
  }
}

// A tiny memoised colour blend. Particles overwhelmingly reuse the same handful
// of colour pairs, so caching turns thousands of OKLab conversions per frame
// into a handful.
/** @type {Map<string, string>} */
const blendCache = new Map();

/**
 * @param {string} a @param {string} b @param {number} t
 * @returns {string}
 */
function blendCached(a, b, t) {
  // Quantise t so the cache actually hits.
  const q = Math.round(t * 12);
  const key = `${a}|${b}|${q}`;
  let v = blendCache.get(key);
  if (v === undefined) {
    // Imported lazily to keep this module usable without the render layer.
    v = mixRgbFast(a, b, q / 12);
    if (blendCache.size > 2048) blendCache.clear();
    blendCache.set(key, v);
  }
  return v;
}

/**
 * A fast sRGB blend for particles.
 *
 * The palette module's perceptual `mix` is the right tool for authored colours,
 * but particles blend between two colours that are usually close in hue and are
 * on screen for a fraction of a second; the perceptual difference is invisible
 * and the cost is not.
 * @param {string} a @param {string} b @param {number} t
 * @returns {string}
 */
function mixRgbFast(a, b, t) {
  const ca = quickParse(a);
  const cb = quickParse(b);
  const r = Math.round(ca[0] + (cb[0] - ca[0]) * t);
  const g = Math.round(ca[1] + (cb[1] - ca[1]) * t);
  const bl = Math.round(ca[2] + (cb[2] - ca[2]) * t);
  const al = ca[3] + (cb[3] - ca[3]) * t;
  return al >= 1 ? `rgb(${r},${g},${bl})` : `rgba(${r},${g},${bl},${al.toFixed(2)})`;
}

/**
 * @param {string} css
 * @returns {[number, number, number, number]}
 */
function quickParse(css) {
  if (css[0] === '#') {
    if (css.length === 7) {
      return [
        parseInt(css.slice(1, 3), 16),
        parseInt(css.slice(3, 5), 16),
        parseInt(css.slice(5, 7), 16),
        1,
      ];
    }
    if (css.length === 4) {
      return [
        parseInt(css[1] + css[1], 16),
        parseInt(css[2] + css[2], 16),
        parseInt(css[3] + css[3], 16),
        1,
      ];
    }
  }
  const m = css.match(/rgba?\(([^)]+)\)/);
  if (m) {
    const p = m[1].split(',').map(parseFloat);
    return [p[0] || 0, p[1] || 0, p[2] || 0, p.length > 3 ? p[3] : 1];
  }
  return [255, 255, 255, 1];
}
