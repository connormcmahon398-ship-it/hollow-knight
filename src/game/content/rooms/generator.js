/**
 * @file The world builder: assembles regions from hand-authored templates.
 *
 * ## What is generated and what is not
 * **Not generated:** the interior of any room. Every layout comes from
 * `chunks.js`, where it was designed by hand.
 *
 * **Generated:** the region graph — how many rooms a region has, which template
 * fills each node, where the doorways go, which creatures from the region's
 * roster populate it, and where its checkpoints, lore and rewards sit.
 *
 * ## Why a spanning tree plus loops
 * A region is laid out as a grid, connected first by a random spanning tree
 * (which guarantees every room is reachable — no disconnected content, ever),
 * then given extra edges to create **loops**. Loops are the thing that makes a
 * Metroidvania map feel like a place rather than a flowchart: they create
 * shortcuts, alternative routes, and the "oh, *this* connects to *that*" moment
 * that a pure tree cannot produce.
 *
 * ## Determinism
 * Everything derives from a seed, so the same build always produces the same
 * world. That is essential: room ids appear in save files, and a world that
 * reshuffled between sessions would invalidate every save.
 */

import { Rng } from '../../../engine/core/rng.js';
import { defineRoom, ROOM_DEFS } from '../../world/room.js';
import { TEMPLATES, ROOM_W, ROOM_H } from './chunks.js';
import { allBiomes, getBiome } from '../biomes.js';
import { allEnemyDefs } from '../../enemy/enemy.js';
import { allBossDefs } from '../../boss/boss.js';
import { inscriptionsForBiome } from '../inscriptions.js';
import { allItems } from '../items.js';

/**
 * @typedef {Object} RegionPlan
 * @property {string} biome
 * @property {number} count How many rooms to build.
 * @property {number} gridW @property {number} gridH
 * @property {number} originX @property {number} originY World-map position.
 * @property {number} loopFactor 0..1, how many extra connections beyond the tree.
 */

/**
 * Build every generated region.
 *
 * @param {object} [options]
 * @param {string} [options.seed]
 * @returns {{rooms: number, regions: number}}
 */
export function buildWorld(options = {}) {
  const rng = new Rng(options.seed ?? 'aetherweir-world-v1');
  let built = 0;
  let regions = 0;

  for (const biome of allBiomes()) {
    // The two hand-authored regions are skipped; they are already defined.
    if (biome.id === 'saltshallows' || biome.id === 'quillrest') continue;

    const plan = planFor(biome);
    built += buildRegion(plan, rng.fork(biome.id));
    regions++;
  }

  return { rooms: built, regions };
}

/**
 * How large each region should be, and where it sits on the world map.
 * These numbers are authored, not random: region size is a pacing decision.
 * @param {any} biome
 * @returns {RegionPlan}
 */
function planFor(biome) {
  /** @type {Record<string, Partial<RegionPlan>>} */
  const SIZES = {
    sunkenarchive: { count: 26, gridW: 7, gridH: 4, originX: 10, originY: 2 },
    verdigris: { count: 24, gridW: 6, gridH: 4, originX: 18, originY: 4 },
    glasswake: { count: 24, gridW: 6, gridH: 4, originX: 10, originY: -3 },
    weepinggallery: { count: 22, gridW: 5, gridH: 5, originX: 3, originY: -6 },
    cinderloom: { count: 26, gridW: 6, gridH: 5, originX: 25, originY: 2 },
    marrowterraces: { count: 24, gridW: 6, gridH: 4, originX: 18, originY: 10 },
    umbralfen: { count: 22, gridW: 6, gridH: 4, originX: 10, originY: 11 },
    clockspill: { count: 24, gridW: 6, gridH: 4, originX: 26, originY: 10 },
    ashenspire: { count: 20, gridW: 4, gridH: 6, originX: 2, originY: -13 },
    auricdeep: { count: 22, gridW: 6, gridH: 4, originX: 18, originY: 17 },
    lastweir: { count: 20, gridW: 5, gridH: 4, originX: 27, originY: 18 },
    blankmargin: { count: 14, gridW: 4, gridH: 4, originX: -8, originY: -8 },
    inkbelow: { count: 18, gridW: 5, gridH: 4, originX: 10, originY: 24 },
    ninestrokes: { count: 12, gridW: 4, gridH: 3, originX: 34, originY: 6 },
  };
  const size = SIZES[biome.id] ?? { count: 16, gridW: 4, gridH: 4, originX: 0, originY: 0 };
  return {
    biome: biome.id,
    count: size.count ?? 16,
    gridW: size.gridW ?? 4,
    gridH: size.gridH ?? 4,
    originX: size.originX ?? 0,
    originY: size.originY ?? 0,
    loopFactor: 0.35,
  };
}

