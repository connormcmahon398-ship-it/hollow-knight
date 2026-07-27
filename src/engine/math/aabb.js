/**
 * @file Axis-aligned bounding boxes and swept-AABB intersection.
 *
 * ## Why AABB-only collision?
 * This is a tile-based platformer. Every collider that matters — the player,
 * enemies, hitboxes, triggers, tiles — is a rectangle. Supporting arbitrary
 * convex polygons (SAT/GJK) would cost an order of magnitude more code and
 * runtime for zero gameplay benefit, and would make the *feel* harder to tune,
 * because platformer feel depends on predictable, boxy collision responses.
 *
 * Slopes, the one case where AABB is genuinely awkward, are handled as a
 * special tile type in `tilemap-collider.js` rather than by generalising the
 * whole collision system.
 *
 * ## Coordinate convention
 * Screen space: +X right, **+Y down**. Stated explicitly because half of all
 * platformer collision bugs come from mixing this up with maths convention.
 * "Top" is therefore the *smaller* y value.
 */

import { Vec2 } from './vec2.js';

export class AABB {
  /**
   * Constructed from a top-left corner and a size.
   * @param {number} [x] left
   * @param {number} [y] top
   * @param {number} [w] width
   * @param {number} [h] height
   */
  constructor(x = 0, y = 0, w = 0, h = 0) {
    this.x = x;
    this.y = y;
    this.w = w;
    this.h = h;
  }

  /**
   * @param {number} cx @param {number} cy @param {number} w @param {number} h
   * @returns {AABB}
   */
  static fromCenter(cx, cy, w, h) {
    return new AABB(cx - w / 2, cy - h / 2, w, h);
  }

  /**
   * @param {number} minX @param {number} minY @param {number} maxX @param {number} maxY
   * @returns {AABB}
   */
  static fromMinMax(minX, minY, maxX, maxY) {
    return new AABB(minX, minY, maxX - minX, maxY - minY);
  }

  get left() { return this.x; }
  get right() { return this.x + this.w; }
  get top() { return this.y; }
  get bottom() { return this.y + this.h; }
  get centerX() { return this.x + this.w / 2; }
  get centerY() { return this.y + this.h / 2; }

  /** @param {number} v */
  set left(v) { this.x = v; }
  /** @param {number} v */
  set right(v) { this.x = v - this.w; }
  /** @param {number} v */
  set top(v) { this.y = v; }
  /** @param {number} v */
  set bottom(v) { this.y = v - this.h; }
  /** @param {number} v */
  set centerX(v) { this.x = v - this.w / 2; }
  /** @param {number} v */
  set centerY(v) { this.y = v - this.h / 2; }

  /**
   * @param {number} x @param {number} y @param {number} w @param {number} h
   * @returns {this}
   */
  set(x, y, w, h) {
    this.x = x;
    this.y = y;
    this.w = w;
    this.h = h;
    return this;
  }

  /** @param {AABB} b @returns {this} */
  copy(b) {
    this.x = b.x;
    this.y = b.y;
    this.w = b.w;
    this.h = b.h;
    return this;
  }

  /** @returns {AABB} */
  clone() {
    return new AABB(this.x, this.y, this.w, this.h);
  }

  /**
   * Reposition so the box is centred on the given point, preserving size.
   * @param {number} cx @param {number} cy @returns {this}
   */
  setCenter(cx, cy) {
    this.x = cx - this.w / 2;
    this.y = cy - this.h / 2;
    return this;
  }

  /** @param {Vec2} out @returns {Vec2} */
  getCenter(out = new Vec2()) {
    return out.set(this.centerX, this.centerY);
  }

  /**
   * @param {number} dx @param {number} dy @returns {this}
   */
  translate(dx, dy) {
    this.x += dx;
    this.y += dy;
    return this;
  }

  /**
   * Grow (or shrink, if negative) in all directions.
   * @param {number} amount @returns {this}
   */
  expand(amount) {
    this.x -= amount;
    this.y -= amount;
    this.w += amount * 2;
    this.h += amount * 2;
    return this;
  }

  /**
   * @param {number} x @param {number} y @returns {boolean}
   */
  containsPoint(x, y) {
    return x >= this.x && x < this.x + this.w && y >= this.y && y < this.y + this.h;
  }

  /**
   * @param {AABB} b @returns {boolean} true if `b` is entirely inside this box
   */
  containsAABB(b) {
    return b.x >= this.x && b.y >= this.y && b.right <= this.right && b.bottom <= this.bottom;
  }

