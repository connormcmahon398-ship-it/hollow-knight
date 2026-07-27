/**
 * @file The regions of Aetherweir.
 *
 * ## What a biome is, mechanically
 * A biome is not just a colour scheme. Each one carries:
 *  - a **palette** (its visual identity),
 *  - an **ambience** profile (audio and particles),
 *  - a **hazard vocabulary** (which tile types the region is allowed to use),
 *  - a **tempo** (how densely rooms are populated),
 *  - an **ability gate** (what you need to get in),
 *  - and a **theme in the fiction**.
 *
 * Making all of that data means a region's identity is expressed in one place
 * and cannot drift as content is added — a room in the Cinderloom cannot
 * accidentally use frost tiles, because the generator and validator both read
 * `allowedHazards`.
 *
 * ## Design intent for the world map
 * The regions form a rough vertical stack around the central settlement, with
 * lateral connections that open as abilities are gained. The intent is that at
 * any point the player has **two or three** viable directions, never exactly
 * one (which is a corridor) and never seven (which is paralysis).
 */

import { Palette } from '../../engine/render/palette.js';
import { Ability } from '../player/abilities.js';
import { Tiles } from '../../engine/physics/tiles.js';

/**
 * @typedef {Object} BiomeDef
 * @property {string} id
 * @property {string} name
 * @property {string} subtitle Shown on the region title card.
 * @property {import('../../engine/render/palette.js').Palette} palette
 * @property {number} gate Ability mask required to enter meaningfully.
 * @property {number} depth Vertical position on the world map, 0 is highest.
 * @property {number[]} allowedHazards Tile ids this region may use.
 * @property {string} ambience Audio ambience id.
 * @property {string} music Music track id.
 * @property {number} density 0..1 enemy population density.
 * @property {number} difficulty 1..10, used to sanity-check enemy placement.
 * @property {boolean} [hidden] Not shown on the map until discovered.
 * @property {boolean} [optional] Not required to finish the game.
 * @property {string} theme One-line statement of the region's idea.
 * @property {string} lore Environmental-storytelling seed for room authoring.
 * @property {string[]} flora Decoration kinds the painter may use.
 * @property {string} [parallax] Background style id.
 */

/** @type {Map<string, BiomeDef>} */
export const BIOMES = new Map();

/**
 * @param {Omit<BiomeDef, 'palette'> & {palette: Omit<import('../../engine/render/palette.js').PaletteSpec, 'id'|'name'>}} def
 * @returns {BiomeDef}
 */
function defineBiome(def) {
  if (BIOMES.has(def.id)) throw new Error(`Duplicate biome "${def.id}"`);
  /** @type {BiomeDef} */
  const full = { ...def, palette: new Palette({ ...def.palette, id: def.id, name: def.name }) };
  BIOMES.set(def.id, full);
  return full;
}

// Hazard vocabularies, named so the intent is legible at each use site.
const BASIC = [Tiles.SPIKE, Tiles.CRUMBLE];
const WET = [Tiles.WATER, Tiles.SPIKE, Tiles.CRUMBLE];
const DEEP = [Tiles.AETHER, Tiles.SPIKE, Tiles.SPIKE_HEAVY, Tiles.CRUMBLE];

// ---------------------------------------------------------------------------

defineBiome({
  id: 'saltshallows',
  name: 'The Salt Shallows',
  subtitle: 'where the sea stopped and did not leave',
  depth: 1,
  gate: Ability.NONE,
  allowedHazards: [Tiles.SPIKE, Tiles.WATER, Tiles.CRUMBLE, Tiles.ONE_WAY],
  ambience: 'wind_thin',
  music: 'shallows',
  density: 0.3,
  difficulty: 1,
  theme: 'A gentle, wind-scoured opening that teaches movement without saying so.',
  lore: 'Salt flats bleached the colour of old paper. Whatever tide made these ripples '
    + 'has not moved in an age; the ripples are stone now, and the fish in them are stone too.',
  flora: ['saltgrass', 'crystal_tuft', 'bone_reed'],
  parallax: 'flats',
  palette: {
    terrain: ['#1b1c22', '#2f3038', '#4a4a52', '#6d6b70', '#94908f'],
    accent: '#e8dcc0',
    accentAlt: '#8fb3c4',
    fluid: '#3c6a7a',
    fog: '#12131a',
    light: '#e6e2d6',
    sky: '#0d0e14',
    ambient: 0.72,
    flora: ['#b9b2a0', '#8fb3c4'],
  },
});

