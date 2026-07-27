/**
 * @file Tests for math primitives and swept collision.
 *
 * The sweep tests are the important ones here: swept AABB is the single piece of
 * geometry in the engine where an off-by-one sign error produces bugs that are
 * hard to see (occasional tunnelling at speed) rather than obvious ones.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { Vec2 } from '../src/engine/math/vec2.js';
import { AABB, sweepAABB, rayAABB } from '../src/engine/math/aabb.js';
import { clamp, lerp, damp, moveToward, angleDelta, mod, remap, springDamp } from '../src/engine/math/math-utils.js';
import { Rng, fbm2D } from '../src/engine/core/rng.js';

test('clamp / lerp / remap basics', () => {
  assert.equal(clamp(5, 0, 3), 3);
  assert.equal(clamp(-5, 0, 3), 0);
  assert.equal(clamp(1, 0, 3), 1);
  assert.equal(lerp(0, 10, 0.25), 2.5);
  assert.equal(remap(5, 0, 10, 0, 100), 50);
  // remap clamps its input range
  assert.equal(remap(50, 0, 10, 0, 100), 100);
});

test('mod returns non-negative for negative inputs', () => {
  assert.equal(mod(-1, 4), 3);
  assert.equal(mod(5, 4), 1);
  assert.equal(mod(-8, 4), 0);
});

test('moveToward reaches the target exactly', () => {
  assert.equal(moveToward(0, 10, 3), 3);
  assert.equal(moveToward(9, 10, 3), 10);
  assert.equal(moveToward(10, 0, 3), 7);
});

test('damp is frame-rate independent', () => {
  // Two half-steps must land within floating-point noise of one full step.
  const oneStep = damp(0, 100, 8, 1 / 60);
  let twoHalf = damp(0, 100, 8, 1 / 120);
  twoHalf = damp(twoHalf, 100, 8, 1 / 120);
  assert.ok(Math.abs(oneStep - twoHalf) < 1e-9, `${oneStep} vs ${twoHalf}`);
});

test('springDamp converges without overshooting', () => {
  const state = { value: 0, velocity: 0 };
  let maxSeen = 0;
  for (let i = 0; i < 200; i++) {
    springDamp(state, 100, 0.2, 1 / 60);
    maxSeen = Math.max(maxSeen, state.value);
  }
  assert.ok(state.value > 99.9, `did not converge: ${state.value}`);
  assert.ok(maxSeen <= 100.0001, `overshot to ${maxSeen}`);
});

test('angleDelta takes the short way round', () => {
  assert.ok(Math.abs(angleDelta(0.1, -0.1) - -0.2) < 1e-9);
  // 350deg -> 10deg should be +20deg, not -340deg
  const d = angleDelta((350 * Math.PI) / 180, (10 * Math.PI) / 180);
  assert.ok(Math.abs(d - (20 * Math.PI) / 180) < 1e-9, String(d));
});

test('Vec2 arithmetic and in-place aliasing safety', () => {
  const a = new Vec2(3, 4);
  assert.equal(a.length(), 5);
  assert.equal(a.lengthSq(), 25);

  // Aliasing: adding a vector to itself must double it, not corrupt mid-way.
  const b = new Vec2(2, 3);
  b.addInPlace(b);
  assert.deepEqual({ x: b.x, y: b.y }, { x: 4, y: 6 });

  const c = new Vec2(10, 0);
  c.rotateInPlace(Math.PI / 2);
  assert.ok(Math.abs(c.x) < 1e-9 && Math.abs(c.y - 10) < 1e-9, c.toString());

  const d = new Vec2(6, 8).limitInPlace(5);
  assert.ok(Math.abs(d.length() - 5) < 1e-9);
});

test('Vec2.cross gives side-of-line sign', () => {
  const forward = new Vec2(1, 0);
  assert.ok(forward.cross(new Vec2(0, 1)) > 0);
  assert.ok(forward.cross(new Vec2(0, -1)) < 0);
});

test('AABB overlap excludes exact edge touching', () => {
  const a = new AABB(0, 0, 10, 10);
  const b = new AABB(10, 0, 10, 10);
  assert.equal(a.intersects(b), false, 'abutting boxes must not count as overlapping');
  b.x = 9.99;
  assert.equal(a.intersects(b), true);
});

test('AABB penetration resolves on the shallow axis', () => {
  const a = new AABB(0, 0, 10, 10);
  // Overlaps 2px horizontally, 8px vertically -> should push out on X.
  const b = new AABB(8, 2, 10, 10);
  const pen = a.getPenetration(b);
  assert.ok(pen);
  assert.equal(pen.y, 0);
  assert.equal(pen.x, -2);
});

test('sweepAABB stops a fast mover at a thin wall (no tunnelling)', () => {
  const mover = new AABB(0, 0, 8, 8);
  const wall = new AABB(100, 0, 4, 8); // 4px thin wall
  const r = sweepAABB(mover, 400, 0, wall); // would travel far past it
  assert.equal(r.hit, true);
  assert.equal(r.normalX, -1);
  assert.ok(Math.abs(r.x - 92) < 1e-9, `contact x=${r.x}`);
  assert.ok(r.time > 0 && r.time < 1);
});

test('sweepAABB reports a floor contact when falling', () => {
  const mover = new AABB(0, 0, 8, 8);
  const floor = new AABB(-50, 32, 100, 8);
  const r = sweepAABB(mover, 0, 100, floor);
  assert.equal(r.hit, true);
  assert.equal(r.normalY, -1);
  assert.equal(r.normalX, 0);
  assert.ok(Math.abs(r.y - 24) < 1e-9, `contact y=${r.y}`);
});

test('sweepAABB misses when passing alongside', () => {
  const mover = new AABB(0, 0, 8, 8);
  const wall = new AABB(100, 100, 8, 8);
  const r = sweepAABB(mover, 400, 0, wall);
  assert.equal(r.hit, false);
  assert.equal(r.time, 1);
});

test('sweepAABB detects pre-existing overlap at time 0', () => {
  const mover = new AABB(0, 0, 8, 8);
  const wall = new AABB(4, 4, 8, 8);
  const r = sweepAABB(mover, 1, 0, wall);
  assert.equal(r.hit, true);
  assert.equal(r.time, 0);
});

test('sweepAABB with zero motion only hits on overlap', () => {
  const mover = new AABB(0, 0, 8, 8);
  assert.equal(sweepAABB(mover, 0, 0, new AABB(50, 50, 8, 8)).hit, false);
  assert.equal(sweepAABB(mover, 0, 0, new AABB(4, 4, 8, 8)).hit, true);
});

test('rayAABB hits and misses correctly', () => {
  const box = new AABB(10, -5, 10, 10);
  assert.ok(rayAABB(0, 0, 100, 0, box, 1) > 0);
  assert.equal(rayAABB(0, 100, 100, 0, box, 1), -1);
  // Origin inside the box returns 0.
  assert.equal(rayAABB(12, 0, 100, 0, box, 1), 0);
});

test('Rng is deterministic and reproducible from a string seed', () => {
  const a = new Rng('aetherweir');
  const b = new Rng('aetherweir');
  const seqA = Array.from({ length: 20 }, () => a.next());
  const seqB = Array.from({ length: 20 }, () => b.next());
  assert.deepEqual(seqA, seqB);
  assert.notDeepEqual(seqA, Array.from({ length: 20 }, () => new Rng('other').next()));
});

test('Rng output stays in range', () => {
  const rng = new Rng(1234);
  for (let i = 0; i < 5000; i++) {
    const v = rng.next();
    assert.ok(v >= 0 && v < 1);
    const n = rng.int(3, 7);
    assert.ok(n >= 3 && n <= 7 && Number.isInteger(n));
  }
});

test('Rng state save/restore reproduces the sequence', () => {
  const rng = new Rng('save-test');
  rng.next();
  rng.next();
  const state = rng.getState();
  const after = [rng.next(), rng.next(), rng.next()];
  rng.setState(state);
  assert.deepEqual([rng.next(), rng.next(), rng.next()], after);
});

test('Rng.fork produces an independent stream', () => {
  const parent = new Rng('world');
  const childA = parent.fork('layout');
  const parent2 = new Rng('world');
  const childB = parent2.fork('layout');
  assert.equal(childA.next(), childB.next(), 'forks must be reproducible');
});

test('Rng.pickWeighted respects zero weights', () => {
  const rng = new Rng(7);
  for (let i = 0; i < 200; i++) {
    assert.equal(rng.pickWeighted(['a', 'b'], [0, 1]), 'b');
  }
});

test('fbm2D is deterministic and bounded', () => {
  for (let i = 0; i < 100; i++) {
    const v = fbm2D(i * 0.37, i * 0.11, 4, 99);
    assert.ok(v >= -1.001 && v <= 1.001, String(v));
    assert.equal(v, fbm2D(i * 0.37, i * 0.11, 4, 99));
  }
});
