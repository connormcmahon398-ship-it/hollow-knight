/**
 * @file Hand-authored rooms: The Salt Shallows and Quillrest.
 *
 * ## Level-design intent for the opening region
 * These rooms teach the whole movement vocabulary without a single tutorial
 * prompt, in the standard order: **safe → demonstrate → practise → test**.
 *
 * - `shallows_01` is a flat, quiet room with one obvious exit. It exists so the
 *   player can discover that the buttons do things without any consequence.
 * - `shallows_02` puts two gaps in the floor: the first generous, the second
 *   exactly one jump wide, so the jump's range is learned by doing.
 * - `shallows_03` places the first enemy on ground the player approaches at
 *   their own pace, with a ledge to retreat to.
 * - `shallows_04` has a low ceiling and a flyer, so the up-slash is discovered
 *   as the obvious answer rather than taught as a fact.
 * - `shallows_05` is the first Wellspring and Gatestone, and the first branch:
 *   onward, or upward.
 * - `shallows_06` is a dead end *until* Skim, with the far side visible from
 *   the safe side. A gate you can see through is a promise; one you cannot is
 *   just a wall.
 *
 * ## Room dimensions
 * Every room is 30x17 tiles, exactly one screen at the internal resolution.
 * Row 0 is the ceiling, rows 14-16 the floor slab, and rows 12-13 are the
 * standing-height band where side doorways go. Keeping that contract means a
 * doorway is always somewhere the player can walk into.
 *
 * Glyphs are defined in `engine/physics/tiles.js`:
 *   `#` solid  `.` empty  `-` one-way  `^` spike  `~` water  `,` backdrop
 *   `/ \` ramps  `@` spawn  `e` enemy  `W` Wellspring  `?` inscription
 *   `I` item  `G` Gatestone  `B` boss  `n` NPC
 */

import { defineRooms } from '../../world/room.js';

