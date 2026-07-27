/**
 * @file Physics tests.
 *
 * These target the failure modes that are expensive to find by playing:
 * tunnelling at speed, sticking on tile seams, slope launch, one-way platform
 * edge cases, and crush detection.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { Tilemap } from '../src/engine/physics/tilemap.js';
import { Tiles, TILE_SIZE, tileFromGlyph, tileSurfaceHeight, isRamp } from '../src/engine/physics/tiles.js';
import { Body } from '../src/engine/physics/body.js';
import { moveAndCollide, isPositionFree, hasGroundBelow, queryHazard } from '../src/engine/physics/tilemap-collider.js';
import { PhysicsWorld } from '../src/engine/physics/physics-world.js';
import { SpatialHash } from '../src/engine/math/spatial-hash.js';
import { AABB } from '../src/engine/math/aabb.js';

/**
 * Build a tilemap from an ASCII art string. Rows are separated by newlines.
 * This is the same format the room content files use, so the tests also
 * exercise the authoring path.
 * @param {string} art
 * @returns {Tilemap}
 */
function mapFromArt(art) {
  const rows = art.trim().split('\n').map((r) => r.trim());
  const h = rows.length;
  const w = Math.max(...rows.map((r) => r.length));
  const map = new Tilemap(w, h, { outOfBoundsTile: Tiles.EMPTY });
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      map.set(x, y, tileFromGlyph(rows[y][x] ?? '.'));
    }
  }
  return map;
}

test('tile definitions expose consistent slope data', () => {
  assert.equal(tileSurfaceHeight(Tiles.SOLID, 0.5), 1);
  assert.equal(tileSurfaceHeight(Tiles.SLOPE_R, 0), 0);
  assert.equal(tileSurfaceHeight(Tiles.SLOPE_R, 1), 1);
  assert.equal(tileSurfaceHeight(Tiles.SLOPE_R, 0.5), 0.5);
  assert.equal(tileSurfaceHeight(Tiles.SLOPE_L, 0), 1);
  assert.equal(tileSurfaceHeight(Tiles.EMPTY, 0.5), 0, 'non-solid tiles have no surface');
  assert.equal(isRamp(Tiles.SOLID), false);
  assert.equal(isRamp(Tiles.SLOPE_R), true);
  assert.equal(isRamp(Tiles.HALF_BLOCK), true);
});

test('a falling body lands exactly on the floor', () => {
  const map = mapFromArt(`
    ........
    ........
    ........
    ########
  `);
  const body = new Body({ x: 32, y: 0, width: 12, height: 20 });
  moveAndCollide(body, map, 0, 200);
  assert.equal(body.grounded, true);
  assert.equal(body.box.bottom, 3 * TILE_SIZE, 'feet must rest on the tile top');
  assert.equal(body.velocity.y, 0);
});

test('a very fast body does not tunnel through a one-tile floor', () => {
  const map = mapFromArt(`
    ........
    ........
    ########
    ........
  `);
  const body = new Body({ x: 32, y: 0, width: 12, height: 20 });
  body.velocity.y = 12000;
  // 12000px in a single step is far beyond any real speed; if substepping is
  // wrong this passes straight through.
  moveAndCollide(body, map, 0, 12000);
  assert.equal(body.grounded, true);
  assert.equal(body.box.bottom, 2 * TILE_SIZE);
});

test('a fast horizontal body stops at a wall', () => {
  const map = mapFromArt(`
    ....#...
    ....#...
    ########
  `);
  const body = new Body({ x: 8, y: 8, width: 12, height: 20 });
  moveAndCollide(body, map, 5000, 0);
  assert.equal(body.hitWallRight, true);
  assert.equal(body.box.right, 4 * TILE_SIZE);
});

test('walking along a flat floor does not catch on tile seams', () => {
  const map = mapFromArt(`
    ........
    ........
    ########
  `);
  const body = new Body({ x: 4, y: 0, width: 12, height: 20 });
  moveAndCollide(body, map, 0, 100); // settle on the floor
  assert.equal(body.grounded, true);
  const restY = body.box.y;
  // Walk right across several tile boundaries in small steps.
  for (let i = 0; i < 60; i++) {
    moveAndCollide(body, map, 1.7, 0.5);
    assert.equal(body.grounded, true, `left ground at step ${i}`);
    assert.equal(body.box.y, restY, `y drifted at step ${i}`);
    assert.equal(body.hitWallRight, false, `snagged a seam at step ${i}`);
  }
});