/**
 * @param {RegionPlan} plan
 * @param {Rng} rng
 * @returns {number} rooms built
 */
function buildRegion(plan, rng) {
  const biome = getBiome(plan.biome);
  const roster = allEnemyDefs().filter((e) => e.biome === plan.biome);
  const bosses = allBossDefs().filter((b) => b.biome === plan.biome);
  const lore = inscriptionsForBiome(plan.biome);
  const rewards = allItems().filter((i) => i.biome === plan.biome && i.kind !== 'ability');
  const abilityItems = allItems().filter((i) => i.biome === plan.biome && i.kind === 'ability');

  // --- 1. Choose which grid cells are occupied, as a connected blob ---
  const cells = carveBlob(plan, rng);

  // --- 2. Connect them: spanning tree first, then loops ---
  const edges = connectCells(cells, plan, rng);

  // --- 3. Assign a role to each room ---
  const roles = assignRoles(cells, plan, rng, bosses.length);

  // --- 4. Build each room ---
  let built = 0;
  cells.forEach((cell, index) => {
    const role = roles[index];
    const templ = pickTemplate(role, rng);
    const id = `${plan.biome}_${String(index).padStart(2, '0')}`;

    const art = decorateTemplate(templ, {
      role,
      roster,
      boss: role === 'boss' ? bosses[Math.min(cell.bossIndex ?? 0, bosses.length - 1)] : null,
      lore,
      rewards,
      abilityItems,
      rng: rng.fork(id),
      index,
    });

    const exits = edges
      .filter((e) => e.from === index || e.to === index)
      .map((e) => {
        const otherIndex = e.from === index ? e.to : e.from;
        const other = cells[otherIndex];
        const edge = directionBetween(cell, other);
        return {
          edge,
          offset: edgeOffset(edge, templ),
          span: edge === 'left' || edge === 'right' ? 2 : 3,
          to: `${plan.biome}_${String(otherIndex).padStart(2, '0')}`,
          // The region's own gate applies at its entrance rooms only; interior
          // doors are ungated so a region never traps the player inside itself.
          gate: 0,
        };
      });

    // Templates are authored sealed on all four sides; the doorways are cut
    // here, once the graph has decided which walls are actually doors. Authoring
    // them pre-cut would mean every template only fit one connection pattern.
    carveDoorways(art, exits);

    defineRoom({
      id,
      name: roomName(plan.biome, role, index, rng),
      biome: plan.biome,
      worldX: plan.originX + cell.x * 2,
      worldY: plan.originY + cell.y * 2,
      art,
      markers: art.markers,
      exits,
      isBossArena: role === 'boss',
      isSafe: role === 'rest' || role === 'gate',
      secret: role === 'secret',
      lore: '',
    });
    built++;
  });

  return built;
}

/**
 * Carve a connected blob of grid cells, so regions have organic outlines rather
 * than being perfect rectangles.
 * @param {RegionPlan} plan
 * @param {Rng} rng
 * @returns {Array<{x: number, y: number, bossIndex?: number}>}
 */
function carveBlob(plan, rng) {
  /** @type {Array<{x: number, y: number}>} */
  const cells = [];
  const occupied = new Set();
  let cx = Math.floor(plan.gridW / 2);
  let cy = Math.floor(plan.gridH / 2);

  const push = (/** @type {number} */ x, /** @type {number} */ y) => {
    const key = `${x},${y}`;
    if (occupied.has(key)) return false;
    if (x < 0 || y < 0 || x >= plan.gridW || y >= plan.gridH) return false;
    occupied.add(key);
    cells.push({ x, y });
    return true;
  };

  push(cx, cy);
  // Random walk with a bias toward unoccupied neighbours, which produces
  // regions that sprawl rather than doubling back on themselves.
  let guard = 0;
  while (cells.length < plan.count && guard++ < plan.count * 40) {
    const from = rng.pick(cells);
    const dirs = rng.shuffle([[1, 0], [-1, 0], [0, 1], [0, -1]]);
    for (const [dx, dy] of dirs) {
      if (push(from.x + dx, from.y + dy)) break;
    }
  }
  return cells;
}

/**
 * @param {Array<{x: number, y: number}>} cells
 * @param {RegionPlan} plan
 * @param {Rng} rng
 * @returns {Array<{from: number, to: number}>}
 */
