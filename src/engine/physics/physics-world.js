/**
 * @file The physics world: force integration, tile resolution and broad-phase.
 *
 * Responsibilities, in order of execution each step:
 *  1. Integrate forces (gravity, buoyancy, drag, impulses) into velocity.
 *  2. Clamp velocity to sane limits.
 *  3. Move each body through the tilemap, resolving collisions.
 *  4. Rebuild the broad-phase hash from the resolved positions.
 *
 * Entity-vs-entity *response* deliberately lives outside physics. In an action
 * platformer, two enemies overlapping is fine, a hitbox overlapping a hurtbox is
 * a combat event rather than a collision, and the player is never pushed around
 * by rigid-body response. Physics therefore answers "who overlaps whom" and lets
 * combat, pickups and triggers decide what that means.
 *
 * ## Integration scheme
 * Semi-implicit (symplectic) Euler: velocity is updated first, then position
 * uses the *new* velocity. It is one line different from explicit Euler and
 * markedly more stable for gravity, which matters because jump arcs are tuned
 * by hand and must not drift with step size.
 */

import { moveAndCollide } from './tilemap-collider.js';
import { SpatialHash } from '../math/spatial-hash.js';
import { clamp } from '../math/math-utils.js';

/** Downward acceleration, px/s^2. Tuned against jump feel, not realism. */
export const DEFAULT_GRAVITY = 1500;

export class PhysicsWorld {
  /**
   * @param {object} [options]
   * @param {number} [options.gravity]
   * @param {number} [options.cellSize] Broad-phase cell size.
   */
  constructor(options = {}) {
    this.gravity = options.gravity ?? DEFAULT_GRAVITY;
    /** @type {import('./tilemap.js').Tilemap|null} */
    this.map = null;
    /** @type {import('./body.js').Body[]} */
    this.bodies = [];
    /** @type {SpatialHash<import('./body.js').Body>} */
    this.hash = new SpatialHash(options.cellSize ?? 64);
    /** Scratch array reused by queries. @type {import('./body.js').Body[]} */
    this._queryScratch = [];
    /** Global multiplier, used for slow-motion effects. */
    this.timeScale = 1;
  }

  /** @param {import('./tilemap.js').Tilemap} map */
  setMap(map) {
    this.map = map;
  }

  /** @param {import('./body.js').Body} body */
  add(body) {
    if (!this.bodies.includes(body)) this.bodies.push(body);
  }

  /** @param {import('./body.js').Body} body */
  remove(body) {
    const i = this.bodies.indexOf(body);
    if (i >= 0) this.bodies.splice(i, 1);
  }

  /** Drop every body (room teardown). */
  clear() {
    this.bodies.length = 0;
    this.hash.clear();
  }

  /**
   * Advance the simulation one fixed step.
   * @param {number} dt seconds
   */
  step(dt) {
    const scaledDt = dt * this.timeScale;
    if (scaledDt <= 0) return;

    for (let i = 0; i < this.bodies.length; i++) {
      const body = this.bodies[i];
      if (!body.enabled || body.isStatic) continue;
      this.integrate(body, scaledDt);
    }

    this.rebuildHash();
  }

  /**
   * Integrate and resolve a single body.
   * @param {import('./body.js').Body} body
   * @param {number} dt
   */
  integrate(body, dt) {
    const v = body.velocity;

    body.prevX = body.box.x;
    body.prevY = body.box.y;
    body.clearContacts();

    // --- Forces ---

    // Buoyancy is applied from the *previous* step's fluid sample. Sampling
    // before integration would require a second collision pass; using last
    // step's value is one frame stale and completely imperceptible.
    if (body.fluidDensity > 0) {
      // A density of 1 exactly cancels gravity; above 1 the body rises.
      const buoyancy = this.gravity * body.gravityScale * body.fluidDensity * body.submersion;
      v.y += (this.gravity * body.gravityScale - buoyancy) * dt;
      // Fluid drag, stronger than air. Applied as an exponential decay so it is
      // stable regardless of speed.
      const drag = Math.exp(-2.5 * body.fluidDensity * dt);
      v.x *= drag;
      v.y *= drag;
    } else {
      v.y += this.gravity * body.gravityScale * dt;
    }

    if (body.inUpdraft) {
      // Updrafts push up hard enough to overcome gravity and then some.
      v.y -= this.gravity * 1.8 * dt;
    }

    if (body.impulse.x !== 0 || body.impulse.y !== 0) {
      v.x += body.impulse.x;
      v.y += body.impulse.y;
      body.impulse.zero();
    }

    if (body.dragX !== 0) v.x *= Math.exp(-body.dragX * dt);
    if (body.dragY !== 0) v.y *= Math.exp(-body.dragY * dt);

    // Conveyor surfaces add to the *position* rather than velocity, so they do
    // not fight the controller's own acceleration curve.
    let conveyorDx = 0;
    if (body.grounded && body.groundConveyor !== 0) {
      conveyorDx = body.groundConveyor * dt;
    }

    // Terminal velocity keeps long falls readable and keeps the substep count
    // in the collider bounded.
    if (v.y > body.maxFallSpeed) v.y = body.maxFallSpeed;
    // A generous horizontal cap catches runaway impulse bugs.
    v.x = clamp(v.x, -2000, 2000);

    // --- Motion ---
    const dx = v.x * dt + conveyorDx;
    const dy = v.y * dt;

    if (this.map) {
      moveAndCollide(body, this.map, dx, dy);
    } else {
      body.box.x += dx;
      body.box.y += dy;
    }

    // `dropThrough` is a one-shot request; clearing it here means the controller
    // sets it and forgets it.
    body.dropThrough = false;
  }

  /** Repopulate the broad-phase grid from current positions. */
  rebuildHash() {
    this.hash.clear();
    for (let i = 0; i < this.bodies.length; i++) {
      const b = this.bodies[i];
      if (!b.enabled) continue;
      this.hash.insertBox(b, b.box);
    }
  }

  /**
   * Exact overlap query against registered bodies.
   * @param {import('../math/aabb.js').AABB} box
   * @param {number} [mask] Only return bodies whose `layer` intersects this mask.
   * @param {import('./body.js').Body[]} [out]
   * @returns {import('./body.js').Body[]}
   */
  queryOverlaps(box, mask = 0xffff, out = []) {
    out.length = 0;
    const candidates = this.hash.queryBox(box, this._queryScratch);
    for (let i = 0; i < candidates.length; i++) {
      const b = candidates[i];
      if (!b.enabled) continue;
      if ((b.layer & mask) === 0) continue;
      if (b.box.intersects(box)) out.push(b);
    }
    return out;
  }

  /**
   * Nearest body to a point within a radius.
   * @param {number} x @param {number} y @param {number} radius
   * @param {number} [mask]
   * @returns {import('./body.js').Body|null}
   */
  queryNearest(x, y, radius, mask = 0xffff) {
    const candidates = this.hash.queryRadius(x, y, radius, this._queryScratch);
    let best = null;
    let bestDistSq = radius * radius;
    for (let i = 0; i < candidates.length; i++) {
      const b = candidates[i];
      if (!b.enabled || (b.layer & mask) === 0) continue;
      const dx = b.box.centerX - x;
      const dy = b.box.centerY - y;
      const d = dx * dx + dy * dy;
      if (d < bestDistSq) {
        bestDistSq = d;
        best = b;
      }
    }
    return best;
  }
}
