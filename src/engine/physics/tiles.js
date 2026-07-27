/**
 * @file Tile type registry.
 *
 * ## Why a flat integer grid with a property table?
 * Two alternatives were considered:
 *
 * - **Object per tile.** A `Tile` instance per cell is the most flexible, but a
 *   single 200x120 room would allocate 24,000 objects, and the world has
 *   hundreds of rooms. Memory and cache behaviour are both poor.
 * - **Bitfield per tile.** Packing properties directly into the integer avoids
 *   the lookup, but makes content files unreadable and adds a decode step
 *   everywhere.
 *
 * Instead the grid is a `Uint16Array` of type IDs, and properties live in a
 * frozen lookup table indexed by ID. Collision queries do one array read plus
 * one table read, both cache-friendly, and content files stay legible because
 * each tile also has a single-character glyph for the text room format.
 *
 * ## Slopes
 * Slopes are expressed as a **surface height function** rather than as a special
 * collider shape: each tile declares its surface height at its left and right
 * edges as a fraction of tile height measured from the tile's bottom. A full
 * block is `[1, 1]`, a 45-degree ramp rising to the right is `[0, 1]`, and a
 * two-tile shallow ramp is `[0, 0.5]` followed by `[0.5, 1]`.
 *
 * This single abstraction covers every slope angle the game needs, keeps the
 * collision code branch-light, and means adding a new slope is a data change
 * rather than a code change.
 */

/**
 * @typedef {Object} TileDef
 * @property {number} id
 * @property {string} name
 * @property {string} glyph Single character used in the text room format.
 * @property {boolean} solid Blocks movement from every direction.
 * @property {boolean} oneWay Blocks only downward motion (jump-through platform).
 * @property {[number, number]|null} slope Surface height at [left, right] edges, 0..1 from the bottom.
 * @property {boolean} hazard Deals contact damage.
 * @property {number} damage Damage dealt on contact.
 * @property {boolean} climbable Ladder/vine: allows vertical free movement.
 * @property {boolean} fluid Applies buoyancy and drag.
 * @property {number} fluidDensity Higher = more buoyant and more drag.
 * @property {boolean} breakable Can be destroyed by the right ability.
 * @property {string|null} breakTool Ability id required to break it, null = any attack.
 * @property {boolean} crumble Collapses shortly after being stood on.
 * @property {number} friction Multiplier on ground friction. <1 is ice, >1 is tar.
 * @property {number} conveyor Horizontal velocity imparted while grounded, px/s.
 * @property {boolean} opaque Blocks line of sight (used by AI and lighting).
 * @property {number} layer Render layer hint for the tile painter.
 */

/** Tile size in world units (pixels). Everything else derives from this. */
export const TILE_SIZE = 16;

/** @type {TileDef[]} */
const DEFS = [];
/** @type {Map<string, number>} */
const BY_GLYPH = new Map();
/** @type {Map<string, number>} */
const BY_NAME = new Map();

/**
 * @param {Partial<TileDef> & {id: number, name: string, glyph: string}} def
 * @returns {number} the tile id
 */
function define(def) {
  /** @type {TileDef} */
  const full = {
    id: def.id,
    name: def.name,
    glyph: def.glyph,
    solid: def.solid ?? false,
    oneWay: def.oneWay ?? false,
    slope: def.slope ?? null,
    hazard: def.hazard ?? false,
    damage: def.damage ?? 0,
    climbable: def.climbable ?? false,
    fluid: def.fluid ?? false,
    fluidDensity: def.fluidDensity ?? 0,
    breakable: def.breakable ?? false,
    breakTool: def.breakTool ?? null,
    crumble: def.crumble ?? false,
    friction: def.friction ?? 1,
    conveyor: def.conveyor ?? 0,
    opaque: def.opaque ?? (def.solid ?? false),
    layer: def.layer ?? 0,
  };
  if (DEFS[full.id]) throw new Error(`Duplicate tile id ${full.id} (${full.name})`);
  if (BY_GLYPH.has(full.glyph)) {
    throw new Error(`Duplicate tile glyph "${full.glyph}" (${full.name} vs ${DEFS[BY_GLYPH.get(full.glyph)].name})`);
  }
  DEFS[full.id] = Object.freeze(full);
  BY_GLYPH.set(full.glyph, full.id);
  BY_NAME.set(full.name, full.id);
  return full.id;
}

// --- Tile definitions -------------------------------------------------------
// Ids are stable and must never be renumbered: saved rooms and the level editor
// reference them numerically.