  /**
   * Standard overlap test. Touching edges do **not** count as overlapping,
   * which is the behaviour you want for "am I standing on this?" (handled
   * separately by a grounded probe) and for preventing jitter when two boxes
   * are resolved to exactly abutting positions.
   * @param {AABB} b @returns {boolean}
   */
  intersects(b) {
    return this.x < b.right && this.right > b.x && this.y < b.bottom && this.bottom > b.y;
  }

  /**
   * Overlap test with a tolerance, for "close enough" gameplay queries such as
   * hitbox-vs-hurtbox where a 1px gap should still register.
   * @param {AABB} b @param {number} tolerance @returns {boolean}
   */
  intersectsWithin(b, tolerance) {
    return (
      this.x < b.right + tolerance &&
      this.right > b.x - tolerance &&
      this.y < b.bottom + tolerance &&
      this.bottom > b.y - tolerance
    );
  }

  /**
   * The smallest translation that separates this box from `b`.
   * Returns the axis with the least penetration, which is what produces
   * believable "slide along the wall" behaviour.
   * @param {AABB} b
   * @param {Vec2} [out]
   * @returns {Vec2|null} null when not overlapping
   */
  getPenetration(b, out = new Vec2()) {
    const overlapX = Math.min(this.right, b.right) - Math.max(this.x, b.x);
    if (overlapX <= 0) return null;
    const overlapY = Math.min(this.bottom, b.bottom) - Math.max(this.y, b.y);
    if (overlapY <= 0) return null;
    if (overlapX < overlapY) {
      out.set(this.centerX < b.centerX ? -overlapX : overlapX, 0);
    } else {
      out.set(0, this.centerY < b.centerY ? -overlapY : overlapY);
    }
    return out;
  }

  /**
   * Grow this box to contain `b`.
   * @param {AABB} b @returns {this}
   */
  union(b) {
    const minX = Math.min(this.x, b.x);
    const minY = Math.min(this.y, b.y);
    const maxX = Math.max(this.right, b.right);
    const maxY = Math.max(this.bottom, b.bottom);
    return this.set(minX, minY, maxX - minX, maxY - minY);
  }

  /**
   * Minkowski-expand this box by another's size — used to turn a
   * moving-box-vs-static-box test into a ray-vs-box test.
   * @param {number} w @param {number} h @returns {AABB} new box
   */
  expandedBy(w, h) {
    return new AABB(this.x - w / 2, this.y - h / 2, this.w + w, this.h + h);
  }

  /** @returns {{x: number, y: number, w: number, h: number}} */
  toJSON() {
    return { x: this.x, y: this.y, w: this.w, h: this.h };
  }
}

/**
 * @typedef {Object} SweepResult
 * @property {boolean} hit
 * @property {number} time Fraction of the motion completed before impact, [0,1].
 * @property {number} normalX -1, 0 or 1
 * @property {number} normalY -1, 0 or 1
 * @property {number} x Contact position of the moving box (left edge).
 * @property {number} y Contact position of the moving box (top edge).
 */

/** Reusable result object so sweeps in the physics inner loop don't allocate. */
const sweepScratch = /** @type {SweepResult} */ ({
  hit: false, time: 1, normalX: 0, normalY: 0, x: 0, y: 0,
});

/**
 * Swept AABB vs static AABB.
 *
 * ## Why sweeping matters
 * Discrete collision (move, then push out of anything you overlap) fails
 * catastrophically at speed: a player dashing at 900px/s moves 15px per 60Hz
 * step and will pass straight through a 12px wall. This is the "bullet through
 * paper" problem, and in a Metroidvania it means the player can leave the map.
 *
 * The sweep solves the entry/exit times of the moving box against each axis slab
 * and takes the latest entry — the standard slab method — giving the exact time
 * of first contact and the surface normal.
 *
 * @param {AABB} box the moving box, at its start position
 * @param {number} dx total motion this step
 * @param {number} dy
 * @param {AABB} other the static box
 * @param {SweepResult} [out] optional destination, to avoid allocation
 * @returns {SweepResult}
 */
