/**
 * @file Dynamic physics body.
 *
 * A `Body` is the movement state of anything that collides with the world: the
 * player, enemies, projectiles, physics props. It owns position, velocity and
 * the *results* of last step's collision resolution.
 *
 * ## Why store collision results rather than firing callbacks?
 * Callbacks during resolution would re-introduce the ordering hazards the event
 * bus exists to avoid, and character controllers overwhelmingly want to *query*
 * ("am I on the ground?") rather than *react instantly*. Flags such as
 * `grounded`, `hitCeiling` and `touchingWall` are set once per step and read by
 * whatever needs them, in whatever order.
 *
 * ## Previous position
 * `prevX/prevY` are kept so the renderer can interpolate between simulation
 * steps (see `loop.js`), and so systems can detect threshold crossings — for
 * example "did I cross this trigger line this step?" which is more robust than
 * an overlap test at high speed.
 */

import { AABB } from '../math/aabb.js';
import { Vec2 } from '../math/vec2.js';

/**
 * Collision response categories, used for filtering.
 * @type {Readonly<Record<string, number>>}
 */
export const CollisionLayer = Object.freeze({
  NONE: 0,
  PLAYER: 1 << 0,
  ENEMY: 1 << 1,
  PLAYER_ATTACK: 1 << 2,
  ENEMY_ATTACK: 1 << 3,
  PROJECTILE: 1 << 4,
  PICKUP: 1 << 5,
  TRIGGER: 1 << 6,
  NPC: 1 << 7,
  PROP: 1 << 8,
  ALL: 0xffff,
});

let nextBodyId = 1;

export class Body {
  /**
   * @param {object} [options]
   * @param {number} [options.x]
   * @param {number} [options.y]
   * @param {number} [options.width]
   * @param {number} [options.height]
   * @param {number} [options.gravityScale]
   * @param {boolean} [options.collidesWithTiles]
   * @param {number} [options.layer]
   * @param {number} [options.mask]
   */
  constructor(options = {}) {
    this.id = nextBodyId++;

    /** Collider, positioned in world pixel space. */
    this.box = new AABB(
      options.x ?? 0,
      options.y ?? 0,
      options.width ?? 16,
      options.height ?? 16,
    );

    this.velocity = new Vec2(0, 0);
    /** Accumulated external force for this step, cleared after integration. */
    this.impulse = new Vec2(0, 0);

    this.prevX = this.box.x;
    this.prevY = this.box.y;

    /** Multiplier on world gravity. 0 for flying enemies, negative to float up. */
    this.gravityScale = options.gravityScale ?? 1;
    /** Per-body terminal velocity. Prevents unreadable falling speeds. */
    this.maxFallSpeed = 620;
    /** Linear drag applied every step, as a fraction retained per second. */
    this.dragX = 0;
    this.dragY = 0;

    this.collidesWithTiles = options.collidesWithTiles ?? true;
    /** When false the body is integrated but never resolved (used for VFX). */
    this.enabled = true;
    /** Static bodies never move and are skipped by integration. */
    this.isStatic = false;

    this.layer = options.layer ?? CollisionLayer.NONE;
    this.mask = options.mask ?? CollisionLayer.ALL;

    // --- collision results, refreshed every step ---
    this.grounded = false;
    this.wasGrounded = false;
    this.hitCeiling = false;
    this.hitWallLeft = false;
    this.hitWallRight = false;
    /** Tile id of the surface currently stood on, for footstep audio and friction. */
    this.groundTile = 0;
    /** Surface friction multiplier from the ground tile. */
    this.groundFriction = 1;
    /** Horizontal velocity imparted by a conveyor surface. */
    this.groundConveyor = 0;
    /** Slope angle of the ground, radians. Positive means rising to the right. */
    this.groundAngle = 0;
    /** True while any part of the body is inside a fluid tile. */
    this.inFluid = false;
    /** Density of the fluid the body is in, 0 when dry. */
    this.fluidDensity = 0;
    /** Fraction of the body submerged, 0..1. */
    this.submersion = 0;
    /** True while overlapping a climbable tile. */
    this.onClimbable = false;
    /** True while overlapping an updraft tile. */
    this.inUpdraft = false;

    /**
     * Allows a body to pass down through one-way platforms this step.
     * The controller sets it when the player holds down and presses jump.
     */
    this.dropThrough = false;

    /**
     * Set by the resolver when the body is squeezed between two solids. The
     * game turns this into crush damage; without it, moving platforms would
     * silently push entities into walls.
     */
    this.crushed = false;

    /**
     * Optional back-reference to the owning entity, so collision consumers can
     * get from a body to game state without a lookup table.
     * @type {any}
     */
    this.owner = null;
  }