test('a 45-degree ramp lifts the body smoothly as it walks up', () => {
  //  ramp rises to the right across two tiles
  const map = mapFromArt(`
    ........
    ......./
    ....../#
    ########
  `);
  const body = new Body({ x: 16, y: 0, width: 12, height: 20 });
  moveAndCollide(body, map, 0, 100);
  const flatY = body.box.bottom;
  let prevBottom = flatY;
  let rose = false;
  for (let i = 0; i < 80; i++) {
    moveAndCollide(body, map, 1.5, 1);
    assert.equal(body.grounded, true, `left the ramp at step ${i}`);
    if (body.box.bottom < prevBottom - 0.001) rose = true;
    // The rise per 1.5px of travel on a 45-degree ramp must never exceed
    // the horizontal travel by a meaningful margin.
    assert.ok(prevBottom - body.box.bottom <= 2.5, `jumped ${prevBottom - body.box.bottom}px at step ${i}`);
    prevBottom = body.box.bottom;
  }
  assert.ok(rose, 'body never climbed the ramp');
  assert.ok(body.box.bottom < flatY, 'body ended no higher than it started');
});

test('walking down a slope keeps the body grounded (no launch)', () => {
  const map = mapFromArt(`
    ........
    \\.......
    #\\......
    ########
  `);
  const body = new Body({ x: 4, y: 0, width: 12, height: 20 });
  moveAndCollide(body, map, 0, 60);
  assert.equal(body.grounded, true);
  let airborneSteps = 0;
  for (let i = 0; i < 60; i++) {
    body.velocity.y = 0;
    moveAndCollide(body, map, 2, 0);
    if (!body.grounded) airborneSteps++;
  }
  assert.equal(airborneSteps, 0, 'body left the ground while walking downhill');
});

test('one-way platforms block from above and pass from below', () => {
  const map = mapFromArt(`
    ........
    --------
    ........
    ########
  `);
  // Falling from above: blocked.
  const falling = new Body({ x: 32, y: 0, width: 12, height: 12 });
  moveAndCollide(falling, map, 0, 40);
  assert.equal(falling.grounded, true);
  assert.equal(falling.box.bottom, TILE_SIZE);

  // Rising from below: passes through.
  const rising = new Body({ x: 32, y: 40, width: 12, height: 12 });
  moveAndCollide(rising, map, 0, -36);
  assert.equal(rising.hitCeiling, false);
  assert.ok(rising.box.y < TILE_SIZE, 'should have risen past the platform');
});

test('dropThrough lets a body fall through a one-way platform', () => {
  const map = mapFromArt(`
    ........
    --------
    ........
    ########
  `);
  const body = new Body({ x: 32, y: 0, width: 12, height: 12 });
  moveAndCollide(body, map, 0, 40);
  assert.equal(body.grounded, true);

  body.dropThrough = true;
  body.wasGrounded = false; // suppress ground-snap, as the controller does
  body.grounded = false;
  moveAndCollide(body, map, 0, 20);
  assert.ok(body.box.y > TILE_SIZE, `expected to drop through, y=${body.box.y}`);
});

test('a rising body stops at a ceiling', () => {
  const map = mapFromArt(`
    ########
    ........
    ........
    ########
  `);
  const body = new Body({ x: 32, y: 40, width: 12, height: 16 });
  moveAndCollide(body, map, 0, -40);
  assert.equal(body.hitCeiling, true);
  assert.equal(body.box.y, TILE_SIZE);
});

test('crush is detected when a body is inside geometry', () => {
  const map = mapFromArt(`
    ####
    ####
    ####
  `);
  const body = new Body({ x: 8, y: 8, width: 12, height: 12 });
  moveAndCollide(body, map, 0, 0);
  assert.equal(body.crushed, true);
});

test('fluid submersion is measured and reported', () => {
  const map = mapFromArt(`
    ........
    ~~~~~~~~
    ~~~~~~~~
    ########
  `);
  const body = new Body({ x: 32, y: TILE_SIZE, width: 12, height: TILE_SIZE * 2 });
  moveAndCollide(body, map, 0, 0);
  assert.equal(body.inFluid, true);
  assert.ok(body.submersion > 0.9, `submersion=${body.submersion}`);
  assert.equal(body.fluidDensity, 1);
});

test('ladders are detected but do not block movement', () => {
  const map = mapFromArt(`
    ...H....
    ...H....
    ########
  `);
  const body = new Body({ x: TILE_SIZE * 3, y: 0, width: 12, height: 12 });
  moveAndCollide(body, map, 0, 10);
  assert.equal(body.onClimbable, true);
  assert.equal(body.grounded, false);
});

test('hazard query reports the worst overlapping hazard', () => {
  const map = mapFromArt(`
    ........
    ..^..X..
    ########
  `);
  const box = new AABB(TILE_SIZE * 2, TILE_SIZE, TILE_SIZE * 4, TILE_SIZE);
  const hit = queryHazard(map, box);
  assert.ok(hit);
  assert.equal(hit.damage, 2, 'should report the heavy spike, not the light one');
  assert.equal(queryHazard(map, new AABB(0, 0, 8, 8)), null);
});