defineBiome({
  id: 'quillrest',
  name: 'Quillrest',
  subtitle: 'the last desk still standing',
  depth: 2,
  gate: Ability.NONE,
  allowedHazards: [],
  ambience: 'town_murmur',
  music: 'quillrest',
  density: 0,
  difficulty: 1,
  theme: 'A safe hub whose warmth is the measure of everything outside it.',
  lore: 'A scriptorium built into a wrecked hull, then built onto, then built onto again. '
    + 'Nobody here agrees on what should be recorded. Everybody agrees that something should.',
  flora: ['lantern', 'paper_stack', 'ink_pot', 'hanging_sign'],
  parallax: 'interior',
  palette: {
    terrain: ['#221b18', '#3a2c25', '#54413a', '#6e594f', '#8f7565'],
    accent: '#f0c070',
    accentAlt: '#c78a4a',
    fluid: '#4a6a6a',
    fog: '#171110',
    light: '#ffd9a0',
    sky: '#120d0c',
    ambient: 0.85,
    flora: ['#f0c070', '#a8724a'],
  },
});

defineBiome({
  id: 'sunkenarchive',
  name: 'The Sunken Archive',
  subtitle: 'every word, and none of them dry',
  depth: 3,
  gate: Ability.NONE,
  allowedHazards: WET,
  ambience: 'drip',
  music: 'archive',
  density: 0.45,
  difficulty: 2,
  theme: 'Vertical stacks and flooded aisles; teaches wall work and verticality.',
  lore: 'Shelving that goes down further than it goes up. The water rose slowly enough '
    + 'that the archivists had time to reshelve everything by height rather than by subject.',
  flora: ['shelf', 'floating_page', 'kelp_ribbon', 'brass_lamp'],
  parallax: 'stacks',
  palette: {
    terrain: ['#141a20', '#1f2a36', '#2f4050', '#42596c', '#5c7488'],
    accent: '#7fd4d8',
    accentAlt: '#c9a86a',
    fluid: '#1d4a5c',
    fog: '#0a0e14',
    light: '#a8d8e0',
    sky: '#070a10',
    ambient: 0.5,
    flora: ['#4a8f8a', '#c9a86a'],
  },
});

defineBiome({
  id: 'verdigris',
  name: 'The Verdigris Waterworks',
  subtitle: 'copper remembers water longer than water remembers copper',
  depth: 4,
  gate: Ability.SKIM,
  allowedHazards: [Tiles.WATER, Tiles.SPIKE, Tiles.CONVEYOR_L, Tiles.CONVEYOR_R, Tiles.CRUMBLE],
  ambience: 'machinery_wet',
  music: 'verdigris',
  density: 0.5,
  difficulty: 3,
  theme: 'Moving surfaces and timed flows; the first region that moves while you do.',
  lore: 'Aqueducts that once fed the whole shelf, now feeding a green stain the size of a district. '
    + 'The valves still turn on schedule. There is nobody left who set the schedule.',
  flora: ['pipe', 'verdigris_bloom', 'valve_wheel', 'drip_chain'],
  parallax: 'pipes',
  palette: {
    terrain: ['#101a18', '#1b2e2a', '#2b4740', '#3f6155', '#5b8272'],
    accent: '#68e0a8',
    accentAlt: '#d0a860',
    fluid: '#2a6858',
    fog: '#08110f',
    light: '#9fe8c8',
    sky: '#060c0b',
    ambient: 0.55,
    flora: ['#68e0a8', '#3f8f70'],
  },
});

defineBiome({
  id: 'cinderloom',
  name: 'The Cinderloom',
  subtitle: 'the mill that wove the sky its colour',
  depth: 5,
  gate: Ability.UPDRAFTSAIL,
  allowedHazards: [Tiles.SEAR, Tiles.SPIKE_HEAVY, Tiles.UPDRAFT, Tiles.CRUMBLE, Tiles.CONVEYOR_R],
  ambience: 'forge_roar',
  music: 'cinderloom',
  density: 0.6,
  difficulty: 5,
  theme: 'Vertical wind columns and heat; movement becomes three-dimensional.',
  lore: 'Looms the size of streets, still turning on residual heat. They wove the aether into '
    + 'cloth once. The cloth is gone. The heat has not noticed.',
  flora: ['loom_arm', 'ember_vent', 'thread_spool', 'ash_drift'],
  parallax: 'furnace',
  palette: {
    terrain: ['#1e1210', '#381c16', '#57291d', '#7a3d26', '#a35a33'],
    accent: '#ff9a4a',
    accentAlt: '#ffd27a',
    fluid: '#8a3418',
    fog: '#150a08',
    light: '#ffb070',
    sky: '#0e0705',
    ambient: 0.62,
    flora: ['#ff9a4a', '#c05828'],
  },
});

