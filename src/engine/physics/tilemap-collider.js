/**
 * @file Body-vs-tilemap collision resolution.
 *
 * ## Algorithm: substepped, axis-separated resolution with a slope pass
 *
 * Three approaches were on the table:
 *
 * 1. **Pure swept AABB against the grid.** Most "correct", but ordering the
 *    contacts of a box straddling six tiles is fiddly, and slopes force special
 *    cases that undo the elegance. It also makes the *feel* harder to tune.
 * 2. **Discrete move-then-depenetrate.** Simple, but tunnels at speed and
 *    produces ambiguous push-out directions in corners.
 * 3. **Substepped axis-separated resolution.** What this file implements.
 *
 * The motion for the step is split into substeps no larger than half a tile, so
 * a body can never skip past a collider regardless of speed (solving 2's
 * tunnelling without 1's complexity). Within each substep, X is moved and
 * resolved, then Y — the standard platformer ordering, which yields the
 * behaviour players expect: you slide along walls instead of sticking, and you
 * do not catch on the seams between floor tiles.
 *
 * Slopes get their own pass between X and Y. They are deliberately **not**
 * treated as blockers during the X pass; instead, after horizontal motion the
 * body is lifted to sit on the highest ramp surface beneath it. This is what
 * makes walking up a ramp feel continuous rather than like climbing stairs.
 *
 * ## Ground snapping
 * A body walking *down* a slope would otherwise leave the ground every step and
 * fall in a series of little arcs. After the Y pass, a body that was grounded
 * and is not rising probes a short distance downward and snaps to any surface it
 * finds. `snapDistance` is capped so that genuinely walking off a ledge still
 * works.
 */

import {
  isSolid, isOneWay, isRamp, isFluid, isClimbable, isHazard,
  tileSurfaceHeight, getTileDef, Tiles,
} from './tiles.js';
import { AABB } from '../math/aabb.js';
import { clamp } from '../math/math-utils.js';

/** Scratch box reused across resolution so the inner loop never allocates. */
const probeBox = new AABB();

/**
 * @typedef {Object} ResolveOptions
 * @property {number} [maxStepHeight] Largest rise a body can be lifted by a slope, px.
 * @property {number} [snapDistance] Downward ground-snap probe distance, px.
 * @property {boolean} [ignoreOneWay]
 */

/**
 * Move a body through a tilemap, resolving collisions and recording contacts.
 *
 * @param {import('./body.js').Body} body
 * @param {import('./tilemap.js').Tilemap} map
 * @param {number} dx total horizontal motion this step, px
 * @param {number} dy total vertical motion this step, px
 * @param {ResolveOptions} [options]
 */
export function moveAndCollide(body, map, dx, dy, options = {}) {
  const ts = map.tileSize;
  const maxStepHeight = options.maxStepHeight ?? ts;
  const snapDistance = options.snapDistance ?? 8;

  if (!body.collidesWithTiles) {
    body.box.x += dx;
    body.box.y += dy;
    sampleEnvironment(body, map);
    return;
  }

  // Crush must be sampled at *both* ends of the step. Checking only afterwards
  // misses a body that began the step embedded, because resolution will happily
  // eject it (a body inside a floor tile is pushed up onto that tile's surface)
  // and the post-check then sees clean space. Checking only beforehand misses
  // the opposite case, a moving platform closing on a body mid-step.
  const embeddedAtStart = isEmbedded(body, map);

  // Substep so no single move exceeds half a tile. This is what makes fast
  // bodies (dashes at ~900px/s, projectiles at 1200px/s) safe.
  const maxStep = ts * 0.5;
  const dist = Math.max(Math.abs(dx), Math.abs(dy));
  const steps = Math.max(1, Math.ceil(dist / maxStep));
  const stepX = dx / steps;
  const stepY = dy / steps;

  for (let i = 0; i < steps; i++) {
    if (stepX !== 0) resolveHorizontal(body, map, stepX);
    resolveSlope(body, map, maxStepHeight);
    if (stepY !== 0 || i === 0) resolveVertical(body, map, stepY, options.ignoreOneWay === true);
  }

  // Ground snapping, after all motion is complete.
  if (!body.grounded && body.wasGrounded && body.velocity.y >= 0 && dy >= 0) {
    snapToGround(body, map, snapDistance);
  }

  sampleEnvironment(body, map);
  body.crushed = embeddedAtStart || isEmbedded(body, map);
}

