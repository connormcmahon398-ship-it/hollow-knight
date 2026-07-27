/**
 * @file Tile grid storage and spatial queries.
 *
 * A `Tilemap` is pure data plus queries — it knows nothing about entities,
 * rendering or the game. Every room owns one. The physics resolver
 * (`tilemap-collider.js`) reads from it; the tile painter renders it.
 *
 * ## Layers
 * Each map carries two grids:
 *  - **collision** — the layer physics reads.
 *  - **decor** — purely visual tiles (background masonry, hanging growth) that
 *    must never affect movement.
 *
 * Keeping them separate means an artist can fill a room with visual detail
 * without any risk of accidentally creating a collider, which is by far the most
 * common authoring mistake in tile-based games.
 *
 * ## Out-of-bounds policy
 * Reads outside the grid return a configurable `outOfBoundsTile`, defaulting to
 * SOLID. A room whose edges are implicitly solid cannot be escaped by a physics
 * bug, and room transitions are handled by explicit trigger volumes rather than
 * by falling out of the world.
 */

import { TILE_SIZE, Tiles, isSolid, isOpaque, getTileDef } from './tiles.js';
import { AABB } from '../math/aabb.js';

export class Tilemap {
  /**
   * @param {number} width in tiles
   * @param {number} height in tiles
   * @param {object} [options]
   * @param {number} [options.tileSize]
   * @param {number} [options.outOfBoundsTile]
   */
  constructor(width, height, options = {}) {
    if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
      throw new Error(`Tilemap: invalid size ${width}x${height}`);
    }
    this.width = width;
    this.height = height;
    this.tileSize = options.tileSize ?? TILE_SIZE;
    this.outOfBoundsTile = options.outOfBoundsTile ?? Tiles.SOLID;

    /** Collision layer. @type {Uint16Array} */
    this.tiles = new Uint16Array(width * height);
    /** Decoration layer, never collided against. @type {Uint16Array} */
    this.decor = new Uint16Array(width * height);

    /**
     * Per-tile mutable state, sparse. Used by crumbling platforms (their timer)
     * and by breakable tiles (their remaining health). A Map keeps the common
     * case free — most rooms have no stateful tiles at all.
     * @type {Map<number, {timer?: number, health?: number, broken?: boolean}>}
     */
    this.tileState = new Map();

