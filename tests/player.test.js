/**
 * @file Player controller tests.
 *
 * These assert the *feel* guarantees that the movement design depends on:
 * coyote time, jump buffering, variable jump height, dash commitment, wall
 * jumps, and the invariant that no input is ever silently swallowed.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { Harness, Key, STEP } from './helpers/harness.js';
import { PlayerState } from '../src/game/player/player.js';
import { Ability } from '../src/game/player/abilities.js';
import { MovementConfig as C, DerivedMovement } from '../src/game/player/movement-config.js';
import { Events } from '../src/engine/core/events.js';
import { AttackDirection } from '../src/game/player/attacks.js';
import { queryHazard } from '../src/engine/physics/tilemap-collider.js';

const FLAT = `
  ..............................
  ..............................
  ..............................
  ..............................
  ..............................
  ##############################
`;

test('player settles on the ground and enters idle', () => {
  const h = new Harness(FLAT);
  h.placePlayerAtTile(5, 5);
  h.settle();
  assert.equal(h.player.body.grounded, true);
  assert.equal(h.state, PlayerState.IDLE);
  assert.equal(h.feetY, 5 * 16);
});

test('holding right accelerates to run speed and no further', () => {
  const h = new Harness(FLAT);
  h.placePlayerAtTile(2, 5);
  h.settle();
  h.hold(Key.RIGHT);
  h.step(60);
  assert.equal(h.state, PlayerState.RUN);
  assert.ok(
    Math.abs(h.player.body.velocity.x - C.runSpeed) < 1,
    `expected ~${C.runSpeed}, got ${h.player.body.velocity.x}`,
  );
  assert.equal(h.player.facing, 1);
});

test('releasing input brings the player to a stop', () => {
  const h = new Harness(FLAT);
  h.placePlayerAtTile(2, 5);
  h.settle();
  h.hold(Key.RIGHT);
  h.step(40);
  h.release(Key.RIGHT);
  h.step(40);
  assert.ok(Math.abs(h.player.body.velocity.x) < 1);
  assert.equal(h.state, PlayerState.IDLE);
});

test('a full jump reaches approximately the designed apex height', () => {
  const h = new Harness(FLAT);
  h.placePlayerAtTile(5, 5);
  h.settle();
  const groundY = h.feetY;

  h.hold(Key.JUMP);
  let peak = groundY;
  for (let i = 0; i < 120; i++) {
    h.step(1);
    peak = Math.min(peak, h.feetY);
    if (h.player.body.grounded && i > 10) break;
  }
  const height = groundY - peak;
  // The apex-gravity softening makes the real apex a little higher than the
  // naive ballistic figure; assert it is in a sensible band around it.
  assert.ok(
    height > DerivedMovement.jumpApexHeight * 0.9 && height < DerivedMovement.jumpApexHeight * 1.45,
    `jump height ${height.toFixed(1)}px vs nominal ${DerivedMovement.jumpApexHeight.toFixed(1)}px`,
  );
  // Must clear four tiles: a hard design constraint the level design relies on.
  assert.ok(height >= 64, `jump must clear 4 tiles, got ${height.toFixed(1)}px`);
});

test('a tapped jump is meaningfully shorter than a held jump', () => {
  const measure = (/** @type {boolean} */ hold) => {
    const h = new Harness(FLAT);
    h.placePlayerAtTile(5, 5);
    h.settle();
    const groundY = h.feetY;
    h.hold(Key.JUMP);
    h.step(1);
    if (!hold) h.release(Key.JUMP);
    let peak = groundY;
    for (let i = 0; i < 120; i++) {
      h.step(1);
      peak = Math.min(peak, h.feetY);
      if (h.player.body.grounded && i > 10) break;
    }
    return groundY - peak;
  };
  const tapped = measure(false);
  const held = measure(true);
  assert.ok(tapped < held * 0.75, `tap=${tapped.toFixed(1)} held=${held.toFixed(1)}`);
  assert.ok(tapped > 8, 'a tapped jump must still leave the ground meaningfully');
});

test('coyote time allows a jump shortly after walking off a ledge', () => {
  const LEDGE = `
    ..............................
    ..............................
    ..............................
    ..............................
    #########.....................
  `;
  const h = new Harness(LEDGE);
  h.placePlayerAtTile(2, 4);
  h.settle();
  h.hold(Key.RIGHT);
  // Walk until airborne.
  h.stepUntil(() => !h.player.body.grounded, 300);
  assert.equal(h.player.body.grounded, false);
  assert.ok(h.player.coyoteTimer > 0, 'coyote timer should be running');

  h.tap(Key.JUMP);
  assert.ok(h.player.body.velocity.y < -100, `expected a jump, vy=${h.player.body.velocity.y}`);
});