function connectCells(cells, plan, rng) {
  const index = new Map();
  cells.forEach((c, i) => index.set(`${c.x},${c.y}`, i));

  /** @type {Array<{from: number, to: number}>} */
  const all = [];
  cells.forEach((c, i) => {
    for (const [dx, dy] of [[1, 0], [0, 1]]) {
      const j = index.get(`${c.x + dx},${c.y + dy}`);
      if (j !== undefined) all.push({ from: i, to: j });
    }
  });

  // Spanning tree via union-find over shuffled edges. Guarantees connectivity,
  // which is the one property the world absolutely must have.
  const parent = cells.map((_, i) => i);
  const find = (/** @type {number} */ a) => {
    while (parent[a] !== a) {
      parent[a] = parent[parent[a]];
      a = parent[a];
    }
    return a;
  };

  const shuffled = rng.shuffle(all.slice());
  /** @type {Array<{from: number, to: number}>} */
  const tree = [];
  /** @type {Array<{from: number, to: number}>} */
  const spare = [];

  for (const edge of shuffled) {
    const a = find(edge.from);
    const b = find(edge.to);
    if (a === b) {
      spare.push(edge);
    } else {
      parent[a] = b;
      tree.push(edge);
    }
  }

  // Add back a fraction of the rejected edges as loops.
  const loopCount = Math.floor(spare.length * plan.loopFactor);
  for (let i = 0; i < loopCount; i++) tree.push(spare[i]);

  return tree;
}

/**
 * @param {Array<any>} cells
 * @param {RegionPlan} plan
 * @param {Rng} rng
 * @param {number} bossCount
 * @returns {string[]}
 */
function assignRoles(cells, plan, rng, bossCount) {
  const roles = cells.map(() => 'combat');
  const order = rng.shuffle(cells.map((_, i) => i));
  let cursor = 0;

  /** @param {string} role @param {number} n */
  const assign = (role, n) => {
    for (let i = 0; i < n && cursor < order.length; i++, cursor++) {
      roles[order[cursor]] = role;
    }
  };

  // Every region gets at least one rest point and one gatestone; without them a
  // region is a death trap and an island.
  assign('rest', Math.max(1, Math.round(cells.length * 0.1)));
  assign('gate', 1);
  assign('boss', Math.min(bossCount, Math.max(1, Math.round(cells.length * 0.08))));
  assign('lore', Math.max(2, Math.round(cells.length * 0.14)));
  assign('reward', Math.max(1, Math.round(cells.length * 0.1)));
  assign('secret', Math.max(1, Math.round(cells.length * 0.08)));
  assign('challenge', Math.max(1, Math.round(cells.length * 0.06)));
  assign('traverse', Math.round(cells.length * 0.2));
  // Everything unassigned stays 'combat'.

  // Record which boss each boss room hosts.
  let bossIndex = 0;
  roles.forEach((role, i) => {
    if (role === 'boss') {
      cells[i].bossIndex = bossIndex++;
    }
  });

  return roles;
}

/**
 * @param {string} role
 * @param {Rng} rng
 * @returns {import('./chunks.js').RoomTemplate}
 */
function pickTemplate(role, rng) {
  /** @type {Record<string, string[]>} */
  const BY_ROLE = {
    rest: ['rest_wellspring'],
    gate: ['gate_room'],
    boss: ['arena_open', 'arena_ledged'],
    lore: ['lore_chamber'],
    reward: ['reward_alcove'],
    secret: ['secret_alcove'],
    challenge: ['trial_precision', 'trial_wallrun'],
    traverse: ['corridor_flat', 'corridor_stepped', 'corridor_pits', 'corridor_ramped', 'shaft_ledges'],
    combat: [
      'hall_pillars', 'hall_terraces', 'hall_gauntlet', 'hall_spikefloor',
      'hall_hangers', 'hall_lowroof', 'shaft_walls', 'shaft_descent',
      'water_channel', 'breakable_floor',
    ],
  };
  const ids = BY_ROLE[role] ?? BY_ROLE.combat;
  const id = rng.pick(ids);
  const found = TEMPLATES.find((t) => t.id === id);
  if (!found) throw new Error(`generator: missing template "${id}"`);
  return found;
}

/**
 * Fill a template's markers with region-appropriate content.
 *
 * Returns the art rows plus the marker table that resolves each marker glyph
 * to a concrete creature, inscription or item for this region.
 *
 * @param {import('./chunks.js').RoomTemplate} templ
 * @param {any} opts
 * @returns {string[] & {markers: Record<string, any>}}
 */