export function sweepAABB(box, dx, dy, other, out = sweepScratch) {
  out.hit = false;
  out.time = 1;
  out.normalX = 0;
  out.normalY = 0;
  out.x = box.x + dx;
  out.y = box.y + dy;

  // Pre-existing overlap must be handled *before* the slab test. The standard
  // slab formulation rejects a hit when both entry times are negative, meaning
  // "the boxes are behind me" — but an already-overlapping box also produces two
  // negative entry times, so it would be silently discarded. Entities can start
  // inside geometry (spawned in a wall, crushed by a moving platform, teleported
  // by a boss), and the physics step relies on being told so it can depenetrate.
  if (box.intersects(other)) {
    out.hit = true;
    out.time = 0;
    out.x = box.x;
    out.y = box.y;
    // Report the normal of the shallowest separating axis, which is the
    // direction the caller should push the box to get it out.
    const overlapLeft = box.right - other.x;
    const overlapRight = other.right - box.x;
    const overlapTop = box.bottom - other.y;
    const overlapBottom = other.bottom - box.y;
    const minX = Math.min(overlapLeft, overlapRight);
    const minY = Math.min(overlapTop, overlapBottom);
    if (minX < minY) {
      out.normalX = overlapLeft < overlapRight ? -1 : 1;
    } else {
      out.normalY = overlapTop < overlapBottom ? -1 : 1;
    }
    return out;
  }

  // Degenerate case: no motion and no overlap means nothing can be hit.
  if (dx === 0 && dy === 0) return out;

  // Distances to the near and far faces on each axis.
  let xEntryDist, xExitDist;
  if (dx > 0) {
    xEntryDist = other.x - box.right;
    xExitDist = other.right - box.x;
  } else {
    xEntryDist = other.right - box.x;
    xExitDist = other.x - box.right;
  }

  let yEntryDist, yExitDist;
  if (dy > 0) {
    yEntryDist = other.y - box.bottom;
    yExitDist = other.bottom - box.y;
  } else {
    yEntryDist = other.bottom - box.y;
    yExitDist = other.y - box.bottom;
  }

  // Convert distances to times. A zero component means the box never crosses
  // that axis, so it is "always inside" if currently overlapping on that axis
  // and never inside otherwise — expressed with infinities.
  let xEntry, xExit, yEntry, yExit;
  if (dx === 0) {
    // Overlapping on X already?
    if (box.right <= other.x || box.x >= other.right) {
      xEntry = Infinity;
      xExit = -Infinity;
    } else {
      xEntry = -Infinity;
      xExit = Infinity;
    }
  } else {
    xEntry = xEntryDist / dx;
    xExit = xExitDist / dx;
  }

  if (dy === 0) {
    if (box.bottom <= other.y || box.y >= other.bottom) {
      yEntry = Infinity;
      yExit = -Infinity;
    } else {
      yEntry = -Infinity;
      yExit = Infinity;
    }
  } else {
    yEntry = yEntryDist / dy;
    yExit = yExitDist / dy;
  }

  const entryTime = Math.max(xEntry, yEntry);
  const exitTime = Math.min(xExit, yExit);

  // No collision if we exit before entering, if the contact is behind us
  // (we already ruled out initial overlap above, so a negative entry on both
  // axes genuinely means "behind"), or if it lies beyond the end of this step.
  if (entryTime > exitTime || (xEntry < 0 && yEntry < 0) || entryTime > 1 || entryTime < 0) {
    return out;
  }

  out.hit = true;
  out.time = entryTime;
  if (xEntry > yEntry) {
    out.normalX = dx > 0 ? -1 : 1;
  } else {
    out.normalY = dy > 0 ? -1 : 1;
  }
  out.x = box.x + dx * entryTime;
  out.y = box.y + dy * entryTime;
  return out;
}

/**
 * Ray vs AABB, returning the entry time along the ray in [0, maxT].
 * Used for line-of-sight checks, aim assist and grapple targeting.
 *
 * @param {number} ox @param {number} oy ray origin
 * @param {number} dx @param {number} dy ray direction (need not be normalised)
 * @param {AABB} box
 * @param {number} [maxT]
 * @returns {number} entry time, or -1 for a miss
 */
export function rayAABB(ox, oy, dx, dy, box, maxT = 1) {
  // Guard against division by zero using the IEEE infinity behaviour, which
  // handles axis-aligned rays correctly without branching.
  const invDx = dx !== 0 ? 1 / dx : Infinity;
  const invDy = dy !== 0 ? 1 / dy : Infinity;

  let t1 = (box.x - ox) * invDx;
  let t2 = (box.right - ox) * invDx;
  let tmin = Math.min(t1, t2);
  let tmax = Math.max(t1, t2);

  t1 = (box.y - oy) * invDy;
  t2 = (box.bottom - oy) * invDy;
  tmin = Math.max(tmin, Math.min(t1, t2));
  tmax = Math.min(tmax, Math.max(t1, t2));

  if (tmax < 0 || tmin > tmax || tmin > maxT) return -1;
  return tmin < 0 ? 0 : tmin;
}
