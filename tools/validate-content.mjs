/**
 * @file Content validation.
 *
 * Two jobs, and the second is the important one.
 *
 * 1. **Counts** — report how much content exists against the design targets.
 * 2. **Reachability** — prove the game can actually be finished.
 *
 * The reachability check is a fixed-point search over the world graph: start at
 * the opening room with no abilities, flood-fill through every door the current
 * ability set can pass, collect every ability and item found, and repeat until
 * nothing new becomes reachable. If the final region is not in the reachable set,
 * the world is unwinnable and this fails the build.
 *
 * That check is worth more than any number of unit tests, because "the player
 * can get stuck forever behind a door whose key is on the other side" is the one
 * bug in this genre that playtesting finds late and fixing costs most.
 */

import '../src/game/content/biomes.js';
import '../src/game/content/enemies.js';
import '../src/game/content/bosses.js';
import '../src/game/content/items.js';
import '../src/game/content/inscriptions.js';
import '../src/game/content/npcs.js';
import '../src/game/content/quests.js';
import { WORLD_STATS } from '../src/game/content/rooms/index.js';

import { allRoomDefs, ROOM_DEFS, createRoom } from '../src/game/world/room.js';
import { allEnemyDefs, ARCHETYPES } from '../src/game/enemy/enemy.js';
import { allBossDefs } from '../src/game/boss/boss.js';
import { allBiomes } from '../src/game/content/biomes.js';
import { allItems, allUpgrades, allSeals, allEtchings } from '../src/game/content/items.js';
import { allNpcs } from '../src/game/content/npcs.js';
import { allQuests } from '../src/game/content/quests.js';
import { allInscriptions } from '../src/game/content/inscriptions.js';
import { AbilitySet, parseAbilityMask, describeAbilityMask } from '../src/game/player/abilities.js';

/** Design targets from the brief. */
const TARGETS = {
  biomes: 12,
  enemies: 60,
  bosses: 25,
  upgrades: 40,
  npcs: 30,
  rooms: 200,
  endings: 4,
};

let failures = 0;
let warnings = 0;

/**
 * @param {string} label @param {number} actual @param {number} target
 */
function checkCount(label, actual, target) {
  const ok = actual >= target;
  if (!ok) failures++;
  const mark = ok ? 'PASS' : 'FAIL';
  console.log(`  [${mark}] ${label.padEnd(16)} ${String(actual).padStart(4)}  (target ${target})`);
}

console.log('\nAETHERWEIR — content validation\n');
console.log('Content counts');
console.log('─'.repeat(52));

const rooms = allRoomDefs();
checkCount('biomes', allBiomes().length, TARGETS.biomes);
checkCount('enemies', allEnemyDefs().length, TARGETS.enemies);
checkCount('bosses', allBossDefs().length, TARGETS.bosses);
checkCount('upgrades', allUpgrades().length, TARGETS.upgrades);
checkCount('NPCs', allNpcs().length, TARGETS.npcs);
checkCount('rooms', rooms.length, TARGETS.rooms);

console.log('\nSupporting content');
console.log('─'.repeat(52));
console.log(`  AI archetypes    ${String(Object.keys(ARCHETYPES).length).padStart(4)}`);
console.log(`  boss phases      ${String(allBossDefs().reduce((a, b) => a + b.phases.length, 0)).padStart(4)}`);
console.log(`  attack patterns  ${String(allBossDefs().reduce((a, b) => a + b.phases.reduce((c, p) => c + p.patterns.length, 0), 0)).padStart(4)}`);
console.log(`  seals            ${String(allSeals().length).padStart(4)}`);
console.log(`  etchings         ${String(allEtchings().length).padStart(4)}`);
console.log(`  items (all)      ${String(allItems().length).padStart(4)}`);
console.log(`  inscriptions     ${String(allInscriptions().length).padStart(4)}`);
console.log(`  quests           ${String(allQuests().length).padStart(4)}`);
console.log(`  optional bosses  ${String(allBossDefs().filter((b) => b.optional).length).padStart(4)}`);
console.log(`  secret bosses    ${String(allBossDefs().filter((b) => b.secret).length).padStart(4)}`);
console.log(`  hidden regions   ${String(allBiomes().filter((b) => b.hidden).length).padStart(4)}`);
console.log(`  generated        ${String(WORLD_STATS.rooms).padStart(4)} rooms across ${WORLD_STATS.regions} regions`);

// ---------------------------------------------------------------------------
// Structural integrity
// ---------------------------------------------------------------------------

console.log('\nStructural integrity');
console.log('─'.repeat(52));

/** @type {string[]} */
const problems = [];

// Every room must parse, and every exit must lead somewhere real.
let parsed = 0;
for (const def of rooms) {
  try {
    createRoom(def.id);
    parsed++;
  } catch (err) {
    problems.push(`room "${def.id}" fails to parse: ${err.message}`);
  }
  for (const exit of def.exits ?? []) {
    if (!ROOM_DEFS.has(exit.to)) {
      problems.push(`room "${def.id}" has an exit to unknown room "${exit.to}"`);
    }
  }
}
report('all rooms parse', parsed === rooms.length, `${parsed}/${rooms.length}`);

// Every enemy references a real archetype and a real biome.
const biomeIds = new Set(allBiomes().map((b) => b.id));
let badEnemies = 0;
for (const e of allEnemyDefs()) {
  if (!ARCHETYPES[e.archetype]) {
    problems.push(`enemy "${e.id}" uses unknown archetype "${e.archetype}"`);
    badEnemies++;
  }
  if (!biomeIds.has(e.biome)) {
    problems.push(`enemy "${e.id}" references unknown biome "${e.biome}"`);
    badEnemies++;
  }
}
report('enemy references valid', badEnemies === 0, `${badEnemies} problems`);