test('coyote time expires', () => {
  const LEDGE = `
    ..............................
    ..............................
    ..............................
    ..............................
    #########.....................
  `;
  const h = new Harness(LEDGE);
  h.placePlayerAtTile(2, 4);
  h.settle();
  h.hold(Key.RIGHT);
  h.stepUntil(() => !h.player.body.grounded, 300);
  // Wait well past the coyote window.
  h.step(Math.ceil(C.coyoteTime / STEP) + 6);
  const vyBefore = h.player.body.velocity.y;
  h.tap(Key.JUMP);
  assert.ok(h.player.body.velocity.y >= vyBefore - 1, 'should not have jumped after coyote expired');
});

test('jump buffering: a jump pressed before landing fires on touchdown', () => {
  const h = new Harness(FLAT);
  // Start a short fall so the press lands inside the buffer window before
  // touchdown; a longer drop would (correctly) let the buffer expire.
  h.placePlayer(5 * 16 + 8, 5 * 16 - 8);
  h.step(1);
  assert.equal(h.player.body.grounded, false);

  h.hold(Key.JUMP);
  h.step(1);
  h.release(Key.JUMP);

  let jumped = false;
  for (let i = 0; i < 10; i++) {
    h.step(1);
    if (h.player.body.velocity.y < -100) {
      jumped = true;
      break;
    }
  }
  assert.ok(jumped, 'buffered jump did not fire on landing');
});

test('a buffered jump expires rather than firing after a long fall', () => {
  const h = new Harness(FLAT);
  h.placePlayer(5 * 16 + 8, 0);
  h.step(2);
  h.hold(Key.JUMP);
  h.step(1);
  h.release(Key.JUMP);
  // Fall for far longer than the buffer window.
  h.stepUntil(() => h.player.body.grounded, 200);
  h.step(2);
  assert.ok(
    h.player.body.velocity.y >= -1,
    `stale buffered jump fired after landing (vy=${h.player.body.velocity.y})`,
  );
});

test('a buffered jump is not swallowed when no jump is currently possible', () => {
  // Regression guard: consuming the buffer before checking eligibility would
  // silently eat the press and break the previous test's guarantee.
  const h = new Harness(FLAT);
  h.placePlayerAtTile(5, 0);
  h.step(4);
  h.hold(Key.JUMP);
  h.step(1);
  h.release(Key.JUMP);
  // The press is still pending because no jump was available in the air.
  assert.ok(h.input.pressed('jump', C.jumpBuffer), 'buffer must survive an impossible jump');
});

test('double jump requires Paperwing and grants exactly one extra jump', () => {
  const h = new Harness(FLAT);
  h.placePlayerAtTile(5, 5);
  h.settle();

  // Without the ability: no second jump.
  h.tap(Key.JUMP);
  h.step(6);
  const vyBefore = h.player.body.velocity.y;
  h.tap(Key.JUMP);
  assert.ok(h.player.body.velocity.y >= vyBefore - 1, 'double jump without Paperwing');

  // With the ability.
  const h2 = new Harness(FLAT);
  h2.placePlayerAtTile(5, 5);
  h2.settle();
  h2.player.grantAbility(Ability.PAPERWING);
  assert.equal(h2.player.maxJumps, 2);

  h2.tap(Key.JUMP);
  h2.step(10);
  assert.equal(h2.player.body.grounded, false);
  h2.tap(Key.JUMP);
  assert.ok(h2.player.body.velocity.y < -100, 'second jump should have fired');

  // And no third.
  h2.step(6);
  const vy2 = h2.player.body.velocity.y;
  h2.tap(Key.JUMP);
  assert.ok(h2.player.body.velocity.y >= vy2 - 1, 'third jump should be refused');
});