defineBiome({
  id: 'glasswake',
  name: 'The Glasswake',
  subtitle: 'a wave that cooled before it broke',
  depth: 4,
  gate: Ability.GRIPSCRIPT,
  allowedHazards: [Tiles.SPIKE_HEAVY, Tiles.CRUMBLE, Tiles.ICE, Tiles.BREAKABLE],
  ambience: 'glass_chime',
  music: 'glasswake',
  density: 0.45,
  difficulty: 4,
  theme: 'Brittle, breakable terrain; the ground is a resource you spend.',
  lore: 'The basin fused where something very hot met something very wet, very fast. '
    + 'The Glasskin walk it barefoot and say the sound tells them where it is thin.',
  flora: ['glass_spire', 'prism_shard', 'fused_bloom'],
  parallax: 'prisms',
  palette: {
    terrain: ['#0f1420', '#1c2438', '#2c3a56', '#405275', '#5c7099'],
    accent: '#a8d8ff',
    accentAlt: '#e0b8ff',
    fluid: '#2a4a7a',
    fog: '#080b12',
    light: '#c8e4ff',
    sky: '#05070e',
    ambient: 0.58,
    flora: ['#a8d8ff', '#7a9fd0'],
  },
});

defineBiome({
  id: 'marrowterraces',
  name: 'The Marrow Terraces',
  subtitle: 'farmed on the ribs of something patient',
  depth: 6,
  gate: Ability.ANCHORBREAK,
  allowedHazards: [Tiles.BREAKABLE_HEAVY, Tiles.SPIKE, Tiles.CRUMBLE, Tiles.ONE_WAY],
  ambience: 'low_drone',
  music: 'marrow',
  density: 0.55,
  difficulty: 6,
  theme: 'Layered floors that must be broken through; progress is downward.',
  lore: 'Terraced fields cut into a fossil so large that the Marrowfolk call each vertebra a county. '
    + 'They grow pale crops in the calcium and do not ask what it was.',
  flora: ['bone_arch', 'pale_crop', 'marrow_lantern', 'root_web'],
  parallax: 'bones',
  palette: {
    terrain: ['#1a1817', '#2e2a26', '#474038', '#63594c', '#857866'],
    accent: '#e8dcc8',
    accentAlt: '#b0d090',
    fluid: '#4a5040',
    fog: '#100e0d',
    light: '#e0d8c0',
    sky: '#0a0908',
    ambient: 0.48,
    flora: ['#b0d090', '#7a8f60'],
  },
});

defineBiome({
  id: 'weepinggallery',
  name: 'The Weeping Gallery',
  subtitle: 'rain that has been falling since before the fall',
  depth: 3,
  gate: Ability.PAPERWING,
  allowedHazards: [Tiles.WATER, Tiles.SPIKE, Tiles.ONE_WAY, Tiles.CRUMBLE],
  ambience: 'rain',
  music: 'gallery',
  density: 0.5,
  difficulty: 4,
  theme: 'Wide vertical faces under permanent rain; the double jump\'s playground.',
  lore: 'A cliff of terraced gardens that drinks a rain nobody can find the source of. '
    + 'The plants here are the only things in Aetherweir that are certainly still alive.',
  flora: ['hanging_vine', 'rain_flower', 'stone_bench', 'runoff'],
  parallax: 'rain',
  palette: {
    terrain: ['#121a19', '#1e2e2c', '#2e4642', '#42605a', '#5c7f76'],
    accent: '#b8f0d0', accentAlt: '#f0e0a0',
    fluid: '#2a5a58',
    fog: '#0a1010',
    light: '#cfeee0',
    sky: '#060c0c',
    ambient: 0.6,
    flora: ['#b8f0d0', '#6fae90'],
  },
});

defineBiome({
  id: 'umbralfen',
  name: 'The Umbral Fen',
  subtitle: 'light is a visitor here and does not stay',
  depth: 5,
  gate: Ability.PALIMPSEST,
  allowedHazards: [Tiles.BRINE, Tiles.SPIKE, Tiles.CRUMBLE, Tiles.TAR],
  ambience: 'bog',
  music: 'fen',
  density: 0.5,
  difficulty: 6,
  theme: 'Near-total darkness; the region where seeing is the challenge.',
  lore: 'A bog that grew over a spill of something that was never meant to leave its vessel. '
    + 'The Marrowfolk map it by sound. Nobody maps it twice the same way.',
  flora: ['pale_fungus', 'sunken_post', 'wisp', 'reed_clump'],
  parallax: 'dark',
  palette: {
    terrain: ['#0a0d12', '#12181f', '#1d242e', '#2a333f', '#3a4553'],
    accent: '#8f7fd8',
    accentAlt: '#5fc0a0',
    fluid: '#1a2430',
    fog: '#04060a',
    light: '#6f7fa8',
    sky: '#020306',
    ambient: 0.16,
    flora: ['#8f7fd8', '#4a5f7a'],
  },
});