  get x() { return this.box.x; }
  set x(v) { this.box.x = v; }
  get y() { return this.box.y; }
  set y(v) { this.box.y = v; }
  get width() { return this.box.w; }
  get height() { return this.box.h; }
  get centerX() { return this.box.centerX; }
  get centerY() { return this.box.centerY; }
  get bottom() { return this.box.bottom; }
  get top() { return this.box.top; }
  get left() { return this.box.x; }
  get right() { return this.box.right; }

  /**
   * Teleport, clearing motion history so interpolation does not smear the body
   * across the screen. Used for room transitions and respawns.
   * @param {number} x @param {number} y
   */
  teleport(x, y) {
    this.box.x = x;
    this.box.y = y;
    this.prevX = x;
    this.prevY = y;
    this.velocity.zero();
  }

  /**
   * Place the body's feet at a point, centred horizontally. The natural way to
   * express spawn points, which are authored as floor positions.
   * @param {number} x @param {number} y
   */
  placeFeetAt(x, y) {
    this.teleport(x - this.box.w / 2, y - this.box.h);
  }

  /**
   * @param {number} x @param {number} y
   */
  applyImpulse(x, y) {
    this.impulse.x += x;
    this.impulse.y += y;
  }

  /**
   * @param {number} newW @param {number} newH
   * @param {boolean} [anchorBottom] keep the feet in place while resizing
   */
  resize(newW, newH, anchorBottom = true) {
    if (anchorBottom) {
      const bottom = this.box.bottom;
      const cx = this.box.centerX;
      this.box.w = newW;
      this.box.h = newH;
      this.box.centerX = cx;
      this.box.bottom = bottom;
    } else {
      this.box.w = newW;
      this.box.h = newH;
    }
  }

  /** Clear per-step collision results. Called at the start of resolution. */
  clearContacts() {
    this.wasGrounded = this.grounded;
    this.grounded = false;
    this.hitCeiling = false;
    this.hitWallLeft = false;
    this.hitWallRight = false;
    this.groundTile = 0;
    this.groundFriction = 1;
    this.groundConveyor = 0;
    this.groundAngle = 0;
    this.inFluid = false;
    this.fluidDensity = 0;
    this.submersion = 0;
    this.onClimbable = false;
    this.inUpdraft = false;
    this.crushed = false;
  }

  /**
   * Interpolated render position between the previous and current step.
   * @param {number} alpha
   * @returns {number}
   */
  renderX(alpha) {
    return this.prevX + (this.box.x - this.prevX) * alpha;
  }

  /** @param {number} alpha @returns {number} */
  renderY(alpha) {
    return this.prevY + (this.box.y - this.prevY) * alpha;
  }

  /** @returns {boolean} true only on the step the body touched down */
  justLanded() {
    return this.grounded && !this.wasGrounded;
  }

  /** @returns {boolean} true only on the step the body left the ground */
  justLeftGround() {
    return !this.grounded && this.wasGrounded;
  }

  /** @returns {boolean} */
  touchingWall() {
    return this.hitWallLeft || this.hitWallRight;
  }

  /** @returns {number} -1 for a wall on the left, 1 on the right, 0 for none */
  wallDirection() {
    if (this.hitWallLeft) return -1;
    if (this.hitWallRight) return 1;
    return 0;
  }
}