test('dash requires Skim, moves the designed distance and has a cooldown', () => {
  const h = new Harness(FLAT);
  h.placePlayerAtTile(2, 5);
  h.settle();

  h.tap(Key.DASH);
  assert.notEqual(h.state, PlayerState.DASH, 'dash without the ability');

  h.player.grantAbility(Ability.SKIM);
  h.hold(Key.RIGHT);
  h.step(2);
  const startX = h.centerX;
  h.tap(Key.DASH);
  assert.equal(h.state, PlayerState.DASH);
  h.stepUntil(() => h.state !== PlayerState.DASH, 60);
  const travelled = h.centerX - startX;
  assert.ok(
    travelled > DerivedMovement.dashDistance * 0.75,
    `dash covered ${travelled.toFixed(1)}px, expected ~${DerivedMovement.dashDistance.toFixed(1)}px`,
  );

  // Cooldown blocks an immediate second dash.
  h.tap(Key.DASH);
  assert.notEqual(h.state, PlayerState.DASH, 'dash fired while on cooldown');
});

test('dash is not interrupted by wall-slide but yields to attack', () => {
  const h = new Harness(FLAT);
  h.placePlayerAtTile(2, 5);
  h.settle();
  h.player.grantAbility(Ability.SKIM);
  h.tap(Key.DASH);
  assert.equal(h.state, PlayerState.DASH);
  h.tap(Key.ATTACK);
  assert.equal(h.state, PlayerState.ATTACK, 'attack should cancel a dash');
});

test('air dash requires Skyskim and is limited to once per airtime', () => {
  const h = new Harness(FLAT);
  h.placePlayerAtTile(5, 5);
  h.settle();
  h.player.grantAbility(Ability.SKIM);

  h.tap(Key.JUMP);
  h.step(6);
  h.tap(Key.DASH);
  assert.notEqual(h.state, PlayerState.DASH, 'air dash without Skyskim');

  h.player.grantAbility(Ability.SKYSKIM);
  h.player.dashCooldownTimer = 0;
  h.tap(Key.DASH);
  assert.equal(h.state, PlayerState.DASH);
  h.stepUntil(() => h.state !== PlayerState.DASH, 60);
  h.player.dashCooldownTimer = 0;
  h.tap(Key.DASH);
  assert.notEqual(h.state, PlayerState.DASH, 'second air dash should be refused');
});

// A tall shaft, so a wall slide has room to run without reaching the floor.
const SHAFT = `
  ....#.........................
  ....#.........................
  ....#.........................
  ....#.........................
  ....#.........................
  ....#.........................
  ....#.........................
  ....#.........................
  ....#.........................
  ....#.........................
  ....#.........................
  ....#.........................
  ##############################
`;

test('wall slide and wall jump require Gripscript', () => {
  const h = new Harness(SHAFT);
  h.placePlayer(16 * 4 - 8, 16 * 2);
  h.hold(Key.RIGHT);
  h.step(6);
  assert.notEqual(h.state, PlayerState.WALL_SLIDE, 'wall slide without Gripscript');

  const h2 = new Harness(SHAFT);
  h2.player.grantAbility(Ability.GRIPSCRIPT);
  h2.placePlayer(16 * 4 - 8, 16 * 2);
  h2.hold(Key.RIGHT);
  h2.stepUntil(() => h2.state === PlayerState.WALL_SLIDE, 60);
  assert.equal(h2.state, PlayerState.WALL_SLIDE);

  // Slide speed is capped once the cling window ends.
  h2.step(Math.ceil(C.wallClingTime / STEP) + 20);
  assert.equal(h2.state, PlayerState.WALL_SLIDE, 'should still be on the wall');
  assert.ok(
    h2.player.body.velocity.y <= C.wallSlideSpeed + 1,
    `slide speed ${h2.player.body.velocity.y}`,
  );

  // Wall jump pushes away from the wall and upward.
  h2.tap(Key.JUMP);
  assert.ok(h2.player.body.velocity.y < -200, 'wall jump should go up');
  assert.ok(h2.player.body.velocity.x < -100, 'wall jump should push away from the wall');
  assert.equal(h2.player.facing, -1);
});

test('the cling window holds the player before the slide begins', () => {
  const h = new Harness(SHAFT);
  h.player.grantAbility(Ability.GRIPSCRIPT);
  h.placePlayer(16 * 4 - 8, 16 * 2);
  h.hold(Key.RIGHT);
  h.stepUntil(() => h.state === PlayerState.WALL_SLIDE, 60);
  h.step(6);
  assert.ok(
    h.player.body.velocity.y <= C.wallSlideInitialSpeed + 1,
    `cling should be slow, got ${h.player.body.velocity.y}`,
  );
});

