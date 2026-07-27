/**
 * @file The camera.
 *
 * ## Design goals
 * A Metroidvania camera has one job that sounds simple and is not: keep the
 * player readable while never drawing attention to itself. The three failure
 * modes are (a) jitter — the camera micro-corrects every frame; (b) lag — the
 * player outruns the frame and you cannot see what you are about to land on;
 * (c) clipping — the camera shows the void beyond a room's edge.
 *
 * The implementation combines four mechanisms, each solving one problem:
 *
 * 1. **Dead zone.** A rectangle in screen space inside which the player can move
 *    without the camera responding at all. This is what kills jitter: small
 *    movements (a short hop, a slash's recoil) produce *zero* camera motion.
 * 2. **Look-ahead.** The focus point is offset in the direction of travel, so
 *    running right shows more of the right. Ramped in over time rather than
 *    applied instantly, or the camera would snap on every direction change.
 * 3. **Critically-damped spring.** Smooth pursuit without overshoot. A spring is
 *    used rather than exponential damping because it eases *in* as well as out —
 *    the camera accelerates rather than jerking into motion.
 * 4. **Room clamping.** The view is confined to the current room's bounds, with
 *    graceful handling of rooms smaller than the viewport (centre instead of
 *    clamp).
 *
 * On top of that sit **screen shake** (trauma-based, decaying quadratically) and
 * **focus overrides** for boss intros and cutscenes.
 *
 * ## Pixel snapping
 * The final camera position is rounded to whole pixels before rendering. Without
 * this, the procedurally drawn geometry shimmers as sub-pixel edges alias
 * differently each frame. Snapping is applied only at the *render* transform, so
 * the underlying smooth position is preserved and the motion still reads as
 * fluid.
 */

import { clamp, springDamp, damp } from '../math/math-utils.js';
import { AABB } from '../math/aabb.js';

export class Camera {
  /**
   * @param {number} viewWidth
   * @param {number} viewHeight
   */
  constructor(viewWidth, viewHeight) {
    /** Centre of the view in world space. */
    this.x = 0;
    this.y = 0;
    this.viewWidth = viewWidth;
    this.viewHeight = viewHeight;
    this.zoom = 1;

    /** Spring state, one per axis. */
    this._sx = { value: 0, velocity: 0 };
    this._sy = { value: 0, velocity: 0 };

    /**
     * Dead zone half-extents, in world units. Wider than tall because
     * horizontal movement is continuous and vertical movement is punctuated —
     * a tall dead zone would swallow jumps entirely and leave the player unable
     * to see where they are landing.
     */
    this.deadzoneX = 28;
    this.deadzoneY = 20;

    /** How far ahead of the player to look, in world units. */
    this.lookAheadX = 46;
    this.lookAheadY = 32;
    /** Seconds for look-ahead to reach full extension. */
    this.lookAheadRate = 3.2;
    this._lookX = 0;
    this._lookY = 0;

    /** Spring smoothing time, seconds. Lower is snappier. */
    this.smoothTime = 0.22;
    /** Vertical smoothing is slower, so jumps do not drag the view up. */
    this.smoothTimeY = 0.34;

    /** World-space rectangle the view is confined to. */
    this.bounds = new AABB(0, 0, 0, 0);
    this.hasBounds = false;

    // --- screen shake ---
    /** Trauma in 0..1. Shake magnitude is trauma^2, so small hits barely register. */
    this.trauma = 0;
    this.traumaDecay = 1.4;
    this.maxShakeOffset = 22;
    this.maxShakeAngle = 0.045;
    this.shakeX = 0;
    this.shakeY = 0;
    this.shakeAngle = 0;
    this._shakeSeed = Math.random() * 1000;
    this._shakeTime = 0;

    /**
     * When set, the camera targets this point instead of the follow target.
     * Used for boss arena framing and cutscenes.
     * @type {{x: number, y: number, weight: number}|null}
     */
    this.focusOverride = null;

    /** Additive offset applied after everything else (used by cutscene pans). */
    this.offsetX = 0;
    this.offsetY = 0;

    /** @type {{x: number, y: number}|null} */
    this._target = null;
    /** Facing sign of the follow target, drives look-ahead direction. */
    this._targetFacing = 1;
    this._targetVelX = 0;
    this._targetVelY = 0;
    this._targetGrounded = true;

    /** Vertical position the camera holds while airborne. */
    this._groundedY = 0;
  }

  /**
   * @param {number} w @param {number} h
   */
  resize(w, h) {
    this.viewWidth = w;
    this.viewHeight = h;
  }

  /** @returns {number} */
  get halfWidth() {
    return this.viewWidth / (2 * this.zoom);
  }