export const Tiles = Object.freeze({
  EMPTY: define({ id: 0, name: 'empty', glyph: '.', opaque: false }),
  SOLID: define({ id: 1, name: 'solid', glyph: '#', solid: true, slope: [1, 1] }),
  /** Visually distinct but mechanically identical to SOLID; used for biome accents. */
  SOLID_ALT: define({ id: 2, name: 'solid_alt', glyph: '=', solid: true, slope: [1, 1], layer: 1 }),
  /** Background-only decorative fill. Never collides. */
  BACKDROP: define({ id: 3, name: 'backdrop', glyph: ',', opaque: false, layer: -1 }),

  ONE_WAY: define({ id: 4, name: 'one_way', glyph: '-', oneWay: true, opaque: false }),

  // Slopes. Naming is "direction the surface rises".
  SLOPE_R: define({ id: 5, name: 'slope_r', glyph: '/', solid: true, slope: [0, 1] }),
  SLOPE_L: define({ id: 6, name: 'slope_l', glyph: '\\', solid: true, slope: [1, 0] }),
  SLOPE_R_LOW: define({ id: 7, name: 'slope_r_low', glyph: 'r', solid: true, slope: [0, 0.5] }),
  SLOPE_R_HIGH: define({ id: 8, name: 'slope_r_high', glyph: 'R', solid: true, slope: [0.5, 1] }),
  SLOPE_L_HIGH: define({ id: 9, name: 'slope_l_high', glyph: 'L', solid: true, slope: [1, 0.5] }),
  SLOPE_L_LOW: define({ id: 10, name: 'slope_l_low', glyph: 'l', solid: true, slope: [0.5, 0] }),
  /** Half-height block; lets level design express a step without a full tile. */
  HALF_BLOCK: define({ id: 11, name: 'half_block', glyph: '_', solid: true, slope: [0.5, 0.5] }),

  SPIKE: define({ id: 12, name: 'spike', glyph: '^', hazard: true, damage: 1, opaque: false }),
  /** Heavier hazard used in late-game platforming challenges. */
  SPIKE_HEAVY: define({ id: 13, name: 'spike_heavy', glyph: 'X', hazard: true, damage: 2, opaque: false }),

  LADDER: define({ id: 14, name: 'ladder', glyph: 'H', climbable: true, opaque: false }),
  /** A ladder whose top tile also acts as a platform to stand on. */
  LADDER_TOP: define({ id: 15, name: 'ladder_top', glyph: 'T', climbable: true, oneWay: true, opaque: false }),

  WATER: define({ id: 16, name: 'water', glyph: '~', fluid: true, fluidDensity: 1, opaque: false }),
  /** The setting's magical fluid: denser, so the player floats and moves slowly. */
  AETHER: define({ id: 17, name: 'aether', glyph: '%', fluid: true, fluidDensity: 1.6, opaque: false }),
  /** Corrosive fluid: buoyant *and* damaging. */
  BRINE: define({ id: 18, name: 'brine', glyph: '!', fluid: true, fluidDensity: 1.1, hazard: true, damage: 1, opaque: false }),

  BREAKABLE: define({ id: 19, name: 'breakable', glyph: 'b', solid: true, slope: [1, 1], breakable: true }),
  /** Requires the heavy downward strike ability; gates progression. */
  BREAKABLE_HEAVY: define({ id: 20, name: 'breakable_heavy', glyph: 'B', solid: true, slope: [1, 1], breakable: true, breakTool: 'anchorbreak' }),
  /** Illusory wall: solid until revealed, then passable. Handled by the room. */
  ILLUSION: define({ id: 21, name: 'illusion', glyph: 'i', solid: true, slope: [1, 1] }),

  CRUMBLE: define({ id: 22, name: 'crumble', glyph: 'c', solid: true, slope: [1, 1], crumble: true }),

  ICE: define({ id: 23, name: 'ice', glyph: '*', solid: true, slope: [1, 1], friction: 0.12 }),
  TAR: define({ id: 24, name: 'tar', glyph: 'o', solid: true, slope: [1, 1], friction: 2.6 }),
  CONVEYOR_R: define({ id: 25, name: 'conveyor_r', glyph: '>', solid: true, slope: [1, 1], conveyor: 90 }),
  CONVEYOR_L: define({ id: 26, name: 'conveyor_l', glyph: '<', solid: true, slope: [1, 1], conveyor: -90 }),

  /** Blocks the player but not projectiles or enemies; used for arena gates. */
  GATE: define({ id: 27, name: 'gate', glyph: 'g', solid: true, slope: [1, 1], opaque: false }),

  /** Passable only with the phase ability. Solid otherwise. */
  PHASE_WALL: define({ id: 28, name: 'phase_wall', glyph: 'p', solid: true, slope: [1, 1], breakTool: 'blotstep' }),

  /** Vertical wind column: applies upward force. Not solid. */
  UPDRAFT: define({ id: 29, name: 'updraft', glyph: 'u', opaque: false }),

  /** Deals heavy damage; used for lava-analogue and the abyss floor. */
  SEAR: define({ id: 30, name: 'sear', glyph: 'S', hazard: true, damage: 3, fluid: true, fluidDensity: 1.3, opaque: false }),
});