/**
 * Horizontal motion. Collides against full-height solids only; ramps are the
 * slope pass's business.
 * @param {import('./body.js').Body} body
 * @param {import('./tilemap.js').Tilemap} map
 * @param {number} dx
 */
function resolveHorizontal(body, map, dx) {
  const box = body.box;
  box.x += dx;

  const ts = map.tileSize;
  const tx0 = Math.floor(box.x / ts);
  const tx1 = Math.floor((box.right - 1e-9) / ts);
  const ty0 = Math.floor(box.y / ts);
  const ty1 = Math.floor((box.bottom - 1e-9) / ts);

  if (dx > 0) {
    // Moving right: find the leftmost blocking tile and stop against it.
    for (let tx = tx0; tx <= tx1; tx++) {
      for (let ty = ty0; ty <= ty1; ty++) {
        const id = map.get(tx, ty);
        if (!isSolid(id) || isRamp(id)) continue;
        // Only block if we actually penetrate this column.
        const tileLeft = tx * ts;
        if (box.right > tileLeft) {
          box.right = tileLeft;
          body.hitWallRight = true;
          if (body.velocity.x > 0) body.velocity.x = 0;
          return;
        }
      }
    }
  } else {
    for (let tx = tx1; tx >= tx0; tx--) {
      for (let ty = ty0; ty <= ty1; ty++) {
        const id = map.get(tx, ty);
        if (!isSolid(id) || isRamp(id)) continue;
        const tileRight = (tx + 1) * ts;
        if (box.x < tileRight) {
          box.x = tileRight;
          body.hitWallLeft = true;
          if (body.velocity.x < 0) body.velocity.x = 0;
          return;
        }
      }
    }
  }
}

/**
 * Lift the body out of any ramp it is intersecting, and record slope contact.
 *
 * @param {import('./body.js').Body} body
 * @param {import('./tilemap.js').Tilemap} map
 * @param {number} maxStepHeight
 */
function resolveSlope(body, map, maxStepHeight) {
  const box = body.box;
  const surfaceY = highestRampSurfaceUnder(map, box, box.bottom - maxStepHeight, box.bottom);
  if (surfaceY === Infinity) return;

  // Only lift if the body is at or below the ramp surface (i.e. inside it).
  if (box.bottom <= surfaceY) return;

  const rise = box.bottom - surfaceY;
  if (rise > maxStepHeight) {
    // Too steep to step up — treat the ramp as a wall this step.
    return;
  }

  const restoreY = box.y;
  box.bottom = surfaceY;
  // Refuse the lift if it would push us into a ceiling.
  if (overlapsBlockingSolid(map, box)) {
    box.y = restoreY;
    return;
  }

  body.grounded = true;
  if (body.velocity.y > 0) body.velocity.y = 0;
  recordGroundSurface(body, map, box);
}

/**
 * Vertical motion. Collides against full solids, and against one-way platforms
 * when falling onto them from above.
 * @param {import('./body.js').Body} body
 * @param {import('./tilemap.js').Tilemap} map
 * @param {number} dy
 * @param {boolean} ignoreOneWay
 */