  /** @returns {number} */
  get halfHeight() {
    return this.viewHeight / (2 * this.zoom);
  }

  /**
   * Confine the view to a room.
   * @param {number} x @param {number} y @param {number} w @param {number} h
   */
  setBounds(x, y, w, h) {
    this.bounds.set(x, y, w, h);
    this.hasBounds = true;
  }

  clearBounds() {
    this.hasBounds = false;
  }

  /**
   * Jump the camera to its ideal position immediately, clearing all smoothing.
   * Called on room entry and respawn — smoothing across a room transition would
   * show a long pan through solid rock.
   * @param {number} x @param {number} y
   */
  snapTo(x, y) {
    this.x = x;
    this.y = y;
    this._sx.value = x;
    this._sx.velocity = 0;
    this._sy.value = y;
    this._sy.velocity = 0;
    this._lookX = 0;
    this._lookY = 0;
    this._groundedY = y;
    this.applyBounds();
    this._sx.value = this.x;
    this._sy.value = this.y;
  }

  /**
   * Update per-frame follow state. Called by the game before `update`.
   * @param {{x: number, y: number}} point world-space focus point (usually the player's centre)
   * @param {object} [info]
   * @param {number} [info.facing] -1 or 1
   * @param {number} [info.velocityX]
   * @param {number} [info.velocityY]
   * @param {boolean} [info.grounded]
   */
  follow(point, info = {}) {
    this._target = point;
    if (info.facing !== undefined) this._targetFacing = info.facing;
    if (info.velocityX !== undefined) this._targetVelX = info.velocityX;
    if (info.velocityY !== undefined) this._targetVelY = info.velocityY;
    if (info.grounded !== undefined) this._targetGrounded = info.grounded;
  }

  /**
   * Add screen shake. Trauma accumulates and decays; magnitude scales as
   * trauma squared so that a stream of small hits stays subtle while a boss
   * slam is violent.
   * @param {number} amount 0..1
   */
  addTrauma(amount) {
    this.trauma = clamp(this.trauma + amount, 0, 1);
  }

  /**
   * @param {number} dt
   */
  update(dt) {
    if (this._target) {
      this._updateFollow(dt);
    }
    this._updateShake(dt);
  }

  /**
   * @param {number} dt
   * @private
   */
  _updateFollow(dt) {
    const target = this._target;

    // --- look-ahead ---
    // Extend in the direction of travel, but only once the player is genuinely
    // moving. Using facing alone would swing the camera when the player merely
    // turns on the spot, which is disorienting.
    const movingX = Math.abs(this._targetVelX) > 20;
    const desiredLookX = movingX ? this.lookAheadX * Math.sign(this._targetVelX) : 0;
    this._lookX = damp(this._lookX, desiredLookX, this.lookAheadRate, dt);

    // Vertical look-ahead only applies to sustained falls, so it reveals what is
    // below during a long drop without bobbing on every jump.
    const falling = this._targetVelY > 260;
    const desiredLookY = falling ? this.lookAheadY : 0;
    this._lookY = damp(this._lookY, desiredLookY, 2.2, dt);

    let focusX = target.x + this._lookX;
    let focusY = target.y + this._lookY;

    if (this.focusOverride) {
      const w = clamp(this.focusOverride.weight, 0, 1);
      focusX = focusX * (1 - w) + this.focusOverride.x * w;
      focusY = focusY * (1 - w) + this.focusOverride.y * w;
    }

    // --- dead zone ---
    // Only pull the camera by the amount the focus has escaped the zone.
    let goalX = this._sx.value;
    const dx = focusX - this._sx.value;
    if (dx > this.deadzoneX) goalX = focusX - this.deadzoneX;
    else if (dx < -this.deadzoneX) goalX = focusX + this.deadzoneX;

    // Vertical uses a "platform anchored" scheme: while grounded the camera
    // tracks the player's height; while airborne it holds the last grounded
    // height until the player leaves a larger window. This is what stops the
    // view from bouncing during normal platforming.
    if (this._targetGrounded) this._groundedY = focusY;
    const verticalAnchor = this._targetGrounded ? focusY : this._groundedY;
    const airSlack = this._targetGrounded ? this.deadzoneY : this.deadzoneY * 2.6;

    let goalY = this._sy.value;
    const dy = verticalAnchor - this._sy.value;
    if (dy > airSlack) goalY = verticalAnchor - airSlack;
    else if (dy < -airSlack) goalY = verticalAnchor + airSlack;

    // If the player has escaped the *hard* vertical window (a long fall or a
    // high launch), follow directly regardless of the anchor.
    const hardDy = focusY - this._sy.value;
    const hardLimit = this.halfHeight * 0.62;
    if (Math.abs(hardDy) > hardLimit) {
      goalY = focusY - Math.sign(hardDy) * hardLimit;
    }

    springDamp(this._sx, goalX, this.smoothTime, dt);
    springDamp(this._sy, goalY, this.smoothTimeY, dt);

    this.x = this._sx.value;
    this.y = this._sy.value;
    this.applyBounds();

    // Feed the clamped result back into the spring, otherwise the spring keeps
    // integrating toward an unreachable target and "unwinds" when the player
    // turns away from the room edge.
    this._sx.value = this.x;
    this._sy.value = this.y;
  }

