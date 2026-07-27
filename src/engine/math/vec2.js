/**
 * @file 2D vector.
 *
 * ## Mutable class, not immutable value type
 * A functional `Vec2` that returns a new object per operation is cleaner to
 * reason about but allocates heavily: a single frame of physics for 200 entities
 * would produce thousands of short-lived objects. Every method here therefore
 * has an in-place form (`addInPlace`) alongside the allocating one, and hot
 * loops use the former. Static "write into out" variants exist for the same
 * reason.
 *
 * The trade-off is aliasing bugs (`a.addInPlace(a)`), so every in-place method
 * is written to be safe when source and destination are the same object.
 */

export class Vec2 {
  /**
   * @param {number} [x]
   * @param {number} [y]
   */
  constructor(x = 0, y = 0) {
    this.x = x;
    this.y = y;
  }

  /** @param {number} x @param {number} y @returns {this} */
  set(x, y) {
    this.x = x;
    this.y = y;
    return this;
  }

  /** @param {Vec2} v @returns {this} */
  copy(v) {
    this.x = v.x;
    this.y = v.y;
    return this;
  }

  /** @returns {Vec2} */
  clone() {
    return new Vec2(this.x, this.y);
  }

  /** @returns {this} */
  zero() {
    this.x = 0;
    this.y = 0;
    return this;
  }

  /** @param {Vec2} v @returns {this} */
  addInPlace(v) {
    this.x += v.x;
    this.y += v.y;
    return this;
  }

  /** @param {number} x @param {number} y @returns {this} */
  addXY(x, y) {
    this.x += x;
    this.y += y;
    return this;
  }

  /** @param {Vec2} v @returns {this} */
  subInPlace(v) {
    this.x -= v.x;
    this.y -= v.y;
    return this;
  }

  /** @param {number} s @returns {this} */
  scaleInPlace(s) {
    this.x *= s;
    this.y *= s;
    return this;
  }

  /**
   * Add `v * s`. The single most common physics operation
   * (`position += velocity * dt`), so it gets its own allocation-free method.
   * @param {Vec2} v @param {number} s @returns {this}
   */
  addScaled(v, s) {
    this.x += v.x * s;
    this.y += v.y * s;
    return this;
  }

  /** @param {Vec2} v @returns {Vec2} new vector */
  add(v) {
    return new Vec2(this.x + v.x, this.y + v.y);
  }

  /** @param {Vec2} v @returns {Vec2} new vector */
  sub(v) {
    return new Vec2(this.x - v.x, this.y - v.y);
  }

  /** @param {number} s @returns {Vec2} new vector */
  scale(s) {
    return new Vec2(this.x * s, this.y * s);
  }

  /** @returns {number} */
  length() {
    return Math.sqrt(this.x * this.x + this.y * this.y);
  }

  /**
   * Squared length. Prefer this for comparisons — it avoids a `sqrt`, which
   * matters when it runs per-entity-pair for AI aggro checks.
   * @returns {number}
   */
  lengthSq() {
    return this.x * this.x + this.y * this.y;
  }

  /** @returns {this} */
  normalizeInPlace() {
    const len = this.length();
    if (len > 1e-9) {
      this.x /= len;
      this.y /= len;
    }
    return this;
  }

  /** @returns {Vec2} */
  normalized() {
    return this.clone().normalizeInPlace();
  }

  /**
   * Clamp magnitude without changing direction.
   * @param {number} max @returns {this}
   */
  limitInPlace(max) {
    const lenSq = this.lengthSq();
    if (lenSq > max * max && lenSq > 1e-9) {
      const s = max / Math.sqrt(lenSq);
      this.x *= s;
      this.y *= s;
    }
    return this;
  }

  /** @param {Vec2} v @returns {number} */
  dot(v) {
    return this.x * v.x + this.y * v.y;
  }

  /**
   * 2D cross product (the z-component of the 3D cross). Its sign tells you which
   * side of `this` the vector `v` lies on — used for facing and steering checks.
   * @param {Vec2} v @returns {number}
   */
  cross(v) {
    return this.x * v.y - this.y * v.x;
  }

  /** @param {Vec2} v @returns {number} */
  distanceTo(v) {
    const dx = this.x - v.x;
    const dy = this.y - v.y;
    return Math.sqrt(dx * dx + dy * dy);
  }

  /** @param {Vec2} v @returns {number} */
  distanceSqTo(v) {
    const dx = this.x - v.x;
    const dy = this.y - v.y;
    return dx * dx + dy * dy;
  }

  /** @returns {number} radians, from +X axis, y-down screen space */
  angle() {
    return Math.atan2(this.y, this.x);
  }

  /**
   * @param {number} radians
   * @returns {this}
   */
  rotateInPlace(radians) {
    const c = Math.cos(radians);
    const s = Math.sin(radians);
    const x = this.x * c - this.y * s;
    this.y = this.x * s + this.y * c;
    this.x = x;
    return this;
  }

  /**
   * Rotate 90 degrees counter-clockwise. Cheaper than the general case and
   * needed for surface normals.
   * @returns {this}
   */
  perpInPlace() {
    const x = this.x;
    this.x = -this.y;
    this.y = x;
    return this;
  }

  /**
   * @param {Vec2} v @param {number} t @returns {this}
   */
  lerpInPlace(v, t) {
    this.x += (v.x - this.x) * t;
    this.y += (v.y - this.y) * t;
    return this;
  }

  /**
   * Reflect across a (unit) surface normal.
   * @param {Vec2} normal must be normalised
   * @returns {this}
   */
  reflectInPlace(normal) {
    const d = 2 * this.dot(normal);
    this.x -= d * normal.x;
    this.y -= d * normal.y;
    return this;
  }

  /** @returns {boolean} */
  isZero() {
    return this.x === 0 && this.y === 0;
  }

  /** @param {Vec2} v @param {number} [eps] @returns {boolean} */
  equals(v, eps = 1e-6) {
    return Math.abs(this.x - v.x) <= eps && Math.abs(this.y - v.y) <= eps;
  }

  /** @returns {{x: number, y: number}} plain object for serialisation */
  toJSON() {
    return { x: this.x, y: this.y };
  }

  /** @returns {string} */
  toString() {
    return `(${this.x.toFixed(2)}, ${this.y.toFixed(2)})`;
  }

  // ---- Static constructors and out-param helpers ----

  /** @param {number} radians @param {number} [len] @returns {Vec2} */
  static fromAngle(radians, len = 1) {
    return new Vec2(Math.cos(radians) * len, Math.sin(radians) * len);
  }

  /** @param {{x: number, y: number}} o @returns {Vec2} */
  static from(o) {
    return new Vec2(o.x, o.y);
  }

  /** @returns {Vec2} */
  static zero() {
    return new Vec2(0, 0);
  }

  /**
   * @param {Vec2} a @param {Vec2} b @param {number} t @param {Vec2} out
   * @returns {Vec2} out
   */
  static lerp(a, b, t, out) {
    out.x = a.x + (b.x - a.x) * t;
    out.y = a.y + (b.y - a.y) * t;
    return out;
  }

  /** @param {Vec2} a @param {Vec2} b @returns {number} */
  static distance(a, b) {
    return a.distanceTo(b);
  }
}

/**
 * Shared scratch vectors for hot paths that need a temporary without
 * allocating. **Never** hold a reference to these across a function boundary.
 */
export const TMP_A = new Vec2();
export const TMP_B = new Vec2();
export const TMP_C = new Vec2();