function resolveVertical(body, map, dy, ignoreOneWay) {
  const box = body.box;
  const prevBottom = box.bottom;
  box.y += dy;

  const ts = map.tileSize;
  const tx0 = Math.floor(box.x / ts);
  const tx1 = Math.floor((box.right - 1e-9) / ts);
  const ty0 = Math.floor(box.y / ts);
  const ty1 = Math.floor((box.bottom - 1e-9) / ts);

  if (dy >= 0) {
    // Falling (or stationary): look for a floor.
    for (let ty = ty0; ty <= ty1; ty++) {
      for (let tx = tx0; tx <= tx1; tx++) {
        const id = map.get(tx, ty);
        const tileTop = ty * ts;
        let blocking = false;

        if (isSolid(id) && !isRamp(id)) {
          blocking = box.bottom > tileTop;
        } else if (isSolid(id) && isRamp(id)) {
          // Ramps: land on the ramp surface rather than the tile top.
          const surf = rampSurfaceInColumn(map, id, tx, ty, box);
          if (box.bottom > surf) {
            box.bottom = surf;
            body.grounded = true;
            if (body.velocity.y > 0) body.velocity.y = 0;
            recordGroundSurface(body, map, box);
            return;
          }
        } else if (isOneWay(id) && !ignoreOneWay && !body.dropThrough) {
          // A one-way platform only blocks if we were entirely above it before
          // this motion. The 1px tolerance absorbs floating-point drift from
          // walking along a platform's surface.
          blocking = prevBottom <= tileTop + 1 && box.bottom > tileTop;
        }

        if (blocking) {
          box.bottom = tileTop;
          body.grounded = true;
          if (body.velocity.y > 0) body.velocity.y = 0;
          recordGroundSurface(body, map, box);
          return;
        }
      }
    }
  } else {
    // Rising: look for a ceiling. One-way platforms are always passable upward.
    for (let ty = ty1; ty >= ty0; ty--) {
      for (let tx = tx0; tx <= tx1; tx++) {
        const id = map.get(tx, ty);
        if (!isSolid(id)) continue;
        const tileBottom = (ty + 1) * ts;
        // For a ramp, the underside is only solid where the surface is below
        // the tile top; approximating with the full tile is acceptable here
        // because ceiling ramps are not used as walkable surfaces.
        if (box.y < tileBottom) {
          box.y = tileBottom;
          body.hitCeiling = true;
          if (body.velocity.y < 0) body.velocity.y = 0;
          return;
        }
      }
    }
  }
}

/**
 * Probe downward for a surface and snap onto it, so walking downhill or over
 * small steps does not launch the body into the air.
 * @param {import('./body.js').Body} body
 * @param {import('./tilemap.js').Tilemap} map
 * @param {number} maxDistance
 */
function snapToGround(body, map, maxDistance) {
  const box = body.box;
  const startY = box.y;
  const ts = map.tileSize;

  // Ramp surfaces first: they are the common case for downhill walking.
  const rampY = highestRampSurfaceUnder(map, box, box.bottom, box.bottom + maxDistance);
  let bestY = rampY;

  // Then flat tile tops within the probe window.
  const tx0 = Math.floor(box.x / ts);
  const tx1 = Math.floor((box.right - 1e-9) / ts);
  const ty0 = Math.floor(box.bottom / ts);
  const ty1 = Math.floor((box.bottom + maxDistance) / ts);
  for (let ty = ty0; ty <= ty1; ty++) {
    for (let tx = tx0; tx <= tx1; tx++) {
      const id = map.get(tx, ty);
      if (isRamp(id)) continue;
      if (!isSolid(id) && !(isOneWay(id) && !body.dropThrough)) continue;
      const top = ty * ts;
      if (top >= box.bottom - 1e-6 && top < bestY) bestY = top;
    }
  }

  if (bestY === Infinity || bestY - box.bottom > maxDistance) return;

  box.bottom = bestY;
  if (overlapsBlockingSolid(map, box)) {
    box.y = startY;
    return;
  }
  body.grounded = true;
  if (body.velocity.y > 0) body.velocity.y = 0;
  recordGroundSurface(body, map, box);
}

/**
 * The highest (smallest y) ramp surface beneath a box within a vertical window.
 * @param {import('./tilemap.js').Tilemap} map
 * @param {AABB} box
 * @param {number} fromY
 * @param {number} toY
 * @returns {number} pixel y, or Infinity when there is no ramp
 */