  /**
   * @param {number} dt
   * @private
   */
  _updateShake(dt) {
    this._shakeTime += dt;
    if (this.trauma > 0) {
      this.trauma = Math.max(0, this.trauma - this.traumaDecay * dt);
      const magnitude = this.trauma * this.trauma;
      // Smooth pseudo-noise: summed sines at incommensurable frequencies read as
      // random but are continuous, so the shake does not strobe between frames.
      const t = this._shakeTime * 34 + this._shakeSeed;
      this.shakeX = magnitude * this.maxShakeOffset * (Math.sin(t * 1.0) * 0.6 + Math.sin(t * 2.31) * 0.4);
      this.shakeY = magnitude * this.maxShakeOffset * (Math.sin(t * 1.37 + 2.1) * 0.6 + Math.sin(t * 3.11) * 0.4);
      this.shakeAngle = magnitude * this.maxShakeAngle * Math.sin(t * 0.83 + 1.3);
    } else {
      this.shakeX = 0;
      this.shakeY = 0;
      this.shakeAngle = 0;
    }
  }

  /** Confine the camera centre so the view stays inside `bounds`. */
  applyBounds() {
    if (!this.hasBounds) return;
    const hw = this.halfWidth;
    const hh = this.halfHeight;

    // A room narrower than the view is centred rather than clamped, otherwise
    // the clamp expression inverts and the camera pins to one edge.
    if (this.bounds.w <= hw * 2) {
      this.x = this.bounds.centerX;
    } else {
      this.x = clamp(this.x, this.bounds.x + hw, this.bounds.right - hw);
    }

    if (this.bounds.h <= hh * 2) {
      this.y = this.bounds.centerY;
    } else {
      this.y = clamp(this.y, this.bounds.y + hh, this.bounds.bottom - hh);
    }
  }

  /**
   * Final render position for this frame, including shake and pixel snapping.
   * @returns {{x: number, y: number, angle: number}}
   */
  getRenderTransform() {
    return {
      x: Math.round(this.x + this.shakeX + this.offsetX),
      y: Math.round(this.y + this.shakeY + this.offsetY),
      angle: this.shakeAngle,
    };
  }

  /**
   * World-space rectangle currently visible, expanded by a margin. Used for
   * culling: anything outside is not drawn and, for many systems, not updated.
   * @param {number} [margin]
   * @param {AABB} [out]
   * @returns {AABB}
   */
  getViewBounds(margin = 0, out = new AABB()) {
    const t = this.getRenderTransform();
    const hw = this.halfWidth + margin;
    const hh = this.halfHeight + margin;
    return out.set(t.x - hw, t.y - hh, hw * 2, hh * 2);
  }

  /**
   * @param {number} worldX @param {number} worldY
   * @returns {{x: number, y: number}} screen-space position
   */
  worldToScreen(worldX, worldY) {
    const t = this.getRenderTransform();
    return {
      x: (worldX - t.x) * this.zoom + this.viewWidth / 2,
      y: (worldY - t.y) * this.zoom + this.viewHeight / 2,
    };
  }

  /**
   * @param {number} screenX @param {number} screenY
   * @returns {{x: number, y: number}} world-space position
   */
  screenToWorld(screenX, screenY) {
    const t = this.getRenderTransform();
    return {
      x: (screenX - this.viewWidth / 2) / this.zoom + t.x,
      y: (screenY - this.viewHeight / 2) / this.zoom + t.y,
    };
  }

  /**
   * @param {AABB} box world space
   * @param {number} [margin]
   * @returns {boolean} true if the box could be visible
   */
  isVisible(box, margin = 32) {
    const t = this.getRenderTransform();
    const hw = this.halfWidth + margin;
    const hh = this.halfHeight + margin;
    return (
      box.right > t.x - hw &&
      box.x < t.x + hw &&
      box.bottom > t.y - hh &&
      box.y < t.y + hh
    );
  }
}