defineBiome({
  id: 'clockspill',
  name: 'The Clockspill',
  subtitle: 'where the hour broke and ran out',
  depth: 6,
  gate: Ability.LINECAST,
  allowedHazards: [Tiles.SPIKE_HEAVY, Tiles.CRUMBLE, Tiles.CONVEYOR_L, Tiles.CONVEYOR_R, Tiles.GATE],
  ambience: 'ticking',
  music: 'clockspill',
  density: 0.6,
  difficulty: 7,
  theme: 'Rooms on timers and rotating geometry; the region that will not wait.',
  lore: 'The engine that kept the shelf\'s calendar, opened like a dropped watch. '
    + 'Its gears still turn, but no two of them agree on what time it is.',
  flora: ['gear', 'pendulum', 'broken_spring', 'escapement'],
  parallax: 'gears',
  palette: {
    terrain: ['#171410', '#2a2419', '#3f3624', '#584a30', '#786440'],
    accent: '#ffd86a',
    accentAlt: '#8fd0ff',
    fluid: '#4a4020',
    fog: '#0d0b08',
    light: '#ffe8b0',
    sky: '#080705',
    ambient: 0.55,
    flora: ['#ffd86a', '#a08040'],
  },
});

defineBiome({
  id: 'auricdeep',
  name: 'The Auric Deep',
  subtitle: 'drowned in the only thing worth drowning in',
  depth: 8,
  gate: Ability.MENISCUS,
  allowedHazards: [Tiles.AETHER, Tiles.SPIKE_HEAVY, Tiles.BRINE],
  ambience: 'submerged',
  music: 'auric',
  density: 0.5,
  difficulty: 8,
  theme: 'Fully submerged; movement rules change entirely.',
  lore: 'The lowest cistern, filled to its ceiling with aether gone thick and gold. '
    + 'Things swim in it that were built to stand.',
  flora: ['gold_frond', 'sunken_statue', 'bubble_vent'],
  parallax: 'deep',
  palette: {
    terrain: ['#1a1508', '#2e2410', '#463618', '#614c22', '#82662e'],
    accent: '#ffd070',
    accentAlt: '#fff0c0',
    fluid: '#8a6a1a',
    fog: '#0e0b04',
    light: '#ffe8a0',
    sky: '#080602',
    ambient: 0.45,
    flora: ['#ffd070', '#b08830'],
  },
});

defineBiome({
  id: 'ashenspire',
  name: 'The Ashen Spire',
  subtitle: 'the only thing still pointing up',
  depth: 2,
  gate: Ability.SKYSKIM,
  allowedHazards: [Tiles.SPIKE_HEAVY, Tiles.CRUMBLE, Tiles.UPDRAFT, Tiles.ICE],
  ambience: 'high_wind',
  music: 'spire',
  density: 0.55,
  difficulty: 8,
  theme: 'A single enormous vertical climb; the region that is one long ascent.',
  lore: 'A tower that survived the fall by being narrow enough to fall *through* the sky '
    + 'rather than against it. The wind at the top says something. Nobody agrees what.',
  flora: ['ash_banner', 'broken_bell', 'wind_chime', 'nest'],
  parallax: 'sky',
  palette: {
    terrain: ['#181820', '#2a2b36', '#3e404e', '#565968', '#737687'],
    accent: '#ffb0b0',
    accentAlt: '#b0c8ff',
    fluid: '#3a4050',
    fog: '#0c0c12',
    light: '#e8e0f0',
    sky: '#141428',
    ambient: 0.7,
    flora: ['#ffb0b0', '#8f90a8'],
  },
});

defineBiome({
  id: 'lastweir',
  name: 'The Last Weir',
  subtitle: 'the hand still holding',
  depth: 9,
  gate: Ability.DEEPWELL,
  allowedHazards: [Tiles.AETHER, Tiles.SPIKE_HEAVY, Tiles.SEAR, Tiles.GATE, Tiles.CRUMBLE],
  ambience: 'pressure',
  music: 'lastweir',
  density: 0.65,
  difficulty: 10,
  theme: 'The endgame: every movement verb, used at once, under pressure.',
  lore: 'The final dam. Behind it, everything that has not yet happened to Aetherweir. '
    + 'The Weirwrights built it to hold for a century. That was some time ago.',
  flora: ['sluice', 'warning_glyph', 'strain_crack', 'pressure_gauge'],
  parallax: 'weir',
  palette: {
    terrain: ['#0d1114', '#18202a', '#243040', '#334458', '#455a74'],
    accent: '#70e0ff',
    accentAlt: '#ff7070',
    fluid: '#1a4a68',
    fog: '#060809',
    light: '#a0e0ff',
    sky: '#030507',
    ambient: 0.5,
    flora: ['#70e0ff', '#3f7f9f'],
  },
});