/** Frozen array of every definition, indexed by id. */
export const TILE_DEFS = Object.freeze(DEFS.slice());

/** Highest defined tile id. */
export const MAX_TILE_ID = DEFS.length - 1;

/**
 * @param {number} id
 * @returns {TileDef}
 */
export function getTileDef(id) {
  return DEFS[id] ?? DEFS[Tiles.EMPTY];
}

/**
 * @param {string} glyph
 * @returns {number} tile id, or EMPTY for an unknown glyph
 */
export function tileFromGlyph(glyph) {
  const id = BY_GLYPH.get(glyph);
  return id === undefined ? Tiles.EMPTY : id;
}

/**
 * @param {string} name
 * @returns {number}
 */
export function tileFromName(name) {
  const id = BY_NAME.get(name);
  if (id === undefined) throw new Error(`Unknown tile name "${name}"`);
  return id;
}

/**
 * @param {number} id
 * @returns {string}
 */
export function glyphForTile(id) {
  return getTileDef(id).glyph;
}

// --- Fast property lookups --------------------------------------------------
// These are typed arrays rather than repeated object property reads because the
// collision inner loop touches them for every tile a body overlaps, every step.

const SOLID_FLAGS = new Uint8Array(DEFS.length);
const ONEWAY_FLAGS = new Uint8Array(DEFS.length);
const HAZARD_FLAGS = new Uint8Array(DEFS.length);
const CLIMB_FLAGS = new Uint8Array(DEFS.length);
const FLUID_FLAGS = new Uint8Array(DEFS.length);
const OPAQUE_FLAGS = new Uint8Array(DEFS.length);
/** Surface height at the left and right edge, packed as two parallel arrays. */
const SLOPE_L_ARR = new Float32Array(DEFS.length);
const SLOPE_R_ARR = new Float32Array(DEFS.length);
/** 1 when the tile is a non-rectangular slope needing the height-function path. */
const IS_RAMP = new Uint8Array(DEFS.length);

for (const def of DEFS) {
  if (!def) continue;
  SOLID_FLAGS[def.id] = def.solid ? 1 : 0;
  ONEWAY_FLAGS[def.id] = def.oneWay ? 1 : 0;
  HAZARD_FLAGS[def.id] = def.hazard ? 1 : 0;
  CLIMB_FLAGS[def.id] = def.climbable ? 1 : 0;
  FLUID_FLAGS[def.id] = def.fluid ? 1 : 0;
  OPAQUE_FLAGS[def.id] = def.opaque ? 1 : 0;
  if (def.slope) {
    SLOPE_L_ARR[def.id] = def.slope[0];
    SLOPE_R_ARR[def.id] = def.slope[1];
    IS_RAMP[def.id] = def.slope[0] !== 1 || def.slope[1] !== 1 ? 1 : 0;
  }
}

/** @param {number} id @returns {boolean} */
export function isSolid(id) { return SOLID_FLAGS[id] === 1; }
/** @param {number} id @returns {boolean} */
export function isOneWay(id) { return ONEWAY_FLAGS[id] === 1; }
/** @param {number} id @returns {boolean} */
export function isHazard(id) { return HAZARD_FLAGS[id] === 1; }
/** @param {number} id @returns {boolean} */
export function isClimbable(id) { return CLIMB_FLAGS[id] === 1; }
/** @param {number} id @returns {boolean} */
export function isFluid(id) { return FLUID_FLAGS[id] === 1; }
/** @param {number} id @returns {boolean} */
export function isOpaque(id) { return OPAQUE_FLAGS[id] === 1; }
/** @param {number} id @returns {boolean} true for slopes that are not full blocks */
export function isRamp(id) { return IS_RAMP[id] === 1; }

/**
 * Surface height of a tile at a horizontal position within it.
 * @param {number} id
 * @param {number} frac position across the tile, 0 at the left edge, 1 at the right
 * @returns {number} height above the tile's bottom edge, in 0..1
 */
export function tileSurfaceHeight(id, frac) {
  if (SOLID_FLAGS[id] !== 1) return 0;
  const l = SLOPE_L_ARR[id];
  const r = SLOPE_R_ARR[id];
  const f = frac < 0 ? 0 : frac > 1 ? 1 : frac;
  return l + (r - l) * f;
}