// Boss fairness contract — defineBoss enforces it at load, so reaching here
// means it held; re-state it explicitly so the report is self-contained.
let unfair = 0;
for (const b of allBossDefs()) {
  for (const phase of b.phases) {
    for (const p of phase.patterns) {
      if (p.recovery <= 0) unfair++;
      if (p.telegraph < 0.28) unfair++;
    }
  }
}
report('boss fairness contract', unfair === 0, `${unfair} violations`);

// Every region has at least one Wellspring, or it is a death trap.
const roomsByBiome = new Map();
for (const def of rooms) {
  if (!roomsByBiome.has(def.biome)) roomsByBiome.set(def.biome, []);
  roomsByBiome.get(def.biome).push(def);
}
let regionsWithoutRest = 0;
for (const [biome, list] of roomsByBiome) {
  const hasRest = list.some((d) => Object.values(d.markers ?? {}).flat().some(
    (m) => typeof m === 'string' && m.startsWith('wellspring'),
  ));
  if (!hasRest) {
    problems.push(`region "${biome}" has no Wellspring`);
    regionsWithoutRest++;
  }
}
report('every region has a rest point', regionsWithoutRest === 0, `${regionsWithoutRest} without`);

// ---------------------------------------------------------------------------
// Reachability: can the game be finished?
// ---------------------------------------------------------------------------

console.log('\nReachability');
console.log('─'.repeat(52));

const START = 'shallows_01';
const abilities = new AbilitySet();
/** @type {Set<string>} */
let reachable = new Set();
/** @type {Set<string>} */
const collected = new Set();

let pass = 0;
let grew = true;
while (grew && pass < 40) {
  pass++;
  const before = reachable.size + collected.size;

  // Flood-fill with the current ability set.
  reachable = new Set([START]);
  const queue = [START];
  while (queue.length > 0) {
    const id = queue.pop();
    const def = ROOM_DEFS.get(id);
    if (!def) continue;
    for (const exit of def.exits ?? []) {
      if (reachable.has(exit.to)) continue;
      const gate = typeof exit.gate === 'string' ? parseAbilityMask(exit.gate) : (exit.gate ?? 0);
      if (gate && !abilities.hasAll(gate)) continue;
      // `requiresFlag` gates are boss doors; assume the boss in the room can be
      // beaten, since combat difficulty is not a reachability question.
      reachable.add(exit.to);
      queue.push(exit.to);
    }
  }

  // Collect every ability item sitting in a reachable room.
  for (const id of reachable) {
    const def = ROOM_DEFS.get(id);
    for (const entry of Object.values(def?.markers ?? {}).flat()) {
      const itemId = typeof entry === 'string' ? entry : entry?.id;
      if (!itemId || collected.has(itemId)) continue;
      const item = allItems().find((i) => i.id === itemId);
      if (item?.kind === 'ability' && item.ability) {
        collected.add(itemId);
        abilities.grant(parseAbilityMask(item.ability));
      }
    }
    // Bosses grant abilities too.
    if (def?.isBossArena) {
      for (const entry of Object.values(def.markers ?? {}).flat()) {
        const bossDef = allBossDefs().find((b) => b.id === entry);
        if (bossDef?.rewardAbility && !collected.has(bossDef.id)) {
          collected.add(bossDef.id);
          abilities.grant(parseAbilityMask(bossDef.rewardAbility));
        }
      }
    }
  }

  grew = reachable.size + collected.size > before;
}

const reachPct = ((reachable.size / rooms.length) * 100).toFixed(1);
console.log(`  fixed point after ${pass} passes`);
console.log(`  abilities obtainable: ${abilities.count()} — ${describeAbilityMask(abilities.flags)}`);
console.log(`  rooms reachable:      ${reachable.size}/${rooms.length}  (${reachPct}%)`);

const reachedRegions = new Set([...reachable].map((id) => ROOM_DEFS.get(id)?.biome));
const requiredRegions = allBiomes().filter((b) => !b.optional && !b.hidden);
const missingRegions = requiredRegions.filter((b) => !reachedRegions.has(b.id));

report('all required regions reachable', missingRegions.length === 0,
  missingRegions.length ? missingRegions.map((b) => b.name).join(', ') : 'yes');
report('final region reachable', reachedRegions.has('lastweir'), reachedRegions.has('lastweir') ? 'yes' : 'NO');

// Unreachable rooms are a warning rather than a failure: some are intentionally
// behind optional content the flood-fill does not model (secret walls).
const unreachable = rooms.filter((d) => !reachable.has(d.id));
if (unreachable.length > 0) {
  warnings++;
  console.log(`  [WARN] ${unreachable.length} rooms not reachable by the flood-fill`);
  const byBiome = new Map();
  for (const d of unreachable) byBiome.set(d.biome, (byBiome.get(d.biome) ?? 0) + 1);
  for (const [b, n] of byBiome) console.log(`         ${b}: ${n}`);
}

// ---------------------------------------------------------------------------

if (problems.length > 0) {
  console.log('\nProblems');
  console.log('─'.repeat(52));
  for (const p of problems.slice(0, 30)) console.log(`  - ${p}`);
  if (problems.length > 30) console.log(`  ... and ${problems.length - 30} more`);
}

console.log('\n' + '─'.repeat(52));
if (failures > 0) {
  console.log(`VALIDATION FAILED — ${failures} failure(s), ${warnings} warning(s)\n`);
  process.exit(1);
}
console.log(`VALIDATION PASSED — ${warnings} warning(s)\n`);

/**
 * @param {string} label @param {boolean} ok @param {string} detail
 */
function report(label, ok, detail) {
  if (!ok) failures++;
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${label.padEnd(32)} ${detail}`);
}