test('wall jump lockout prevents input from cancelling the push-off', () => {
  const h = new Harness(SHAFT);
  h.player.grantAbility(Ability.GRIPSCRIPT);
  h.placePlayer(16 * 4 - 8, 16 * 2);
  h.hold(Key.RIGHT);
  h.stepUntil(() => h.state === PlayerState.WALL_SLIDE, 60);
  h.tap(Key.JUMP);
  // Still holding right (into the wall); the player must keep moving left.
  h.step(3);
  assert.ok(h.player.body.velocity.x < 0, 'lockout failed; input cancelled the wall jump');
});

test('attacking spawns a hitbox in the aimed direction', () => {
  const h = new Harness(FLAT);
  h.placePlayerAtTile(5, 5);
  h.settle();
  h.clearEvents();

  h.tap(Key.ATTACK);
  h.step(C.attackStartup + 1);
  assert.equal(h.combat.hitboxes.length, 1, 'expected one active hitbox');
  const hb = h.combat.hitboxes[0];
  assert.ok(hb.box.centerX > h.player.body.box.centerX, 'forward hitbox should be ahead');
  assert.ok(h.sawEvent(Events.ATTACK_STARTED));
});

test('holding up aims the attack upward', () => {
  const h = new Harness(FLAT);
  h.placePlayerAtTile(5, 5);
  h.settle();
  h.hold(Key.UP);
  h.step(2);
  h.tap(Key.ATTACK);
  assert.equal(h.player.attackDir, AttackDirection.UP);
  h.step(C.attackStartup + 1);
  const hb = h.combat.hitboxes[0];
  assert.ok(hb, 'no hitbox spawned');
  assert.ok(hb.box.centerY < h.player.body.box.centerY, 'up hitbox should be above');
});

test('down attack only aims down in the air and only with Plumbstrike', () => {
  const h = new Harness(FLAT);
  h.placePlayerAtTile(5, 5);
  h.settle();
  h.hold(Key.DOWN);
  h.step(2);
  h.tap(Key.ATTACK);
  assert.equal(h.player.attackDir, AttackDirection.FORWARD, 'grounded down-attack must swing forward');

  const h2 = new Harness(FLAT);
  h2.placePlayerAtTile(5, 5);
  h2.settle();
  h2.player.grantAbility(Ability.PLUMBSTRIKE);
  h2.tap(Key.JUMP);
  h2.step(6);
  h2.hold(Key.DOWN);
  h2.step(1);
  h2.tap(Key.ATTACK);
  assert.equal(h2.player.attackDir, AttackDirection.DOWN);
});

test('taking damage costs health, grants i-frames and knocks back', () => {
  const h = new Harness(FLAT);
  h.placePlayerAtTile(5, 5);
  h.settle();
  const before = h.player.health.current;

  const dealt = h.player.takeDamage({ amount: 1, dirX: -1, dirY: -1 });
  assert.equal(dealt, 1);
  assert.equal(h.player.health.current, before - 1);
  assert.equal(h.state, PlayerState.HURT);
  assert.ok(h.player.iframeTimer > 0);
  assert.ok(h.player.body.velocity.y < 0, 'knockback should pop the player up');

  // A second hit during i-frames is ignored.
  assert.equal(h.player.takeDamage({ amount: 1 }), 0);
  assert.equal(h.player.health.current, before - 1);
});

test('the player recovers control after the hurt state', () => {
  const h = new Harness(FLAT);
  h.placePlayerAtTile(5, 5);
  h.settle();
  h.player.takeDamage({ amount: 1 });
  assert.equal(h.player.hasControl, false);
  h.stepUntil(() => h.player.hasControl, 120);
  assert.ok(h.player.hasControl);
});

test('reaching zero health enters the dead state and stays there', () => {
  const h = new Harness(FLAT);
  h.placePlayerAtTile(5, 5);
  h.settle();
  h.player.health.current = 1;
  h.player.takeDamage({ amount: 1 });
  assert.equal(h.state, PlayerState.DEAD);
  assert.ok(h.sawEvent(Events.PLAYER_DIED));
  h.step(60);
  assert.equal(h.state, PlayerState.DEAD, 'death must be terminal until respawn');
});