// --- Hidden and optional regions -------------------------------------------

defineBiome({
  id: 'blankmargin',
  name: 'The Blank Margin',
  subtitle: 'the space left for a reader who never came',
  depth: 0,
  gate: Ability.BLOTSTEP | Ability.PALIMPSEST,
  allowedHazards: [Tiles.PHASE_WALL, Tiles.SPIKE_HEAVY],
  ambience: 'silence',
  music: 'margin',
  density: 0.3,
  difficulty: 9,
  hidden: true,
  optional: true,
  theme: 'A white void of unwritten geometry; the rules of the world, visible.',
  lore: 'Not a place. The part of the page that was never filled in. '
    + 'Standing in it, you can hear the pen that stopped.',
  flora: ['guideline', 'erasure', 'margin_note'],
  parallax: 'blank',
  palette: {
    terrain: ['#e8e6e0', '#d8d4cc', '#c4bfb4', '#aaa499', '#8e877b'],
    accent: '#2a2620',
    accentAlt: '#8a3030',
    fluid: '#c0bcb0',
    fog: '#f4f2ec',
    light: '#ffffff',
    sky: '#f8f6f0',
    ambient: 1,
    flora: ['#8a8478', '#2a2620'],
  },
});

defineBiome({
  id: 'inkbelow',
  name: 'The Ink Below',
  subtitle: 'what was struck out, and where it went',
  depth: 11,
  gate: Ability.BLOTSTEP,
  allowedHazards: [Tiles.SEAR, Tiles.SPIKE_HEAVY, Tiles.BRINE, Tiles.CRUMBLE],
  ambience: 'abyss',
  music: 'inkbelow',
  density: 0.7,
  difficulty: 10,
  hidden: true,
  optional: true,
  theme: 'The optional abyss: the game\'s hardest platforming, no checkpoints.',
  lore: 'Every word the world deleted had to go somewhere. It went down. '
    + 'It is still down there, and it is still a word.',
  flora: ['blot', 'strikethrough', 'drowned_glyph'],
  parallax: 'void',
  palette: {
    terrain: ['#07070a', '#0e0e14', '#161620', '#20202c', '#2c2c3a'],
    accent: '#c04070',
    accentAlt: '#4060c0',
    fluid: '#0a0a12',
    fog: '#000000',
    light: '#5040a0',
    sky: '#000000',
    ambient: 0.12,
    flora: ['#c04070', '#302848'],
  },
});

defineBiome({
  id: 'ninestrokes',
  name: 'The Trial of Nine Strokes',
  subtitle: 'nine, and then the tenth',
  depth: 7,
  gate: Ability.SKIM | Ability.PAPERWING | Ability.GRIPSCRIPT,
  allowedHazards: [Tiles.SPIKE_HEAVY, Tiles.GATE],
  ambience: 'arena',
  music: 'trial',
  density: 1,
  difficulty: 10,
  optional: true,
  theme: 'A pure combat gauntlet for players who want to prove something.',
  lore: 'A ring cut into the floor of an old lecture hall. The Scriveners settled disputes here '
    + 'by demonstration. Most disputes were about whether the ring was necessary.',
  flora: ['banner', 'scored_floor', 'spectator_bench'],
  parallax: 'arena',
  palette: {
    terrain: ['#1a1418', '#2c2028', '#403040', '#584458', '#725c72'],
    accent: '#ff70a0',
    accentAlt: '#ffd070',
    fluid: '#402038',
    fog: '#0e0a0c',
    light: '#ffd0e0',
    sky: '#080608',
    ambient: 0.6,
    flora: ['#ff70a0', '#9f5070'],
  },
});

/**
 * @param {string} id
 * @returns {BiomeDef}
 */
export function getBiome(id) {
  const b = BIOMES.get(id);
  if (!b) throw new Error(`Unknown biome "${id}"`);
  return b;
}

/** @returns {BiomeDef[]} */
export function allBiomes() {
  return [...BIOMES.values()];
}

/** @returns {BiomeDef[]} regions required to finish the game */
export function requiredBiomes() {
  return allBiomes().filter((b) => !b.optional);
}
