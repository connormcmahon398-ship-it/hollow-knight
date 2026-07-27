/**
 * @file Uniform-grid spatial hash for broad-phase overlap queries.
 *
 * ## Why a uniform grid rather than a quadtree or BVH?
 * A room holds on the order of 10-80 active entities plus transient hitboxes and
 * projectiles, all roughly the same size (8-64px) and spread over a bounded
 * area. That is precisely the workload a uniform grid is best at: insertion is
 * O(cells covered) with no rebalancing, and queries touch a handful of buckets.
 *
 * A quadtree's advantage — adapting to clustered or wildly varying sizes —
 * doesn't apply here, and it would cost per-frame tree rebuilds plus pointer
 * chasing. Naive O(n^2) pair testing would also be survivable at 80 entities,
 * but boss arenas fire hundreds of projectiles and that is where it stops being
 * survivable.
 *
 * ## Rebuild-per-frame, not incremental
 * The hash is cleared and repopulated every step. Incremental updates require
 * tracking each item's occupied cells and diffing them on every move — more
 * code, more state to get wrong, and for these entity counts, slower in
 * practice than a linear refill of pooled arrays.
 */

/**
 * @template T
 */
export class SpatialHash {
  /**
   * @param {number} [cellSize] Should be about twice the median entity size.
   */
  constructor(cellSize = 64) {
    this.cellSize = cellSize;
    this._invCell = 1 / cellSize;
    /** @type {Map<number, T[]>} */
    this._cells = new Map();
    /** Pool of bucket arrays, so clearing does not churn the heap. */
    /** @type {T[][]} */
    this._bucketPool = [];
    this._itemCount = 0;
    /**
     * Query stamp, so `query` can deduplicate items spanning several cells
     * without allocating a Set per call.
     * @type {Map<T, number>}
     */
    this._stamps = new Map();
    this._currentStamp = 0;
  }

  /**
   * Cantor-style pairing of signed cell coordinates into a single integer key.
   * Coordinates are offset into the non-negative range first so that negative
   * positions (rooms may extend left/up of origin in world space) do not alias.
   * @param {number} cx @param {number} cy
   * @returns {number}
   * @private
   */
  _key(cx, cy) {
    // 16-bit fields with a bias; ample for any single room.
    return (((cx + 32768) & 0xffff) << 16) | ((cy + 32768) & 0xffff);
  }

  /** Empty the grid, recycling bucket arrays. */
  clear() {
    for (const bucket of this._cells.values()) {
      bucket.length = 0;
      this._bucketPool.push(bucket);
    }
    this._cells.clear();
    this._itemCount = 0;
    // Stamps are only meaningful within a single query, but the map would grow
    // unboundedly across frames if never cleared.
    if (this._stamps.size > 4096) this._stamps.clear();
  }

  /**
   * Insert an item spanning a pixel-space box.
   * @param {T} item
   * @param {number} x @param {number} y @param {number} w @param {number} h
   */
  insert(item, x, y, w, h) {
    const cx0 = Math.floor(x * this._invCell);
    const cy0 = Math.floor(y * this._invCell);
    const cx1 = Math.floor((x + w) * this._invCell);
    const cy1 = Math.floor((y + h) * this._invCell);
    for (let cy = cy0; cy <= cy1; cy++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        const key = this._key(cx, cy);
        let bucket = this._cells.get(key);
        if (!bucket) {
          bucket = this._bucketPool.pop() ?? [];
          this._cells.set(key, bucket);
        }
        bucket.push(item);
      }
    }
    this._itemCount++;
  }

  /**
   * @param {import('./aabb.js').AABB} box
   * @param {T} item
   */
  insertBox(item, box) {
    this.insert(item, box.x, box.y, box.w, box.h);
  }

  /**
   * Every item whose cells overlap the query box. Results may include items
   * whose actual boxes do not overlap — this is a *broad* phase; the caller
   * performs the exact test.
   *
   * @param {number} x @param {number} y @param {number} w @param {number} h
   * @param {T[]} [out] Destination array, cleared first. Pass one in to avoid allocating.
   * @returns {T[]}
   */
  query(x, y, w, h, out = []) {
    out.length = 0;
    const stamp = ++this._currentStamp;
    const cx0 = Math.floor(x * this._invCell);
    const cy0 = Math.floor(y * this._invCell);
    const cx1 = Math.floor((x + w) * this._invCell);
    const cy1 = Math.floor((y + h) * this._invCell);
    for (let cy = cy0; cy <= cy1; cy++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        const bucket = this._cells.get(this._key(cx, cy));
        if (!bucket) continue;
        for (let i = 0; i < bucket.length; i++) {
          const item = bucket[i];
          // Deduplicate: a large item occupies several cells in the query range.
          if (this._stamps.get(item) === stamp) continue;
          this._stamps.set(item, stamp);
          out.push(item);
        }
      }
    }
    return out;
  }

  /**
   * @param {import('./aabb.js').AABB} box
   * @param {T[]} [out]
   * @returns {T[]}
   */
  queryBox(box, out) {
    return this.query(box.x, box.y, box.w, box.h, out);
  }

  /**
   * @param {number} x @param {number} y
   * @param {number} radius
   * @param {T[]} [out]
   * @returns {T[]} broad-phase candidates within the bounding square
   */
  queryRadius(x, y, radius, out) {
    return this.query(x - radius, y - radius, radius * 2, radius * 2, out);
  }

  /** @returns {{items: number, cells: number, avgPerCell: number}} */
  stats() {
    let total = 0;
    for (const b of this._cells.values()) total += b.length;
    return {
      items: this._itemCount,
      cells: this._cells.size,
      avgPerCell: this._cells.size ? total / this._cells.size : 0,
    };
  }
}