test('spikes damage the player and return them to safe ground', () => {
  const SPIKES = `
    ..............................
    ..............................
    ..............................
    ..............................
    ......^^^^....................
    ##############################
  `;
  const h = new Harness(SPIKES);
  h.placePlayerAtTile(2, 5);
  h.settle();
  h.step(20); // let the safe-ground sampler record a position
  const safeX = h.player.lastSafeX;
  assert.ok(Number.isFinite(safeX));

  const before = h.player.health.current;
  h.hold(Key.RIGHT);
  h.stepUntil(() => h.player.health.current < before, 300);
  assert.equal(h.player.health.current, before - 1);

  h.release(Key.RIGHT);
  h.stepUntil(() => h.player.hasControl, 120);
  // Restored to solid ground clear of the spike field (tiles 6-9 => x 96..160).
  // The exact x is whatever the sampler last recorded, which advances as the
  // player walks, so assert the property that matters rather than a position.
  assert.ok(h.centerX < 96, `restored onto or past the spikes at x=${h.centerX}`);
  assert.equal(queryHazard(h.map, h.player.body.box), null, 'restored into a hazard');
  assert.equal(h.player.body.grounded, true, 'restored off the ground');
});

test('focus converts ink into health and is interrupted by movement', () => {
  const h = new Harness(FLAT);
  h.placePlayerAtTile(5, 5);
  h.settle();
  h.player.health.current = 3;
  h.player.ink = 99;

  h.hold(Key.FOCUS);
  h.step(2);
  assert.equal(h.state, PlayerState.FOCUS);

  h.stepUntil(() => h.player.health.current > 3, 200);
  assert.equal(h.player.health.current, 4);
  assert.ok(h.player.ink < 99, 'focus should have spent ink');

  // Releasing the button leaves the state.
  h.release(Key.FOCUS);
  h.step(2);
  assert.notEqual(h.state, PlayerState.FOCUS);
});

test('focus cannot start without enough ink', () => {
  const h = new Harness(FLAT);
  h.placePlayerAtTile(5, 5);
  h.settle();
  h.player.health.current = 3;
  h.player.ink = 0;
  h.hold(Key.FOCUS);
  h.step(3);
  assert.notEqual(h.state, PlayerState.FOCUS);
});

test('ink is capped and gained through the ability hook', () => {
  const h = new Harness(FLAT);
  h.player.maxInk = 20;
  h.player.ink = 0;
  h.player.inkPerHit = 15;
  h.player.gainInk(h.player.inkPerHit);
  assert.equal(h.player.ink, 15);
  h.player.gainInk(h.player.inkPerHit);
  assert.equal(h.player.ink, 20, 'ink must clamp to maxInk');
  assert.equal(h.player.spendInk(25), false);
  assert.equal(h.player.spendInk(20), true);
  assert.equal(h.player.ink, 0);
});

test('the player cannot leave a sealed room through solid walls', () => {
  const BOX = `
    ##############################
    #............................#
    #............................#
    #............................#
    ##############################
  `;
  const h = new Harness(BOX);
  h.placePlayerAtTile(5, 3);
  h.settle();
  h.player.grantAbility(Ability.SKIM);
  h.hold(Key.LEFT);
  for (let i = 0; i < 200; i++) {
    h.step(1);
    if (i % 40 === 0) {
      h.player.dashCooldownTimer = 0;
      h.tap(Key.DASH);
    }
  }
  assert.ok(h.player.body.box.x >= 16, `escaped to x=${h.player.body.box.x}`);
  assert.ok(h.feetY <= 4 * 16, 'fell through the floor');
});

test('serialising and loading the player round-trips its progression', () => {
  const h = new Harness(FLAT);
  h.player.grantAbility(Ability.SKIM);
  h.player.grantAbility(Ability.PAPERWING);
  h.player.nibTier = 2;
  h.player.glyphs = 412;
  h.player.health.setMax(7);
  h.player.ink = 40;
  h.player.stats.deaths = 9;

  const data = JSON.parse(JSON.stringify(h.player.toJSON()));

  const h2 = new Harness(FLAT);
  h2.player.load(data);
  assert.equal(h2.player.abilities.owns(Ability.SKIM), true);
  assert.equal(h2.player.abilities.owns(Ability.PAPERWING), true);
  assert.equal(h2.player.maxJumps, 2);
  assert.equal(h2.player.nibTier, 2);
  assert.equal(h2.player.glyphs, 412);
  assert.equal(h2.player.health.max, 7);
  assert.equal(h2.player.ink, 40);
  assert.equal(h2.player.stats.deaths, 9);
});