    /** Cached pixel bounds of the whole map. */
    this.bounds = new AABB(0, 0, width * this.tileSize, height * this.tileSize);
  }

  /** @returns {number} map width in pixels */
  get pixelWidth() {
    return this.width * this.tileSize;
  }

  /** @returns {number} map height in pixels */
  get pixelHeight() {
    return this.height * this.tileSize;
  }

  /**
   * @param {number} tx @param {number} ty
   * @returns {boolean}
   */
  inBounds(tx, ty) {
    return tx >= 0 && ty >= 0 && tx < this.width && ty < this.height;
  }

  /**
   * @param {number} tx @param {number} ty
   * @returns {number} tile id, or `outOfBoundsTile` outside the grid
   */
  get(tx, ty) {
    if (tx < 0 || ty < 0 || tx >= this.width || ty >= this.height) return this.outOfBoundsTile;
    return this.tiles[ty * this.width + tx];
  }

  /**
   * @param {number} tx @param {number} ty
   * @returns {number}
   */
  getDecor(tx, ty) {
    if (tx < 0 || ty < 0 || tx >= this.width || ty >= this.height) return Tiles.EMPTY;
    return this.decor[ty * this.width + tx];
  }

  /**
   * @param {number} tx @param {number} ty @param {number} id
   */
  set(tx, ty, id) {
    if (!this.inBounds(tx, ty)) return;
    this.tiles[ty * this.width + tx] = id;
  }

  /**
   * @param {number} tx @param {number} ty @param {number} id
   */
  setDecor(tx, ty, id) {
    if (!this.inBounds(tx, ty)) return;
    this.decor[ty * this.width + tx] = id;
  }

  /**
   * Tile id at a world-space pixel position.
   * @param {number} x @param {number} y
   * @returns {number}
   */
  getAtPixel(x, y) {
    return this.get(Math.floor(x / this.tileSize), Math.floor(y / this.tileSize));
  }

  /** @param {number} x @returns {number} */
  toTileX(x) {
    return Math.floor(x / this.tileSize);
  }

  /** @param {number} y @returns {number} */
  toTileY(y) {
    return Math.floor(y / this.tileSize);
  }

  /**
   * @param {number} tx @param {number} ty
   * @param {AABB} [out]
   * @returns {AABB} the pixel-space box of a tile
   */
  tileBounds(tx, ty, out = new AABB()) {
    return out.set(tx * this.tileSize, ty * this.tileSize, this.tileSize, this.tileSize);
  }

  /**
   * Range of tiles overlapping a pixel-space box, clamped to a sane window.
   *
   * The `-1e-9` on the max edges matters: a box whose right edge sits exactly on
   * a tile boundary must not be treated as overlapping the next tile, or an
   * entity standing flush against a wall reports a collision every frame and
   * jitters.
   *
   * @param {AABB} box
   * @param {{x0: number, y0: number, x1: number, y1: number}} [out]
   * @returns {{x0: number, y0: number, x1: number, y1: number}} inclusive tile range
   */
  tileRange(box, out = { x0: 0, y0: 0, x1: 0, y1: 0 }) {
    const ts = this.tileSize;
    out.x0 = Math.floor(box.x / ts);
    out.y0 = Math.floor(box.y / ts);
    out.x1 = Math.floor((box.right - 1e-9) / ts);
    out.y1 = Math.floor((box.bottom - 1e-9) / ts);
    return out;
  }

  /**
   * @param {AABB} box
   * @returns {boolean} true if any fully-solid tile overlaps the box
   */
  overlapsSolid(box) {
    const r = this.tileRange(box);
    for (let ty = r.y0; ty <= r.y1; ty++) {
      for (let tx = r.x0; tx <= r.x1; tx++) {
        if (isSolid(this.get(tx, ty))) return true;
      }
    }
    return false;
  }

  /**
   * Collect every tile of interest overlapping a box.
   * @param {AABB} box
   * @param {(id: number, tx: number, ty: number) => void} fn
   */
  forEachTileIn(box, fn) {
    const r = this.tileRange(box);
    const y0 = Math.max(0, r.y0);
    const y1 = Math.min(this.height - 1, r.y1);
    const x0 = Math.max(0, r.x0);
    const x1 = Math.min(this.width - 1, r.x1);
    for (let ty = y0; ty <= y1; ty++) {
      const row = ty * this.width;
      for (let tx = x0; tx <= x1; tx++) {
        fn(this.tiles[row + tx], tx, ty);
      }
    }
  }

  /**
   * Bresenham-style line-of-sight test against opaque tiles. Used by enemy AI
   * to decide whether it can actually see the player rather than merely being
   * within range — the difference between "alert" enemies feeling intelligent
   * and feeling clairvoyant.
   *
   * @param {number} x0 @param {number} y0 @param {number} x1 @param {number} y1 pixel coords
   * @returns {boolean} true if nothing opaque blocks the line
   */
  hasLineOfSight(x0, y0, x1, y1) {
    const ts = this.tileSize;
    let tx = Math.floor(x0 / ts);
    let ty = Math.floor(y0 / ts);
    const endX = Math.floor(x1 / ts);
    const endY = Math.floor(y1 / ts);

    const dx = x1 - x0;
    const dy = y1 - y0;
    const stepX = dx > 0 ? 1 : -1;
    const stepY = dy > 0 ? 1 : -1;

    // Distance along the ray to the next tile boundary on each axis.
    const tDeltaX = dx === 0 ? Infinity : Math.abs(ts / dx);
    const tDeltaY = dy === 0 ? Infinity : Math.abs(ts / dy);
    let tMaxX = dx === 0
      ? Infinity
      : Math.abs(((dx > 0 ? (tx + 1) * ts : tx * ts) - x0) / dx);
    let tMaxY = dy === 0
      ? Infinity
      : Math.abs(((dy > 0 ? (ty + 1) * ts : ty * ts) - y0) / dy);

    // Bound the walk; a malformed ray must not hang the frame.
    const maxSteps = this.width + this.height + 4;
    for (let i = 0; i < maxSteps; i++) {
      if (isOpaque(this.get(tx, ty))) return false;
      if (tx === endX && ty === endY) return true;
      if (tMaxX < tMaxY) {
        tMaxX += tDeltaX;
        tx += stepX;
      } else {
        tMaxY += tDeltaY;
        ty += stepY;
      }
      if (tMaxX > 1 && tMaxY > 1) return true; // passed the endpoint
    }
    return true;
  }

  /**
   * Find the ground height directly below a point, for AI navigation and for
   * placing decorations at author time.
   * @param {number} x pixel
   * @param {number} y pixel, search starts here and goes down
   * @param {number} [maxTiles]
   * @returns {number} pixel y of the ground surface, or Infinity if none found
   */
  groundBelow(x, y, maxTiles = 64) {
    const tx = this.toTileX(x);
    let ty = this.toTileY(y);
    for (let i = 0; i < maxTiles; i++, ty++) {
      if (ty >= this.height) return Infinity;
      const id = this.get(tx, ty);
      const def = getTileDef(id);
      if (def.solid || def.oneWay) return ty * this.tileSize;
    }
    return Infinity;
  }

  /** Reset all per-tile mutable state (called when a room is re-entered). */
  resetTileState() {
    this.tileState.clear();
  }

  /**
   * @param {number} tx @param {number} ty
   * @returns {{timer?: number, health?: number, broken?: boolean}}
   */
  getTileState(tx, ty) {
    const key = ty * this.width + tx;
    let s = this.tileState.get(key);
    if (!s) {
      s = {};
      this.tileState.set(key, s);
    }
    return s;
  }

  /**
   * Fill a rectangular region. Used heavily by the world generation tools.
   * @param {number} x @param {number} y @param {number} w @param {number} h @param {number} id
   */
  fillRect(x, y, w, h, id) {
    const x1 = Math.min(this.width, x + w);
    const y1 = Math.min(this.height, y + h);
    for (let ty = Math.max(0, y); ty < y1; ty++) {
      const row = ty * this.width;
      for (let tx = Math.max(0, x); tx < x1; tx++) {
        this.tiles[row + tx] = id;
      }
    }
  }

  /**
   * Draw the outline of a rectangle.
   * @param {number} x @param {number} y @param {number} w @param {number} h @param {number} id
   */
  strokeRect(x, y, w, h, id) {
    for (let tx = x; tx < x + w; tx++) {
      this.set(tx, y, id);
      this.set(tx, y + h - 1, id);
    }
    for (let ty = y; ty < y + h; ty++) {
      this.set(x, ty, id);
      this.set(x + w - 1, ty, id);
    }
  }

  /**
   * Replace every instance of one tile id with another.
   * @param {number} from @param {number} to
   * @returns {number} count replaced
   */
  replaceAll(from, to) {
    let n = 0;
    for (let i = 0; i < this.tiles.length; i++) {
      if (this.tiles[i] === from) {
        this.tiles[i] = to;
        n++;
      }
    }
    return n;
  }

  /**
   * @param {number} id
   * @returns {number} how many cells hold this tile
   */
  count(id) {
    let n = 0;
    for (let i = 0; i < this.tiles.length; i++) if (this.tiles[i] === id) n++;
    return n;
  }

  /** @returns {Tilemap} a deep copy */
  clone() {
    const m = new Tilemap(this.width, this.height, {
      tileSize: this.tileSize,
      outOfBoundsTile: this.outOfBoundsTile,
    });
    m.tiles.set(this.tiles);
    m.decor.set(this.decor);
    return m;
  }
}