function decorateTemplate(templ, opts) {
  const { rng, roster, lore, rewards, abilityItems, role, boss } = opts;
  /** @type {any} */
  const art = templ.art.slice();

  /** @type {Record<string, any>} */
  const markers = {};

  if (role === 'boss' && boss) {
    markers.B = boss.id;
    // Place the boss in the middle of the arena.
    const midRow = Math.floor(art.length * 0.6);
    art[midRow] = replaceAt(art[midRow], Math.floor(ROOM_W / 2), 'B');
  }

  if (roster.length > 0) {
    // Difficulty-appropriate: weaker creatures dominate, tougher ones appear.
    const sorted = roster.slice().sort((a, b) => a.health - b.health);
    markers.e = [];
    const enemyCount = countGlyph(art, 'e');
    for (let i = 0; i < enemyCount; i++) {
      const bias = rng.next() ** 1.6; // favours the low end
      markers.e.push(sorted[Math.min(sorted.length - 1, Math.floor(bias * sorted.length))].id);
    }
  }

  if (lore.length > 0) {
    markers['?'] = [];
    const n = countGlyph(art, '?');
    for (let i = 0; i < n; i++) markers['?'].push(rng.pick(lore).id);
  }

  const itemCount = countGlyph(art, 'I');
  if (itemCount > 0) {
    markers.I = [];
    const pool = [...abilityItems, ...rewards];
    for (let i = 0; i < itemCount; i++) {
      markers.I.push(pool.length ? pool[i % pool.length].id : 'etch_filament_1');
    }
  }

  const wellCount = countGlyph(art, 'W');
  if (wellCount > 0) {
    markers.W = [];
    for (let i = 0; i < wellCount; i++) markers.W.push(`wellspring_${opts.index}_${i}`);
  }
  const gateCount = countGlyph(art, 'G');
  if (gateCount > 0) {
    markers.G = [];
    for (let i = 0; i < gateCount; i++) markers.G.push(`gatestone_${opts.index}_${i}`);
  }
  const secretCount = countGlyph(art, 's');
  if (secretCount > 0) {
    markers.s = [];
    for (let i = 0; i < secretCount; i++) markers.s.push(`secret_${opts.index}_${i}`);
  }

  // The marker table rides along on the art array rather than being returned
  // separately, so the single call site stays readable.
  art.markers = markers;
  return art;
}

/**
 * Cut the doorways for a room's exits into its walls.
 *
 * Horizontal doors are a simple hole in the side wall at the template's
 * `doorRow`, which every template guarantees is standing height.
 *
 * Vertical doors need more than a hole: a gap in the ceiling the player cannot
 * reach is not a door. A short ladder of one-way platforms is therefore built
 * beneath every top exit, and the floor is opened beneath every bottom exit.
 * One-way platforms are used deliberately so the climb never blocks the return
 * trip downward.
 *
 * @param {string[]} art
 * @param {Array<{edge: string, offset: number, span: number}>} exits
 */
function carveDoorways(art, exits) {
  const height = art.length;
  const lastRow = height - 1;

  for (const exit of exits) {
    if (exit.edge === 'left' || exit.edge === 'right') {
      const col = exit.edge === 'left' ? 0 : ROOM_W - 1;
      for (let r = exit.offset; r < exit.offset + exit.span; r++) {
        if (r < 1 || r > lastRow - 1) continue;
        art[r] = replaceAt(art[r], col, '.');
      }
      continue;
    }

    const x0 = Math.max(1, exit.offset);
    const x1 = Math.min(ROOM_W - 2, exit.offset + exit.span - 1);

    if (exit.edge === 'top') {
      for (let x = x0; x <= x1; x++) art[0] = replaceAt(art[0], x, '.');
      // Clear a shaft down through any interior geometry, then build the ladder.
      for (let r = 1; r <= lastRow - 1; r++) {
        for (let x = x0; x <= x1; x++) art[r] = replaceAt(art[r], x, '.');
      }
      for (let r = lastRow - 3; r >= 2; r -= 3) {
        for (let x = x0; x <= x1; x++) art[r] = replaceAt(art[r], x, '-');
      }
    } else {
      for (let x = x0; x <= x1; x++) art[lastRow] = replaceAt(art[lastRow], x, '.');
      // Open the floor above it too, so the hole is reachable rather than
      // sitting under a solid slab.
      for (let r = lastRow - 1; r >= lastRow - 2 && r > 0; r--) {
        for (let x = x0; x <= x1; x++) art[r] = replaceAt(art[r], x, '.');
      }
    }
  }
}

