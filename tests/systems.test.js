/**
 * @file Tests for enemies, bosses, save/load, progression and content integrity.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { Harness, Key, STEP } from './helpers/harness.js';
import { EventBus, Events } from '../src/engine/core/events.js';
import { StateMachine } from '../src/engine/core/state-machine.js';
import { Pool, SwapList } from '../src/engine/core/pool.js';
import { SaveSystem, MemoryStorage, SAVE_VERSION } from '../src/engine/save/save-system.js';
import { Health, makeDamage, DamageType, DamageFlags } from '../src/game/combat/damage.js';
import { CombatSystem, Team, Hurtbox } from '../src/game/combat/hitbox.js';
import { AbilitySet, Ability, parseAbilityMask, describeAbilityMask } from '../src/game/player/abilities.js';
import { Palette, mix, lighten, buildRamp, parseColor } from '../src/engine/render/palette.js';
import { Camera } from '../src/engine/render/camera.js';
import { ParticleSystem, ParticleShape } from '../src/engine/fx/particles.js';

import '../src/game/content/biomes.js';
import '../src/game/content/enemies.js';
import '../src/game/content/bosses.js';
import '../src/game/content/items.js';
import '../src/game/content/inscriptions.js';
import '../src/game/content/npcs.js';
import { createEnemy, allEnemyDefs, ARCHETYPES, EnemyState } from '../src/game/enemy/enemy.js';
import { createBoss, allBossDefs, defineBoss } from '../src/game/boss/boss.js';
import { allBiomes } from '../src/game/content/biomes.js';
import { allItems, allUpgrades } from '../src/game/content/items.js';
import { allNpcs, selectNode } from '../src/game/content/npcs.js';
import { Progression } from '../src/game/progression/progression.js';

const FLAT = `
  ..............................
  ..............................
  ..............................
  ..............................
  ..............................
  ##############################
`;

// ===========================================================================
// Core
// ===========================================================================

test('EventBus dispatches, unsubscribes and defers', () => {
  const bus = new EventBus();
  const seen = [];
  const off = bus.on('x', (p) => seen.push(p));
  bus.emit('x', 1);
  assert.deepEqual(seen, [1]);
  off();
  bus.emit('x', 2);
  assert.deepEqual(seen, [1]);

  bus.on('y', (p) => seen.push(p));
  bus.queue('y', 3);
  assert.deepEqual(seen, [1], 'queued events must not fire immediately');
  bus.flush();
  assert.deepEqual(seen, [1, 3]);
});

test('EventBus is safe against listeners mutating the listener list', () => {
  const bus = new EventBus();
  const seen = [];
  bus.on('x', () => {
    seen.push('a');
    bus.on('x', () => seen.push('late'));
  });
  bus.on('x', () => seen.push('b'));
  bus.emit('x');
  assert.deepEqual(seen, ['a', 'b'], 'a listener added during dispatch must not fire in that dispatch');
});

test('EventBus detects emit loops instead of blowing the stack', () => {
  const bus = new EventBus();
  bus.on('loop', () => bus.emit('loop'));
  assert.throws(() => bus.emit('loop'), /depth exceeded/);
});

test('StateMachine defers transitions and honours guards', () => {
  const log = [];
  const m = new StateMachine({ debugName: 'T' });
  m.add('a', {
    enter: () => log.push('enter a'),
    exit: () => log.push('exit a'),
    update: () => { m.change('b'); log.push('a still running'); },
  });
  m.add('b', { enter: () => log.push('enter b') });
  m.force('a');
  m.update(0.016);
  assert.deepEqual(log, ['enter a', 'a still running', 'exit a', 'enter b']);

  const guarded = new StateMachine();
  guarded.add('x', { canExit: () => false });
  guarded.add('y', {});
  guarded.force('x');
  assert.equal(guarded.change('y'), false);
  guarded.resolve();
  assert.equal(guarded.currentName, 'x');
});

test('StateMachine rejects transition cycles', () => {
  const m = new StateMachine();
  m.add('a', { enter: () => m.change('b') });
  m.add('b', { enter: () => m.change('a') });
  assert.throws(() => m.force('a'), /transition loop/);
});

test('Pool recycles instances and SwapList removes in O(1)', () => {
  let created = 0;
  const pool = new Pool(() => ({ id: created++ }), (o) => { o.id = -1; });
  const a = pool.acquire();
  pool.release(a);
  const b = pool.acquire();
  assert.equal(a, b, 'released instance should be handed back out');

  const list = new SwapList();
  list.push('a'); list.push('b'); list.push('c');
  list.removeAt(0);
  assert.equal(list.length, 2);
  assert.ok(list.toArray().includes('c'));
  assert.ok(!list.toArray().includes('a'));
});

// ===========================================================================
// Combat
// ===========================================================================

test('Health rounds damage once and never silently reaches zero damage', () => {
  const h = new Health(10, { resistances: { physical: 0.1 } });
  const dealt = h.applyDamage(makeDamage({ amount: 3, type: DamageType.PHYSICAL }));
  assert.equal(dealt, 1, 'heavy resistance must still leave a minimum of 1');

  const immune = new Health(10, { resistances: { physical: 0 } });
  assert.equal(immune.applyDamage(makeDamage({ amount: 5 })), 0, 'resistance 0 is true immunity');
});

test('Health i-frames block repeat hits but BYPASS_IFRAMES does not', () => {
  const h = new Health(5, { iframeDuration: 1 });
  assert.equal(h.applyDamage(makeDamage({ amount: 1 })), 1);
  assert.equal(h.applyDamage(makeDamage({ amount: 1 })), 0);
  assert.equal(
    h.applyDamage(makeDamage({ amount: 1, flags: DamageFlags.BYPASS_IFRAMES })), 1,
  );
});

test('Health poise breaks and refills', () => {
  const h = new Health(20);
  h.maxPoise = 20;
  h.poise = 20;
  h.applyDamage(makeDamage({ amount: 1, poise: 25 }));
  assert.equal(h.staggered, true);
  assert.equal(h.poise, 20, 'poise refills on break');
});

test('a hitbox damages a target exactly once per activation', () => {
  const bus = new EventBus();
  const combat = new CombatSystem(bus);
  const target = { health: new Health(50), body: null };
  const hurtbox = new Hurtbox(target, { team: Team.ENEMY });
  hurtbox.box.set(0, 0, 16, 16);
  combat.registerHurtbox(hurtbox);

  combat.spawnHitboxAt({}, {
    offsetX: 0, offsetY: 0, width: 16, height: 16,
    damage: 3, team: Team.PLAYER, activeFrames: 10,
  }, 0, 0);

  for (let i = 0; i < 8; i++) combat.update(STEP);
  assert.equal(target.health.current, 47, 'must deal 3 damage total, not 3 per frame');
});

test('hitInterval allows deliberate multi-hit attacks', () => {
  const bus = new EventBus();
  const combat = new CombatSystem(bus);
  const target = { health: new Health(50) };
  const hurtbox = new Hurtbox(target, { team: Team.ENEMY });
  hurtbox.box.set(0, 0, 16, 16);
  combat.registerHurtbox(hurtbox);

  combat.spawnHitboxAt({}, {
    offsetX: 0, offsetY: 0, width: 16, height: 16,
    damage: 1, team: Team.PLAYER, activeFrames: 40, hitInterval: 0.1,
  }, 0, 0);

  for (let i = 0; i < 40; i++) combat.update(STEP);
  const dealt = 50 - target.health.current;
  assert.ok(dealt >= 5 && dealt <= 8, `expected ~6 ticks, got ${dealt}`);
});

test('teams: player hitboxes do not hurt the player', () => {
  const bus = new EventBus();
  const combat = new CombatSystem(bus);
  const player = { health: new Health(5) };
  const hurtbox = new Hurtbox(player, { team: Team.PLAYER });
  hurtbox.box.set(0, 0, 16, 16);
  combat.registerHurtbox(hurtbox);
  combat.spawnHitboxAt({}, {
    offsetX: 0, offsetY: 0, width: 16, height: 16,
    damage: 3, team: Team.PLAYER, activeFrames: 5,
  }, 0, 0);
  for (let i = 0; i < 5; i++) combat.update(STEP);
  assert.equal(player.health.current, 5);
});

// ===========================================================================
// Abilities
// ===========================================================================

test('AbilitySet masks, requirements and serialisation', () => {
  const set = new AbilitySet();
  assert.equal(set.has(Ability.SKIM), false);
  set.grant(Ability.SKIM);
  assert.equal(set.has(Ability.SKIM), true);
  assert.equal(set.hasAll(Ability.SKIM | Ability.PAPERWING), false);
  set.grant(Ability.PAPERWING);
  assert.equal(set.hasAll(Ability.SKIM | Ability.PAPERWING), true);
  assert.equal(set.count(), 2);

  set.setEnabled(Ability.SKIM, false);
  assert.equal(set.has(Ability.SKIM), false, 'disabled abilities are unusable');
  assert.equal(set.owns(Ability.SKIM), true, 'but still owned');

  const copy = new AbilitySet();
  copy.load(JSON.parse(JSON.stringify(set.toJSON())));
  assert.equal(copy.flags, set.flags);
  assert.equal(copy.disabled, set.disabled);
});

test('parseAbilityMask reads content strings and rejects typos', () => {
  assert.equal(parseAbilityMask('skim'), Ability.SKIM);
  assert.equal(parseAbilityMask('skim|paperwing'), Ability.SKIM | Ability.PAPERWING);
  assert.equal(parseAbilityMask(''), 0);
  assert.equal(parseAbilityMask(null), 0);
  assert.throws(() => parseAbilityMask('skimm'), /unknown ability/);
  assert.match(describeAbilityMask(Ability.SKIM), /Skim/);
});

// ===========================================================================
// Enemies and bosses
// ===========================================================================

test('every enemy definition instantiates and runs without throwing', () => {
  const h = new Harness(FLAT);
  let built = 0;
  for (const def of allEnemyDefs()) {
    const enemy = createEnemy(def.id, h.ctx);
    enemy.spawnAt(240, 80);
    enemy.attach();
    for (let i = 0; i < 12; i++) {
      enemy.update(STEP);
      enemy.lateUpdate(STEP);
    }
    enemy.detach();
    built++;
  }
  assert.equal(built, allEnemyDefs().length);
});

test('enemies only aggro with line of sight', () => {
  const WALLED = `
    ..............................
    ..............................
    .............#................
    .............#................
    .............#................
    ##############################
  `;
  const h = new Harness(WALLED);
  h.placePlayerAtTile(2, 5);
  h.settle();

  const enemy = createEnemy('saltplodder', h.ctx);
  enemy.spawnAt(16 * 20, 16 * 5);
  enemy.attach();
  enemy.aggroRange = 400;
  for (let i = 0; i < 6; i++) enemy.update(STEP);
  assert.equal(enemy.canSeePlayer, false, 'a wall must block awareness');

  // Remove the wall; now it should notice.
  for (let ty = 2; ty <= 4; ty++) h.map.set(13, ty, 0);
  for (let i = 0; i < 6; i++) enemy.update(STEP);
  assert.equal(enemy.canSeePlayer, true);
});

test('walkers turn around at ledges instead of walking off', () => {
  const LEDGE = `
    ..............................
    ..............................
    ..............................
    ..............................
    ##########....................
  `;
  const h = new Harness(LEDGE);
  const enemy = createEnemy('saltplodder', h.ctx);
  enemy.spawnAt(16 * 2, 16 * 4);
  enemy.attach();
  enemy.facing = 1;
  enemy.machine.force('patrol');
  for (let i = 0; i < 240; i++) {
    enemy.update(STEP);
    h.physics.step(STEP);
    enemy.lateUpdate(STEP);
  }
  assert.ok(enemy.body.box.right <= 16 * 10 + 2, `walked off the ledge to x=${enemy.body.box.right}`);
  assert.equal(enemy.body.grounded, true);
});

test('every boss instantiates, begins its encounter and cycles patterns', () => {
  const h = new Harness(FLAT);
  h.placePlayerAtTile(10, 5);
  h.settle();

  let checked = 0;
  for (const def of allBossDefs()) {
    const boss = createBoss(def.id, h.ctx);
    boss.spawnAt(16 * 16, 16 * 5);
    boss.attach();
    boss.beginEncounter();
    assert.equal(boss.encounterActive, true, `${def.id} did not start`);

    const seen = new Set();
    for (let i = 0; i < 600; i++) {
      boss.update(STEP);
      h.physics.step(STEP);
      boss.lateUpdate(STEP);
      if (boss.pattern) seen.add(boss.pattern.id);
    }
    assert.ok(seen.size >= 1, `${def.id} never selected a pattern`);
    boss.detach();
    checked++;
  }
  assert.equal(checked, allBossDefs().length);
});

test('bosses change phase when health crosses a threshold', () => {
  const h = new Harness(FLAT);
  h.placePlayerAtTile(10, 5);
  h.settle();
  const boss = createBoss('headarchivist', h.ctx);
  boss.spawnAt(16 * 16, 16 * 5);
  boss.attach();
  boss.beginEncounter();
  assert.equal(boss.phaseIndex, 0);

  boss.health.current = boss.health.max * 0.5;
  boss.update(STEP);
  assert.equal(boss.phaseIndex, 1, 'should have entered phase 2');
  assert.equal(boss.machine.currentName, 'bossPhaseChange');

  boss.health.current = boss.health.max * 0.1;
  for (let i = 0; i < 200; i++) boss.update(STEP);
  assert.equal(boss.phaseIndex, 2);
});

test('the boss fairness contract is enforced at definition time', () => {
  assert.throws(() => defineBoss({
    id: '__test_no_recovery', name: 'x', title: 'x', biome: 'saltshallows',
    health: 10, damage: 1, width: 10, height: 10,
    phases: [{
      id: 'p', name: 'p', healthThreshold: 1,
      patterns: [{ id: 'a', name: 'a', telegraph: 0.5, duration: 0.2, recovery: 0 }],
    }],
  }), /no recovery window/);

  assert.throws(() => defineBoss({
    id: '__test_no_telegraph', name: 'x', title: 'x', biome: 'saltshallows',
    health: 10, damage: 1, width: 10, height: 10,
    phases: [{
      id: 'p', name: 'p', healthThreshold: 1, minTelegraph: 0.3,
      patterns: [{ id: 'a', name: 'a', telegraph: 0.05, duration: 0.2, recovery: 0.5 }],
    }],
  }), /telegraph floor/);
});

test('boss pattern selection never repeats immediately when alternatives exist', () => {
  const h = new Harness(FLAT);
  h.placePlayerAtTile(10, 5);
  h.settle();
  const boss = createBoss('thelastweir', h.ctx);
  boss.spawnAt(16 * 14, 16 * 5);
  boss.attach();
  boss.beginEncounter();

  let last = '';
  let repeats = 0;
  for (let i = 0; i < 3000; i++) {
    boss.update(STEP);
    h.physics.step(STEP);
    if (boss.pattern && boss.pattern.id !== last) {
      if (boss.lastPatternId === boss.pattern.id) repeats++;
      last = boss.pattern.id;
    }
  }
  assert.equal(repeats, 0, 'a pattern repeated back-to-back despite alternatives');
});

// ===========================================================================
// Save system
// ===========================================================================

test('save round-trips and reports its version', () => {
  const saves = new SaveSystem({ storage: new MemoryStorage() });
  assert.equal(saves.exists(0), false);
  assert.equal(saves.save(0, { player: { glyphs: 12 }, world: { flags: ['a'] } }), true);
  const loaded = saves.load(0);
  assert.equal(loaded.version, SAVE_VERSION);
  assert.equal(loaded.player.glyphs, 12);
  assert.deepEqual(loaded.world.flags, ['a']);
});

test('corrupt saves are rejected rather than crashing the loader', () => {
  const storage = new MemoryStorage();
  const saves = new SaveSystem({ storage });
  storage.setItem('aetherweir.save.0', '{not json');
  assert.equal(saves.load(0), null);
  assert.match(saves.lastError, /corrupt/);

  storage.setItem('aetherweir.save.1', '"a string"');
  assert.equal(saves.load(1), null);
});

test('saves from a newer version are refused, not misread', () => {
  const storage = new MemoryStorage();
  const saves = new SaveSystem({ storage });
  storage.setItem('aetherweir.save.0', JSON.stringify({ version: SAVE_VERSION + 5 }));
  assert.equal(saves.load(0), null);
  assert.match(saves.lastError, /newer version/);
});

test('old saves are migrated forward', () => {
  const storage = new MemoryStorage();
  const saves = new SaveSystem({ storage });
  // A v1 save: abilities as an array, flags as an object map.
  storage.setItem('aetherweir.save.0', JSON.stringify({
    version: 1,
    player: { abilities: ['skim', 'paperwing'], glyphs: 5 },
    world: { flags: { 'boss:saltwarden': true, 'unused': false } },
  }));
  const loaded = saves.load(0);
  assert.ok(loaded, `migration failed: ${saves.lastError}`);
  assert.equal(loaded.version, SAVE_VERSION);
  assert.equal(typeof loaded.player.abilities, 'object');
  assert.ok(Array.isArray(loaded.world.flags));
  assert.deepEqual(loaded.world.flags, ['boss:saltwarden']);
});

test('export and import round-trip a save', () => {
  const saves = new SaveSystem({ storage: new MemoryStorage() });
  saves.save(0, { player: { glyphs: 999 } });
  const code = saves.exportSlot(0);
  assert.ok(code && code.length > 10);
  assert.equal(saves.importSlot(2, code), true);
  assert.equal(saves.load(2).player.glyphs, 999);
  assert.equal(saves.importSlot(2, 'not-base64!!!'), false);
});

// ===========================================================================
// Progression
// ===========================================================================

test('seals respect the wax budget and apply their effects', () => {
  const h = new Harness(FLAT);
  const prog = new Progression(h.ctx);
  h.ctx.progression = prog;
  prog.waxCapacity = 3;

  prog.owned.add('seal_ballast'); // costs 3
  assert.equal(prog.equip('seal_ballast'), true);
  assert.equal(prog.waxFree, 0);
  assert.equal(h.player.health.armour, 1, 'equipping must apply the effect');

  prog.owned.add('seal_thrift'); // costs 1
  assert.equal(prog.equip('seal_thrift'), false, 'should not fit in the budget');

  prog.unequip('seal_ballast');
  assert.equal(h.player.health.armour, 0, 'unequipping must undo the effect');
  assert.equal(prog.equip('seal_thrift'), true);
});

test('acquiring an etching applies it exactly once', () => {
  const h = new Harness(FLAT);
  const prog = new Progression(h.ctx);
  h.ctx.progression = prog;
  const before = h.player.health.max;
  assert.equal(prog.acquire('etch_filament_1'), true);
  assert.equal(h.player.health.max, before + 1);
  assert.equal(prog.acquire('etch_filament_1'), false, 'duplicates must be ignored');
  assert.equal(h.player.health.max, before + 1);
});

test('progression serialises and restores equipped seal effects', () => {
  const h = new Harness(FLAT);
  const prog = new Progression(h.ctx);
  h.ctx.progression = prog;
  prog.waxCapacity = 6;
  prog.owned.add('seal_ballast');
  prog.equip('seal_ballast');
  const data = JSON.parse(JSON.stringify(prog.toJSON()));

  const h2 = new Harness(FLAT);
  const prog2 = new Progression(h2.ctx);
  h2.ctx.progression = prog2;
  prog2.load(data);
  assert.equal(h2.player.health.armour, 1, 'seal effects must be re-applied on load');
  assert.deepEqual(prog2.equipped, ['seal_ballast']);
});

test('completion percentage is bounded and weighted toward major content', () => {
  const h = new Harness(FLAT);
  const prog = new Progression(h.ctx);
  h.ctx.progression = prog;
  assert.equal(prog.completionPercent(), 0);
  for (const item of allItems()) prog.owned.add(item.id);
  for (const boss of allBossDefs()) prog.bossesDefeated.add(boss.id);
  for (let i = 0; i < 60; i++) prog.transcribed.add(`i${i}`);
  assert.equal(prog.completionPercent(), 100);
});

// ===========================================================================
// Presentation
// ===========================================================================

test('palette mixing stays in gamut and produces distinct ramps', () => {
  const c = parseColor('#8fd0ff');
  assert.deepEqual([c.r, c.g, c.b], [143, 208, 255]);

  // Mixing is perceptual, not sRGB-linear, so the midpoint of black and white
  // is a *perceptual* mid-grey — around sRGB 99, not 128. That is the whole
  // point of mixing in OKLab, so assert the perceptual property rather than the
  // naive arithmetic one.
  const mid = parseColor(mix('#000000', '#ffffff', 0.5));
  assert.ok(mid.r > 80 && mid.r < 120, `perceptual mid-grey out of range: ${mid.r}`);
  assert.equal(mid.r, mid.g, 'a neutral mix must stay neutral');
  assert.equal(mid.g, mid.b);

  // Mixing two saturated colours must not pass through grey, which is the
  // failure mode that motivated using a perceptual space at all.
  const blend = parseColor(mix('#2040c0', '#c08020', 0.5));
  const chroma = Math.max(blend.r, blend.g, blend.b) - Math.min(blend.r, blend.g, blend.b);
  assert.ok(chroma > 20, `blend desaturated to near-grey (chroma ${chroma})`);

  const ramp = buildRamp(['#000000', '#ffffff'], 6);
  assert.equal(ramp.length, 6);
  assert.notEqual(ramp[0], ramp[5]);

  const lit = parseColor(lighten('#404040', 0.2));
  assert.ok(lit.r > 64, 'lighten should raise lightness');
});

test('every biome builds a usable palette', () => {
  for (const b of allBiomes()) {
    assert.ok(b.palette instanceof Palette, `${b.id} has no palette`);
    assert.equal(b.palette.ramp.length, 12);
    assert.ok(b.palette.accent.startsWith('#') || b.palette.accent.startsWith('rgb'));
  }
});

test('camera clamps to room bounds and centres rooms smaller than the view', () => {
  const cam = new Camera(480, 270);
  cam.setBounds(0, 0, 1000, 800);
  cam.snapTo(-500, -500);
  assert.ok(cam.x >= 240, `clamped x=${cam.x}`);
  assert.ok(cam.y >= 135, `clamped y=${cam.y}`);

  cam.setBounds(0, 0, 200, 100); // smaller than the view on both axes
  cam.snapTo(0, 0);
  assert.equal(cam.x, 100);
  assert.equal(cam.y, 50);
});

test('camera dead zone suppresses small movements', () => {
  const cam = new Camera(480, 270);
  cam.snapTo(0, 0);
  const target = { x: 0, y: 0 };
  cam.follow(target, { grounded: true, velocityX: 0, velocityY: 0 });
  target.x = 10; // inside the dead zone
  for (let i = 0; i < 30; i++) cam.update(STEP);
  assert.ok(Math.abs(cam.x) < 1, `camera drifted to ${cam.x} for a movement inside the dead zone`);
});

test('particles allocate, expire and recycle', () => {
  const ps = new ParticleSystem(64);
  ps.emit({ x: 0, y: 0, count: 20, life: 0.1, shape: ParticleShape.DOT });
  assert.equal(ps.alive, 20);
  for (let i = 0; i < 12; i++) ps.update(STEP);
  assert.equal(ps.alive, 0);
  ps.emit({ x: 0, y: 0, count: 20, life: 0.1 });
  assert.equal(ps.alive, 20, 'slots must be recycled');
});

test('particle system drops emissions rather than overflowing', () => {
  const ps = new ParticleSystem(10);
  ps.emit({ x: 0, y: 0, count: 50, life: 5 });
  assert.equal(ps.alive, 10);
  assert.ok(ps.droppedEmissions > 0);
});

// ===========================================================================
// Content integrity
// ===========================================================================

test('content meets the design targets', () => {
  assert.ok(allBiomes().length >= 12, `biomes: ${allBiomes().length}`);
  assert.ok(allEnemyDefs().length >= 60, `enemies: ${allEnemyDefs().length}`);
  assert.ok(allBossDefs().length >= 25, `bosses: ${allBossDefs().length}`);
  assert.ok(allUpgrades().length >= 40, `upgrades: ${allUpgrades().length}`);
  assert.ok(allNpcs().length >= 30, `npcs: ${allNpcs().length}`);
});

test('every enemy references a real archetype and biome', () => {
  const biomes = new Set(allBiomes().map((b) => b.id));
  for (const e of allEnemyDefs()) {
    assert.ok(ARCHETYPES[e.archetype], `${e.id} has unknown archetype ${e.archetype}`);
    assert.ok(biomes.has(e.biome), `${e.id} has unknown biome ${e.biome}`);
    assert.ok(e.health > 0 && e.damage >= 0, `${e.id} has invalid stats`);
    assert.ok(e.width > 0 && e.height > 0, `${e.id} has invalid size`);
  }
});

test('contact damage stays on the intended curve', () => {
  // A five-filament player means damage 3 is a third of the health bar; it must
  // never appear in an early region.
  const early = new Set(['saltshallows', 'quillrest', 'sunkenarchive']);
  for (const e of allEnemyDefs()) {
    if (early.has(e.biome)) {
      assert.ok(e.damage <= 1, `${e.id} deals ${e.damage} in an early region`);
    }
    assert.ok(e.damage <= 3, `${e.id} deals ${e.damage}, above the cap`);
  }
});

test('every NPC has at least one dialogue node and selects one', () => {
  for (const npc of allNpcs()) {
    assert.ok(npc.nodes.length >= 1, `${npc.id} has no nodes`);
    const node = selectNode(npc, {});
    assert.ok(node && Array.isArray(node.lines) && node.lines.length > 0, `${npc.id} selected an empty node`);
  }
});

test('every seal declares a wax cost and both equip hooks', () => {
  for (const item of allItems()) {
    if (item.kind !== 'seal') continue;
    assert.ok(item.waxCost >= 1, `${item.id} has no wax cost`);
    assert.equal(typeof item.onEquip, 'function', `${item.id} has no onEquip`);
    assert.equal(typeof item.onUnequip, 'function', `${item.id} has no onUnequip`);
    assert.ok(item.description.length > 10, `${item.id} has no real description`);
  }
});