function highestRampSurfaceUnder(map, box, fromY, toY) {
  const ts = map.tileSize;
  const tx0 = Math.floor(box.x / ts);
  const tx1 = Math.floor((box.right - 1e-9) / ts);
  const ty0 = Math.floor(fromY / ts);
  const ty1 = Math.floor(toY / ts);
  let best = Infinity;
  for (let ty = ty0; ty <= ty1; ty++) {
    for (let tx = tx0; tx <= tx1; tx++) {
      const id = map.get(tx, ty);
      if (!isSolid(id) || !isRamp(id)) continue;
      const surf = rampSurfaceInColumn(map, id, tx, ty, box);
      if (surf < best) best = surf;
    }
  }
  return best;
}

/**
 * Surface height of one ramp tile, evaluated across the portion of the box that
 * overlaps it. The *highest* point of that span is used, so the body rides the
 * uphill edge of the ramp rather than sinking into it.
 * @param {import('./tilemap.js').Tilemap} map
 * @param {number} id
 * @param {number} tx @param {number} ty
 * @param {AABB} box
 * @returns {number} pixel y of the surface
 */
function rampSurfaceInColumn(map, id, tx, ty, box) {
  const ts = map.tileSize;
  const tileLeft = tx * ts;
  const sampleL = clamp(box.x, tileLeft, tileLeft + ts);
  const sampleR = clamp(box.right, tileLeft, tileLeft + ts);
  const hL = tileSurfaceHeight(id, (sampleL - tileLeft) / ts);
  const hR = tileSurfaceHeight(id, (sampleR - tileLeft) / ts);
  const h = Math.max(hL, hR);
  return (ty + 1) * ts - h * ts;
}

/**
 * @param {import('./tilemap.js').Tilemap} map
 * @param {AABB} box
 * @returns {boolean} true if the box is inside a full solid (ramps excluded)
 */
function overlapsBlockingSolid(map, box) {
  const ts = map.tileSize;
  const tx0 = Math.floor(box.x / ts);
  const tx1 = Math.floor((box.right - 1e-9) / ts);
  const ty0 = Math.floor(box.y / ts);
  const ty1 = Math.floor((box.bottom - 1e-9) / ts);
  for (let ty = ty0; ty <= ty1; ty++) {
    for (let tx = tx0; tx <= tx1; tx++) {
      const id = map.get(tx, ty);
      if (isSolid(id) && !isRamp(id)) return true;
    }
  }
  return false;
}

/**
 * Record properties of the surface the body is standing on: friction (ice, tar),
 * conveyor velocity, slope angle, and the tile id for footstep audio.
 * @param {import('./body.js').Body} body
 * @param {import('./tilemap.js').Tilemap} map
 * @param {AABB} box
 */
function recordGroundSurface(body, map, box) {
  const ts = map.tileSize;
  // Sample just below the feet, at the body's horizontal centre.
  const probeY = box.bottom + 1;
  const tx = Math.floor(box.centerX / ts);
  const ty = Math.floor(probeY / ts);
  let id = map.get(tx, ty);

  // If the centre sample missed (e.g. standing on a ledge corner), try the edges.
  if (!isSolid(id) && !isOneWay(id)) {
    const leftId = map.get(Math.floor(box.x / ts), ty);
    const rightId = map.get(Math.floor((box.right - 1e-9) / ts), ty);
    id = isSolid(leftId) || isOneWay(leftId) ? leftId : rightId;
  }

  const def = getTileDef(id);
  body.groundTile = id;
  body.groundFriction = def.friction;
  body.groundConveyor = def.conveyor;
  if (def.slope && isRamp(id)) {
    // rise over run across one tile
    body.groundAngle = Math.atan2(-(def.slope[1] - def.slope[0]) * ts, ts);
  } else {
    body.groundAngle = 0;
  }
}

/**
 * Sample non-blocking environmental tiles overlapping the body: fluids, ladders,
 * updrafts and hazards.
 * @param {import('./body.js').Body} body
 * @param {import('./tilemap.js').Tilemap} map
 */