defineRooms([
  {
    id: 'shallows_01',
    name: 'The Waking Flat',
    biome: 'saltshallows',
    worldX: 0,
    worldY: 0,
    lore: 'Where the Quill wakes. Nothing here can hurt anything.',
    art: [
      '##############################',
      '#............................#',
      '#............................#',
      '#............................#',
      '#............................#',
      '#............................#',
      '#............................#',
      '#............................#',
      '#..........@.................#',
      '#............................#',
      '#..................?.........#',
      '#........####................#',
      '#......########...............',
      '#.....##########..............',
      '###############################',
      '##############################',
      '##############################',
    ],
    markers: { '?': 'salt_03' },
    exits: [{ edge: 'right', offset: 12, span: 2, to: 'shallows_02' }],
  },

  {
    id: 'shallows_02',
    name: 'The First Measure',
    biome: 'saltshallows',
    worldX: 1,
    worldY: 0,
    lore: 'Two gaps. The first is generous. The second is exactly a jump.',
    art: [
      '##############################',
      '#............................#',
      '#............................#',
      '#............................#',
      '#............................#',
      '#............................#',
      '#............................#',
      '#............................#',
      '#............................#',
      '#........................e...#',
      '#............................#',
      '#............................#',
      '..............................',
      '..............................',
      '#####.......########.....#####',
      '#####.......########.....#####',
      '##############################',
    ],
    markers: { e: 'saltplodder' },
    exits: [
      { edge: 'left', offset: 12, span: 2, to: 'shallows_01' },
      { edge: 'right', offset: 12, span: 2, to: 'shallows_03' },
    ],
  },

  {
    id: 'shallows_03',
    name: 'The Ridge',
    biome: 'saltshallows',
    worldX: 2,
    worldY: 0,
    lore: 'The first thing that objects to you. A ledge to retreat to.',
    art: [
      '##############################',
      '#............................#',
      '#............................#',
      '#............................#',
      '#............................#',
      '#.......e....................#',
      '#....########................#',
      '#....########................#',
      '#............................#',
      '#....................e.......#',
      '#............................#',
      '#..............#########.....#',
      '...............#########......',
      '..............................',
      '##############################',
      '##############################',
      '##############################',
    ],
    markers: { e: ['saltplodder', 'brinehopper'] },
    exits: [
      { edge: 'left', offset: 12, span: 2, to: 'shallows_02' },
      { edge: 'right', offset: 12, span: 2, to: 'shallows_04' },
    ],
  },

  {
    id: 'shallows_04',
    name: 'The Low Ceiling',
    biome: 'saltshallows',
    worldX: 3,
    worldY: 0,
    lore: 'A flyer, and a roof low enough that the answer is upward.',
    art: [
      '##############################',
      '##############################',
      '##############################',
      '##############################',
      '#............................#',
      '#............................#',
      '#.........e..................#',
      '#............................#',
      '#............................#',
      '#............................#',
      '#..............?.............#',
      '#............................#',
      '..............................',
      '..............................',
      '##############################',
      '##############################',
      '##############################',
    ],
    markers: { e: 'tidemote', '?': 'salt_01' },
    exits: [
      { edge: 'left', offset: 12, span: 2, to: 'shallows_03' },
      { edge: 'right', offset: 12, span: 2, to: 'shallows_05' },
    ],
  },

  {
    id: 'shallows_05',
    name: 'The Standing Well',
    biome: 'saltshallows',
    worldX: 4,
    worldY: 0,
    isSafe: true,
    lore: 'The first Wellspring. Rest here; the ink remembers this moment.',
    art: [
      '##############################',
      '#............................#',
      '#..,,,,,,,,,,,,,,,,,,,,,,,,..#',
      '#..,,,,,,,,,,,,,,,,,,,,,,,,..#',
      '#............................#',
      '#.....--------...............#',
      '#............................#',
      '#............................#',
      '#..........--------..........#',
      '#............................#',
      '#............................#',
      '#............................#',
      '..............................',
      '........W...........G.........',
      '##############################',
      '##############################',
      '##############################',
    ],
    markers: { W: 'wellspring_shallows', G: 'gate_shallows' },
    exits: [
      { edge: 'left', offset: 12, span: 2, to: 'shallows_04' },
      { edge: 'right', offset: 12, span: 2, to: 'shallows_06' },
      { edge: 'top', offset: 22, span: 3, to: 'shallows_07' },
    ],
  },

  {
    id: 'shallows_06',
    name: 'The Long Refusal',
    biome: 'saltshallows',
    worldX: 5,
    worldY: 0,
    lore: 'The far side is visible from the safe side. That is the whole point.',
    art: [
      '##############################',
      '#............................#',
      '#............................#',
      '#............................#',
      '#............................#',
      '#............................#',
      '#............................#',
      '#............................#',
      '#............................#',
      '#............................#',
      '#............................#',
      '#............................#',
      '..............................',
      '..............................',
      '######................########',
      '######^^^^^^^^^^^^^^^^########',
      '##############################',
    ],
    markers: {},
    exits: [
      { edge: 'left', offset: 12, span: 2, to: 'shallows_05' },
      { edge: 'right', offset: 12, span: 2, to: 'shallows_boss', gate: 'skim' },
    ],
  },

  {
    id: 'shallows_07',
    name: 'The Raised Shelf',
    biome: 'saltshallows',
    worldX: 4,
    worldY: -1,
    lore: 'Upward, and the first thing worth taking.',
    art: [
      '##############################',
      '#............................#',
      '#.......I..I.................#',
      '#.......########.............#',
      '#.......########.............#',
      '#............................#',
      '#............................#',
      '#..................e.........#',
      '#...............#########....#',
      '#...............#########....#',
      '#............................#',
      '#...e........................#',
      '#............................#',
      '#............................#',
      '#####.....................####',
      '#####.....................####',
      '##############################',
    ],
    markers: {
      // Skim sits here, one room above the Wellspring and reachable without
      // it, because the door it opens is two rooms further on. An ability
      // gated behind the door it unlocks is an unwinnable world.
      I: ['ability_skim', 'etch_filament_1'],
      e: ['shalecrab', 'tidemote'],
    },
    exits: [{ edge: 'bottom', offset: 22, span: 3, to: 'shallows_05' }],
  },

  {
    id: 'shallows_boss',
    name: 'The Turning Place',
    biome: 'saltshallows',
    worldX: 6,
    worldY: 0,
    isBossArena: true,
    lore: 'It was set here to turn back the tide. The tide stopped coming.',
    art: [
      '##############################',
      '#............................#',
      '#............................#',
      '#............................#',
      '#............................#',
      '#............................#',
      '#............................#',
      '#............................#',
      '#............................#',
      '#............................#',
      '#..................B.........#',
      '#............................#',
      '..............................',
      '..............................',
      '##############################',
      '##############################',
      '##############################',
    ],
    markers: { B: 'saltwarden' },
    exits: [
      { edge: 'left', offset: 12, span: 2, to: 'shallows_06' },
      { edge: 'right', offset: 12, span: 2, to: 'shallows_08', requiresFlag: 'boss:saltwarden' },
    ],
  },

  {
    id: 'shallows_08',
    name: 'The Road to Quillrest',
    biome: 'saltshallows',
    worldX: 7,
    worldY: 0,
    lore: 'Somebody has swept this. Recently.',
    art: [
      '##############################',
      '#............................#',
      '#............................#',
      '#............................#',
      '#.........?..................#',
      '#............................#',
      '#............................#',
      '#............................#',
      '#..................e.........#',
      '#............................#',
      '#............................#',
      '#............................#',
      '..............................',
      '........../########\\..........',
      '#......../##########\\........#',
      '#######/##############\\#######',
      '##############################',
    ],
    markers: { '?': 'salt_02', e: 'brinehopper' },
    exits: [
      { edge: 'left', offset: 12, span: 2, to: 'shallows_boss' },
      { edge: 'right', offset: 12, span: 2, to: 'quillrest_01' },
    ],
  },

  {
    id: 'quillrest_01',
    name: 'Quillrest, the Outer Desk',
    biome: 'quillrest',
    worldX: 8,
    worldY: 0,
    isSafe: true,
    lore: 'A scriptorium built into a wrecked hull, then built onto, then built onto again.',
    art: [
      '##############################',
      '#............................#',
      '#..,,,,,,,,,,,,,,,,,,,,,,,,..#',
      '#..,,,,,,,,,,,,,,,,,,,,,,,,..#',
      '#..,,,,,,,,,,,,,,,,,,,,,,,,..#',
      '#............................#',
      '#............................#',
      '#............................#',
      '#............................#',
      '#............................#',
      '#............................#',
      '#............................#',
      '....W.....?.....n......n.....#',
      '.............................#',
      '##############################',
      '##############################',
      '##############################',
    ],
    markers: {
      W: 'wellspring_quillrest',
      '?': 'quill_02',
      n: ['npc_warden', 'npc_cassiar'],
    },
    exits: [{ edge: 'left', offset: 12, span: 2, to: 'shallows_08' }],
  },
]);