test('ground probes support ledge detection', () => {
  const map = mapFromArt(`
    ........
    ........
    ####....
  `);
  assert.equal(hasGroundBelow(map, 0, TILE_SIZE * 2, 12), true);
  assert.equal(hasGroundBelow(map, TILE_SIZE * 6, TILE_SIZE * 2, 12), false);
  assert.equal(isPositionFree(map, 0, 0, 12, 12), true);
  assert.equal(isPositionFree(map, 0, TILE_SIZE * 2, 12, 12), false);
});

test('line of sight is blocked by opaque tiles', () => {
  const map = mapFromArt(`
    ........
    ...#....
    ........
  `);
  const y = TILE_SIZE * 1.5;
  assert.equal(map.hasLineOfSight(4, y, TILE_SIZE * 7, y), false, 'wall should block');
  const clearY = TILE_SIZE * 2.5;
  assert.equal(map.hasLineOfSight(4, clearY, TILE_SIZE * 7, clearY), true);
});

test('out-of-bounds reads default to solid so bodies cannot escape', () => {
  const map = new Tilemap(4, 4);
  assert.equal(map.get(-1, 0), Tiles.SOLID);
  assert.equal(map.get(0, 99), Tiles.SOLID);
  const body = new Body({ x: 8, y: 8, width: 8, height: 8 });
  moveAndCollide(body, map, -500, 0);
  assert.ok(body.box.x >= 0, `escaped left: ${body.box.x}`);
});

test('PhysicsWorld integrates gravity to a resting state', () => {
  const map = mapFromArt(`
    ........
    ........
    ........
    ########
  `);
  const world = new PhysicsWorld();
  world.setMap(map);
  const body = new Body({ x: 32, y: 0, width: 12, height: 16 });
  world.add(body);
  for (let i = 0; i < 120; i++) world.step(1 / 60);
  assert.equal(body.grounded, true);
  assert.equal(body.box.bottom, TILE_SIZE * 3);
  assert.equal(body.velocity.y, 0);
});

test('terminal velocity is respected', () => {
  const map = new Tilemap(4, 200, { outOfBoundsTile: Tiles.EMPTY });
  const world = new PhysicsWorld();
  world.setMap(map);
  const body = new Body({ x: 8, y: 0, width: 8, height: 8 });
  body.maxFallSpeed = 400;
  world.add(body);
  for (let i = 0; i < 300; i++) world.step(1 / 60);
  assert.ok(body.velocity.y <= 400.0001, `fell at ${body.velocity.y}`);
});

test('PhysicsWorld overlap queries filter by layer mask', () => {
  const world = new PhysicsWorld();
  const a = new Body({ x: 0, y: 0, width: 16, height: 16, layer: 1 });
  const b = new Body({ x: 8, y: 8, width: 16, height: 16, layer: 2 });
  world.add(a);
  world.add(b);
  world.rebuildHash();
  const hits = world.queryOverlaps(new AABB(0, 0, 32, 32), 2);
  assert.equal(hits.length, 1);
  assert.equal(hits[0], b);
});

test('SpatialHash deduplicates items spanning several cells', () => {
  const hash = new SpatialHash(16);
  const item = { id: 'big' };
  hash.insert(item, 0, 0, 64, 64); // spans many cells
  const out = hash.query(0, 0, 64, 64);
  assert.equal(out.length, 1);
});

test('SpatialHash handles negative coordinates without aliasing', () => {
  const hash = new SpatialHash(16);
  const a = { id: 'a' };
  const b = { id: 'b' };
  hash.insert(a, -100, -100, 8, 8);
  hash.insert(b, 100, 100, 8, 8);
  assert.deepEqual(hash.query(-100, -100, 8, 8), [a]);
  assert.deepEqual(hash.query(100, 100, 8, 8), [b]);
});

test('Tilemap authoring helpers work', () => {
  const map = new Tilemap(10, 10, { outOfBoundsTile: Tiles.EMPTY });
  map.fillRect(2, 2, 3, 3, Tiles.SOLID);
  assert.equal(map.count(Tiles.SOLID), 9);
  assert.equal(map.get(2, 2), Tiles.SOLID);
  assert.equal(map.get(5, 5), Tiles.EMPTY);
  map.replaceAll(Tiles.SOLID, Tiles.ICE);
  assert.equal(map.count(Tiles.ICE), 9);
  const clone = map.clone();
  clone.set(0, 0, Tiles.SOLID);
  assert.equal(map.get(0, 0), Tiles.EMPTY, 'clone must be deep');
});