function sampleEnvironment(body, map) {
  const box = body.box;
  const ts = map.tileSize;
  const tx0 = Math.floor(box.x / ts);
  const tx1 = Math.floor((box.right - 1e-9) / ts);
  const ty0 = Math.floor(box.y / ts);
  const ty1 = Math.floor((box.bottom - 1e-9) / ts);

  let submergedRows = 0;
  let totalRows = 0;
  let maxDensity = 0;

  for (let ty = ty0; ty <= ty1; ty++) {
    totalRows++;
    let rowHasFluid = false;
    for (let tx = tx0; tx <= tx1; tx++) {
      const id = map.get(tx, ty);
      if (id === Tiles.EMPTY) continue;
      if (isFluid(id)) {
        rowHasFluid = true;
        const d = getTileDef(id).fluidDensity;
        if (d > maxDensity) maxDensity = d;
      }
      if (isClimbable(id)) body.onClimbable = true;
      if (id === Tiles.UPDRAFT) body.inUpdraft = true;
    }
    if (rowHasFluid) submergedRows++;
  }

  if (submergedRows > 0) {
    body.inFluid = true;
    body.fluidDensity = maxDensity;
    body.submersion = totalRows > 0 ? submergedRows / totalRows : 0;
  }
}

/**
 * Is the body's interior inside solid geometry?
 *
 * The box is shrunk by 1px first so that merely *resting against* a surface —
 * the normal state of any grounded body — is never mistaken for being crushed.
 * Reported rather than resolved, because the correct response is a game
 * decision (crush damage, or a teleport back to safe ground).
 *
 * @param {import('./body.js').Body} body
 * @param {import('./tilemap.js').Tilemap} map
 * @returns {boolean}
 */
function isEmbedded(body, map) {
  probeBox.copy(body.box).expand(-1);
  if (probeBox.w <= 0 || probeBox.h <= 0) return false;
  return overlapsBlockingSolid(map, probeBox);
}

/**
 * Query every hazard tile overlapping a box.
 * Separated from resolution so the combat system decides what damage means.
 * @param {import('./tilemap.js').Tilemap} map
 * @param {AABB} box
 * @returns {{damage: number, tileId: number, tx: number, ty: number}|null}
 */
export function queryHazard(map, box) {
  const ts = map.tileSize;
  const tx0 = Math.floor(box.x / ts);
  const tx1 = Math.floor((box.right - 1e-9) / ts);
  const ty0 = Math.floor(box.y / ts);
  const ty1 = Math.floor((box.bottom - 1e-9) / ts);
  let worst = null;
  for (let ty = ty0; ty <= ty1; ty++) {
    for (let tx = tx0; tx <= tx1; tx++) {
      const id = map.get(tx, ty);
      if (!isHazard(id)) continue;
      const dmg = getTileDef(id).damage;
      if (!worst || dmg > worst.damage) worst = { damage: dmg, tileId: id, tx, ty };
    }
  }
  return worst;
}

/**
 * Test whether a box could exist at a position without intersecting solids.
 * Used for spawn placement, teleport validation and enemy pathing.
 * @param {import('./tilemap.js').Tilemap} map
 * @param {number} x @param {number} y @param {number} w @param {number} h
 * @returns {boolean}
 */
export function isPositionFree(map, x, y, w, h) {
  probeBox.set(x, y, w, h);
  return !overlapsBlockingSolid(map, probeBox);
}

/**
 * Is there solid ground directly beneath this box?
 * Enemy AI uses this for ledge detection so walkers turn around instead of
 * walking off every platform.
 * @param {import('./tilemap.js').Tilemap} map
 * @param {number} x @param {number} y bottom edge
 * @param {number} w
 * @param {number} [probeDepth]
 * @returns {boolean}
 */
export function hasGroundBelow(map, x, y, w, probeDepth = 4) {
  probeBox.set(x, y, w, probeDepth);
  const ts = map.tileSize;
  const tx0 = Math.floor(probeBox.x / ts);
  const tx1 = Math.floor((probeBox.right - 1e-9) / ts);
  const ty0 = Math.floor(probeBox.y / ts);
  const ty1 = Math.floor((probeBox.bottom - 1e-9) / ts);
  for (let ty = ty0; ty <= ty1; ty++) {
    for (let tx = tx0; tx <= tx1; tx++) {
      const id = map.get(tx, ty);
      if (isSolid(id) || isOneWay(id)) return true;
    }
  }
  return false;
}