/**
 * @param {string} row @param {number} index @param {string} ch
 * @returns {string}
 */
function replaceAt(row, index, ch) {
  return row.slice(0, index) + ch + row.slice(index + 1);
}

/**
 * @param {string[]} art @param {string} glyph
 * @returns {number}
 */
function countGlyph(art, glyph) {
  let n = 0;
  for (const row of art) {
    for (const c of row) if (c === glyph) n++;
  }
  return n;
}

/**
 * @param {{x: number, y: number}} from @param {{x: number, y: number}} to
 * @returns {string}
 */
function directionBetween(from, to) {
  if (to.x > from.x) return 'right';
  if (to.x < from.x) return 'left';
  if (to.y > from.y) return 'bottom';
  return 'top';
}

/**
 * @param {string} edge
 * @param {import('./chunks.js').RoomTemplate} templ
 * @returns {number}
 */
function edgeOffset(edge, templ) {
  if (edge === 'left' || edge === 'right') return templ.doorRow;
  return Math.floor(ROOM_W / 2) - 1;
}

/**
 * Room names are assembled from region-appropriate word lists. Generated names
 * are a compromise, but a room called "sunkenarchive_14" on the map screen is
 * worse than one called "The Ninth Stack".
 * @param {string} biome @param {string} role @param {number} index @param {Rng} rng
 * @returns {string}
 */
function roomName(biome, role, index, rng) {
  /** @type {Record<string, string[]>} */
  const NOUNS = {
    sunkenarchive: ['Stack', 'Aisle', 'Reading Room', 'Stair', 'Catalogue', 'Vault'],
    verdigris: ['Channel', 'Sluice', 'Cistern', 'Junction', 'Outflow', 'Pumphouse'],
    glasswake: ['Pane', 'Facet', 'Fold', 'Shard Field', 'Cooling', 'Prism'],
    weepinggallery: ['Terrace', 'Arbour', 'Runoff', 'Bower', 'Overlook', 'Cistern'],
    cinderloom: ['Loom', 'Flue', 'Kiln', 'Spindle Hall', 'Vent', 'Dyeworks'],
    marrowterraces: ['Terrace', 'Vertebra', 'Furrow', 'Ossuary', 'Field', 'Rib'],
    umbralfen: ['Reach', 'Sink', 'Reedbed', 'Hollow', 'Crossing', 'Mire'],
    clockspill: ['Movement', 'Escapement', 'Train', 'Barrel', 'Fusee', 'Dial'],
    ashenspire: ['Landing', 'Bell Stage', 'Parapet', 'Ascent', 'Watch', 'Flue'],
    auricdeep: ['Cistern', 'Drown', 'Shelf', 'Trench', 'Basin', 'Silt'],
    lastweir: ['Sluice', 'Gate', 'Spillway', 'Strain', 'Abutment', 'Crest'],
    blankmargin: ['Margin', 'Gutter', 'Rule', 'Blank', 'Guideline'],
    inkbelow: ['Blot', 'Strike', 'Deletion', 'Pool', 'Erasure'],
    ninestrokes: ['Round', 'Ring', 'Stroke', 'Bench'],
  };
  /** @type {Record<string, string[]>} */
  const ADJ = {
    rest: ['Quiet', 'Still', 'Kept'],
    gate: ['Marked', 'Attuned', 'Standing'],
    boss: ['Contested', 'Held', 'Refused'],
    lore: ['Recorded', 'Annotated', 'Copied'],
    reward: ['Sealed', 'Kept', 'Set Aside'],
    secret: ['Unlisted', 'Overwritten', 'Omitted'],
    challenge: ['Narrow', 'Exacting', 'Unkind'],
    traverse: ['Long', 'Lower', 'Upper', 'Outer'],
    combat: ['Broken', 'Fallen', 'Disputed', 'Old', 'Deep'],
  };
  const nouns = NOUNS[biome] ?? ['Chamber'];
  const adjectives = ADJ[role] ?? ADJ.combat;
  const ordinals = ['First', 'Second', 'Third', 'Fourth', 'Fifth', 'Sixth', 'Seventh', 'Eighth', 'Ninth', 'Tenth'];

  const noun = nouns[index % nouns.length];
  if (rng.bool(0.45)) {
    return `The ${ordinals[index % ordinals.length]} ${noun}`;
  }
  return `The ${rng.pick(adjectives)} ${noun}`;
}
