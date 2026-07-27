/**
 * @file Object pooling.
 *
 * ## Why pool at all in JavaScript?
 * Modern JS engines have fast generational collectors, so pooling *everything*
 * is premature optimisation. But this game allocates from two hot paths at very
 * high rates: **particles** (thousands per second during combat) and
 * **projectiles/hitboxes**. Sustained allocation there produces visible GC
 * hitches — a 12ms pause during a boss parry window is a real gameplay defect,
 * not a benchmark curiosity.
 *
 * So the rule in this codebase is: pool the things that churn per-frame,
 * allocate normally for everything else.
 *
 * The pool never shrinks below its high-water mark. That is deliberate: the
 * steady state of a game is "occasionally busy", and returning memory only to
 * re-acquire it next fight defeats the purpose.
 */

/**
 * @template T
 */
export class Pool {
  /**
   * @param {() => T} factory Creates a fresh instance.
   * @param {(obj: T) => void} [reset] Returns an instance to a clean state.
   * @param {number} [prewarm] Instances to allocate up front.
   * @param {number} [maxSize] Hard cap; beyond this, `release` discards.
   */
  constructor(factory, reset, prewarm = 0, maxSize = 100000) {
    this._factory = factory;
    this._reset = reset;
    this._maxSize = maxSize;
    /** @type {T[]} */
    this._free = [];
    this._created = 0;
    this._liveCount = 0;
    this.peakLive = 0;
    for (let i = 0; i < prewarm; i++) {
      this._free.push(this._factory());
      this._created++;
    }
  }

  /** @returns {T} */
  acquire() {
    let obj;
    if (this._free.length > 0) {
      obj = /** @type {T} */ (this._free.pop());
    } else {
      obj = this._factory();
      this._created++;
    }
    this._liveCount++;
    if (this._liveCount > this.peakLive) this.peakLive = this._liveCount;
    return obj;
  }

  /**
   * @param {T} obj
   */
  release(obj) {
    if (obj == null) return;
    this._liveCount--;
    if (this._free.length >= this._maxSize) return; // let GC have it
    this._reset?.(obj);
    this._free.push(obj);
  }

  /** Drop all pooled instances (e.g. on scene teardown). */
  drain() {
    this._free.length = 0;
    this._liveCount = 0;
  }

  /** @returns {{created: number, free: number, live: number, peak: number}} */
  stats() {
    return {
      created: this._created,
      free: this._free.length,
      live: this._liveCount,
      peak: this.peakLive,
    };
  }
}

/**
 * A fixed-capacity array where removal is O(1) via swap-with-last.
 *
 * Used for particle systems and active-entity lists, where iteration order does
 * not matter but per-frame removal cost does. `Array.prototype.splice` on a
 * 4000-element particle array is quietly quadratic; this is not.
 *
 * @template T
 */
export class SwapList {
  /** @param {number} [capacity] */
  constructor(capacity = 0) {
    /** @type {T[]} */
    this.items = new Array(capacity);
    this.length = 0;
  }

  /** @param {T} item */
  push(item) {
    this.items[this.length++] = item;
  }

  /**
   * Remove by index in O(1). Because this reorders the list, callers iterating
   * while removing must **not** advance the index after a removal.
   * @param {number} index
   * @returns {T|undefined} the removed item
   */
  removeAt(index) {
    if (index < 0 || index >= this.length) return undefined;
    const removed = this.items[index];
    this.length--;
    this.items[index] = this.items[this.length];
    this.items[this.length] = undefined;
    return removed;
  }

  /**
   * @param {T} item
   * @returns {boolean}
   */
  remove(item) {
    for (let i = 0; i < this.length; i++) {
      if (this.items[i] === item) {
        this.removeAt(i);
        return true;
      }
    }
    return false;
  }

  /** @param {number} i @returns {T} */
  get(i) {
    return this.items[i];
  }

  clear() {
    for (let i = 0; i < this.length; i++) this.items[i] = undefined;
    this.length = 0;
  }

  /**
   * @param {(item: T, index: number) => void} fn
   */
  forEach(fn) {
    for (let i = 0; i < this.length; i++) fn(this.items[i], i);
  }

  /** @returns {T[]} a plain array copy (for tests and debugging) */
  toArray() {
    return this.items.slice(0, this.length);
  }
}
