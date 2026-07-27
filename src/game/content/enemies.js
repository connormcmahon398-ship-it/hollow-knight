/**
 * @file The bestiary of Aetherweir — 66 original creatures.
 *
 * ## How to read an entry
 * Each creature binds an **archetype** (its behaviour) to **stats** (its
 * threat), a **visual** record (how the painter draws it) and **lore** (its
 * bestiary entry). Nothing here is a re-skin for its own sake: every creature
 * either occupies a different point in the difficulty curve of its archetype,
 * or combines an archetype with a biome hazard in a way that changes how it
 * plays.
 *
 * ## Difficulty discipline
 * `health` and `damage` are kept on a deliberate curve. With a 5-filament
 * player, contact damage of 1 is the standard; 2 is a serious threat reserved
 * for mid-game onward; 3 appears only in the final two regions and in optional
 * content. A creature that deals 2 in the first region would not be difficult,
 * it would be a mistake.
 *
 * The `visual` record is deliberately abstract — `form`, `limbs`, `eyes`,
 * colours — because the painter builds every creature from procedural shapes.
 * There are no image assets anywhere in this project.
 */

import { defineEnemies } from '../enemy/enemy.js';
import '../enemy/archetypes.js';

/**
 * Small helper so definitions stay readable: fills in the fields that are the
 * same for most creatures.
 * @param {any} def
 * @returns {any}
 */
function e(def) {
  return {
    aggroRange: 150,
    attackRange: 30,
    glyphs: Math.max(1, Math.round((def.health ?? 4) * 1.4)),
    inkDrop: 0,
    tags: [],
    ...def,
    visual: { form: 'blob', eyes: 2, ...(def.visual ?? {}) },
  };
}

defineEnemies([
  // =========================================================================
  // THE SALT SHALLOWS — the teaching set. Slow, legible, forgiving.
  // =========================================================================
  e({
    id: 'saltplodder', name: 'Salt Plodder', archetype: 'walker', biome: 'saltshallows',
    health: 3, damage: 1, width: 14, height: 14, speed: 26,
    visual: { form: 'crust', color: '#8f8878', accent: '#e8dcc0', eyes: 2, shellPlates: 3 },
    lore: 'A crust of salt that learned to walk by being walked on. It does not hurry, '
      + 'and it has never needed to.',
    tags: ['ground', 'basic'],
  }),
  e({
    id: 'tidemote', name: 'Tidemote', archetype: 'flyer', biome: 'saltshallows',
    health: 2, damage: 1, width: 10, height: 10, speed: 52, flying: true,
    params: { amplitude: 14, diveRange: 52, windup: 0.5, cooldown: 2 },
    visual: { form: 'mote', color: '#a8c8d8', accent: '#e8f4ff', eyes: 1, glow: 0.6 },
    lore: 'A drop of the old sea that refused to settle. It circles anything warm.',
    tags: ['aerial', 'basic'],
  }),
  e({
    id: 'brinehopper', name: 'Brine Hopper', archetype: 'jumper', biome: 'saltshallows',
    health: 3, damage: 1, width: 12, height: 11, speed: 40,
    params: { jumpPower: 250, jumpDistance: 90, restTime: 1.1 },
    visual: { form: 'hopper', color: '#7f9f9f', accent: '#cfe8e8', eyes: 2, legs: 2 },
    lore: 'Hops in the direction of the loudest thing. Frequently this is itself.',
    tags: ['ground', 'basic'],
  }),
  e({
    id: 'shalecrab', name: 'Shale Crab', archetype: 'shielded', biome: 'saltshallows',
    health: 5, damage: 1, width: 16, height: 12, speed: 28, poise: 22,
    params: { windup: 0.5, recovery: 0.7, cooldown: 2 },
    visual: { form: 'crab', color: '#6f6a5c', accent: '#b0a890', eyes: 2, legs: 6, shell: true },
    lore: 'Presents its plate to whatever approaches. Its back has never been reinforced, '
      + 'on the reasoning that nothing polite would go there.',
    tags: ['ground', 'armoured'],
  }),
  e({
    id: 'flatsdrifter', name: 'Flats Drifter', archetype: 'drifter', biome: 'saltshallows',
    health: 6, damage: 1, width: 18, height: 18, speed: 0, flying: true,
    params: { amplitudeX: 70, amplitudeY: 12, speed: 0.5 },
    visual: { form: 'jelly', color: '#9fb8c0', accent: '#dff0f8', eyes: 0, translucent: true },
    lore: 'Moves on a current that stopped blowing before the fall. Nobody has told it.',
    tags: ['aerial', 'hazard'],
  }),
  e({
    id: 'pagemite', name: 'Pagemite', archetype: 'swarm', biome: 'saltshallows',
    health: 1, damage: 1, width: 7, height: 7, speed: 88, flying: true, glyphs: 1,
    params: { orbitRadius: 16, chaseOrbit: 22, orbitSpeed: 3.6 },
    visual: { form: 'mite', color: '#d8ccb0', accent: '#fff8e0', eyes: 1 },
    lore: 'Eats margins. Travels in the dozens. Individually, an inconvenience.',
    tags: ['aerial', 'swarm'],
  }),

  // =========================================================================
  // THE SUNKEN ARCHIVE — verticality and ranged pressure.
  // =========================================================================
  e({
    id: 'shelfwarden', name: 'Shelf Warden', archetype: 'walker', biome: 'sunkenarchive',
    health: 6, damage: 1, width: 14, height: 20, speed: 34,
    params: { chaseSpeed: 68 },
    visual: { form: 'warden', color: '#3f5a68', accent: '#7fd4d8', eyes: 3, tall: true },
    lore: 'Still reshelving. Its list was long and it has not been amended.',
    tags: ['ground'],
  }),
  e({
    id: 'inkleech', name: 'Ink Leech', archetype: 'ambusher', biome: 'sunkenarchive',
    health: 4, damage: 1, width: 11, height: 13, speed: 44,
    params: { triggerWidth: 24, windup: 0.3, dropGravity: 1.7 },
    visual: { form: 'leech', color: '#22303a', accent: '#5fa8b8', eyes: 4 },
    lore: 'Hangs above the aisles and drops on anything carrying ink. You are carrying ink.',
    tags: ['ceiling', 'ambush'],
  }),
  e({
    id: 'marginalia', name: 'Marginalia', archetype: 'turret', biome: 'sunkenarchive',
    health: 5, damage: 1, width: 12, height: 12, speed: 0,
    params: { windup: 0.55, cooldown: 2.1, projectileSpeed: 118, burst: 1 },
    visual: { form: 'eye', color: '#2f4050', accent: '#c9a86a', eyes: 1, glow: 0.8 },
    lore: 'A note somebody wrote in the margin, in a hand that pressed hard enough to matter.',
    tags: ['ranged', 'static'],
  }),
  e({
    id: 'foliomoth', name: 'Foliomoth', archetype: 'flyer', biome: 'sunkenarchive',
    health: 4, damage: 1, width: 14, height: 12, speed: 70, flying: true,
    params: { amplitude: 22, diveSpeed: 190, diveRange: 70, cooldown: 1.5 },
    visual: { form: 'moth', color: '#5c7488', accent: '#a8d8e0', eyes: 2, wings: 4 },
    lore: 'Wings of overlapping pages. It will not settle where it can be read.',
    tags: ['aerial'],
  }),
  e({
    id: 'stacktoppler', name: 'Stack Toppler', archetype: 'charger', biome: 'sunkenarchive',
    health: 8, damage: 1, width: 18, height: 18, speed: 32,
    params: { chargeSpeed: 215, windup: 0.6, cooldown: 1.7 },
    visual: { form: 'bull', color: '#42596c', accent: '#7fd4d8', eyes: 2, horns: 2 },
    lore: 'It was built to move shelving. There is no shelving left that it approves of.',
    tags: ['ground', 'charger'],
  }),
  e({
    id: 'drownedclerk', name: 'Drowned Clerk', archetype: 'stalker', biome: 'sunkenarchive',
    health: 7, damage: 1, width: 13, height: 19, speed: 22,
    params: { stalkSpeed: 2.6, cooldown: 1.6 },
    visual: { form: 'humanoid', color: '#1f2a36', accent: '#7fd4d8', eyes: 2, robe: true },
    lore: 'Will not approach while observed. Its work was always meant to go unnoticed.',
    tags: ['ground', 'stalker'],
  }),
  e({
    id: 'gutterworm', name: 'Gutter Worm', archetype: 'burrower', biome: 'sunkenarchive',
    health: 6, damage: 1, width: 13, height: 16, speed: 0,
    params: { surfaceRange: 58, exposeTime: 1.4 },
    visual: { form: 'worm', color: '#2c3a44', accent: '#9fd0d8', eyes: 0, segments: 4 },
    lore: 'Lives in the gutter between pages, which in this building is a corridor.',
    tags: ['ground', 'burrow'],
  }),

  // =========================================================================
  // VERDIGRIS WATERWORKS — machinery, timing, conveyors.
  // =========================================================================
  e({
    id: 'valveturner', name: 'Valve Turner', archetype: 'walker', biome: 'verdigris',
    health: 8, damage: 1, width: 15, height: 18, speed: 38,
    params: { chaseSpeed: 82 },
    visual: { form: 'automaton', color: '#2b4740', accent: '#68e0a8', eyes: 2, brass: true },
    lore: 'Turns valves on a schedule. Considers you a valve that has moved.',
    tags: ['ground', 'automaton'],
  }),
  e({
    id: 'sluicehound', name: 'Sluice Hound', archetype: 'charger', biome: 'verdigris',
    health: 7, damage: 1, width: 18, height: 13, speed: 44,
    params: { chargeSpeed: 260, windup: 0.42, cooldown: 1.3, chargeTime: 0.95 },
    visual: { form: 'hound', color: '#1b2e2a', accent: '#68e0a8', eyes: 2, legs: 4 },
    lore: 'Follows the flow. Where the flow stops, it does not.',
    tags: ['ground', 'charger'],
  }),
  e({
    id: 'copperspitter', name: 'Copper Spitter', archetype: 'lobber', biome: 'verdigris',
    health: 6, damage: 1, width: 14, height: 14, speed: 24,
    params: { cooldown: 2.2, projectileGravity: 500, horizontalSpeed: 105 },
    visual: { form: 'kettle', color: '#3f6155', accent: '#d0a860', eyes: 2, spout: true },
    lore: 'Boils continuously and vents the difference at whatever is nearest.',
    tags: ['ranged'],
  }),
  e({
    id: 'pipestrider', name: 'Pipestrider', archetype: 'walker', biome: 'verdigris',
    health: 5, damage: 1, width: 20, height: 16, speed: 62, ignoresLedges: true,
    visual: { form: 'strider', color: '#2b4740', accent: '#9fe8c8', eyes: 4, legs: 6, thin: true },
    lore: 'Walks the pipes on six thin legs and will happily walk off one.',
    tags: ['ground', 'fast'],
  }),
  e({
    id: 'greenbloom', name: 'Greenbloom', archetype: 'turret', biome: 'verdigris',
    health: 7, damage: 1, width: 16, height: 16, speed: 0,
    params: { burst: 3, spread: 0.7, cooldown: 2.6, projectileSpeed: 100, windup: 0.6 },
    visual: { form: 'flower', color: '#2b4740', accent: '#68e0a8', eyes: 0, petals: 5 },
    lore: 'Verdigris that took a shape. It has opinions about being approached.',
    tags: ['ranged', 'static'],
  }),
  e({
    id: 'drainswimmer', name: 'Drain Swimmer', archetype: 'flyer', biome: 'verdigris',
    health: 5, damage: 1, width: 15, height: 9, speed: 92, flying: true,
    params: { amplitude: 10, frequency: 3, diveSpeed: 210, cooldown: 1.2, diveRange: 80 },
    visual: { form: 'eel', color: '#1b2e2a', accent: '#68e0a8', eyes: 2, segments: 5 },
    lore: 'Swims through air as readily as water, having never been told the difference.',
    tags: ['aerial', 'fast'],
  }),
  e({
    id: 'gasketmite', name: 'Gasket Mite', archetype: 'splitter', biome: 'verdigris',
    health: 6, damage: 1, width: 16, height: 14, speed: 42,
    params: { respectLedges: true },
    visual: { form: 'gasket', color: '#3f6155', accent: '#d0a860', eyes: 3 },
    lore: 'Seals leaks by becoming two smaller leaks.',
    tags: ['ground', 'splitter'],
    onDeath: (enemy) => {
      enemy.bus?.queue('enemy:spawnRequest', {
        id: 'gasketchip', count: 2, x: enemy.body.box.centerX, y: enemy.body.box.centerY, scatter: 40,
      });
    },
  }),
  e({
    id: 'gasketchip', name: 'Gasket Chip', archetype: 'splitter', biome: 'verdigris',
    health: 2, damage: 1, width: 9, height: 8, speed: 74, glyphs: 1,
    visual: { form: 'gasket', color: '#3f6155', accent: '#d0a860', eyes: 1, small: true },
    lore: 'What is left when a seal fails twice.',
    tags: ['ground', 'swarm'],
  }),

  // =========================================================================
  // THE GLASSWAKE — brittle terrain, reflection, precision.
  // =========================================================================
  e({
    id: 'shardwalker', name: 'Shardwalker', archetype: 'walker', biome: 'glasswake',
    health: 8, damage: 1, width: 14, height: 19, speed: 44,
    params: { chaseSpeed: 92 },
    visual: { form: 'crystal', color: '#2c3a56', accent: '#a8d8ff', eyes: 2, facets: 5 },
    lore: 'Glass that walks. Where it steps, the ground remembers being liquid.',
    tags: ['ground'],
  }),
  e({
    id: 'prismleaper', name: 'Prism Leaper', archetype: 'jumper', biome: 'glasswake',
    health: 6, damage: 1, width: 13, height: 13, speed: 52,
    params: { jumpPower: 340, jumpDistance: 140, restTime: 0.7, windup: 0.24 },
    visual: { form: 'prism', color: '#405275', accent: '#e0b8ff', eyes: 2, facets: 3 },
    lore: 'Refracts as it moves, so you are never quite hitting where it is.',
    tags: ['ground', 'fast'],
  }),
  e({
    id: 'mirrorfetch', name: 'Mirror Fetch', archetype: 'mirror', biome: 'glasswake',
    health: 10, damage: 2, width: 13, height: 20, speed: 60, poise: 30,
    params: { standoff: 46, counterRange: 62, cooldown: 1.1 },
    visual: { form: 'humanoid', color: '#1c2438', accent: '#a8d8ff', eyes: 2, reflective: true },
    lore: 'Shows you a shape you recognise and then does what you were about to.',
    tags: ['ground', 'counter'],
  }),
  e({
    id: 'chimeswarm', name: 'Chime Swarm', archetype: 'swarm', biome: 'glasswake',
    health: 2, damage: 1, width: 8, height: 8, speed: 108, flying: true, glyphs: 2,
    params: { chaseOrbit: 30, orbitSpeed: 4.4 },
    visual: { form: 'chime', color: '#5c7099', accent: '#c8e4ff', eyes: 0 },
    lore: 'Sings when struck. The Glasskin consider this rude and unavoidable.',
    tags: ['aerial', 'swarm'],
  }),
  e({
    id: 'facetlurker', name: 'Facet Lurker', archetype: 'ambusher', biome: 'glasswake',
    health: 7, damage: 2, width: 13, height: 15, speed: 56,
    params: { triggerWidth: 26, dropGravity: 1.9, windup: 0.24 },
    visual: { form: 'lurker', color: '#1c2438', accent: '#e0b8ff', eyes: 6 },
    lore: 'Indistinguishable from the ceiling until the ceiling is not there.',
    tags: ['ceiling', 'ambush'],
  }),
  e({
    id: 'refractor', name: 'Refractor', archetype: 'turret', biome: 'glasswake',
    health: 9, damage: 1, width: 15, height: 15, speed: 0,
    params: { burst: 5, spread: 1.4, cooldown: 3, projectileSpeed: 128, windup: 0.65 },
    visual: { form: 'prism', color: '#2c3a56', accent: '#a8d8ff', eyes: 0, facets: 6, glow: 0.9 },
    lore: 'Takes one light and gives back five. None of them are the one you gave it.',
    tags: ['ranged', 'static'],
  }),
  e({
    id: 'glasskinstray', name: 'Glasskin Stray', archetype: 'stalker', biome: 'glasswake',
    health: 9, damage: 2, width: 13, height: 20, speed: 30,
    params: { stalkSpeed: 3, cooldown: 1.3 },
    visual: { form: 'humanoid', color: '#2c3a56', accent: '#e0b8ff', eyes: 2, cloak: true },
    lore: 'A nomad who walked too far from the caravan and kept walking.',
    tags: ['ground', 'stalker'],
  }),

  // =========================================================================
  // THE WEEPING GALLERY — verticality, rain, one-way platforms.
  // =========================================================================
  e({
    id: 'gardenkeeper', name: 'Garden Keeper', archetype: 'walker', biome: 'weepinggallery',
    health: 9, damage: 1, width: 15, height: 20, speed: 40,
    params: { chaseSpeed: 78 },
    visual: { form: 'keeper', color: '#2e4642', accent: '#b8f0d0', eyes: 2, vines: true },
    lore: 'Still pruning. It has an idea about what shape things should be.',
    tags: ['ground'],
  }),
  e({
    id: 'rainstrider', name: 'Rainstrider', archetype: 'flyer', biome: 'weepinggallery',
    health: 6, damage: 1, width: 16, height: 14, speed: 82, flying: true,
    params: { amplitude: 26, diveSpeed: 200, cooldown: 1.4 },
    visual: { form: 'bird', color: '#1e2e2c', accent: '#f0e0a0', eyes: 2, wings: 2 },
    lore: 'Flies in the rain because it has never known anything else to fly in.',
    tags: ['aerial'],
  }),
  e({
    id: 'vinelash', name: 'Vinelash', archetype: 'tether', biome: 'weepinggallery',
    health: 8, damage: 2, width: 14, height: 14, speed: 0,
    params: { radius: 48, angularSpeed: 1.8, gravity: 6 },
    visual: { form: 'bulb', color: '#2e4642', accent: '#b8f0d0', eyes: 1, tendril: true },
    lore: 'Anchored above and swinging below. It has never chosen to be anywhere.',
    tags: ['hazard', 'tether'],
  }),
  e({
    id: 'downpourmaw', name: 'Downpour Maw', archetype: 'lobber', biome: 'weepinggallery',
    health: 8, damage: 1, width: 17, height: 15, speed: 20,
    params: { cooldown: 2, projectileGravity: 560, projectileSize: 5 },
    visual: { form: 'maw', color: '#1e2e2c', accent: '#cfeee0', eyes: 0, teeth: 6 },
    lore: 'Drinks the rain and returns it with intent.',
    tags: ['ranged'],
  }),
  e({
    id: 'terracehopper', name: 'Terrace Hopper', archetype: 'jumper', biome: 'weepinggallery',
    health: 7, damage: 1, width: 14, height: 12, speed: 48,
    params: { jumpPower: 380, jumpDistance: 110, restTime: 0.8 },
    visual: { form: 'hopper', color: '#42605a', accent: '#b8f0d0', eyes: 2, legs: 2 },
    lore: 'Climbs the gallery one terrace at a time, forever, in both directions.',
    tags: ['ground'],
  }),
  e({
    id: 'wetsentinel', name: 'Wet Sentinel', archetype: 'shielded', biome: 'weepinggallery',
    health: 12, damage: 2, width: 17, height: 21, speed: 26, poise: 34,
    params: { windup: 0.45, recovery: 0.65, cooldown: 1.8 },
    visual: { form: 'sentinel', color: '#1e2e2c', accent: '#f0e0a0', eyes: 1, shield: true },
    lore: 'Stands where it was posted. The post is gone; the standing is not.',
    tags: ['ground', 'armoured'],
  }),

  // =========================================================================
  // THE CINDERLOOM — heat, updrafts, aggression.
  // =========================================================================
  e({
    id: 'emberwright', name: 'Emberwright', archetype: 'walker', biome: 'cinderloom',
    health: 11, damage: 2, width: 15, height: 20, speed: 52,
    params: { chaseSpeed: 104 },
    visual: { form: 'automaton', color: '#57291d', accent: '#ff9a4a', eyes: 2, glow: 0.8 },
    lore: 'Tends the looms. Its hands have been hot for so long it has forgotten they were tools.',
    tags: ['ground', 'fire'],
  }),
  e({
    id: 'cinderdart', name: 'Cinderdart', archetype: 'swarm', biome: 'cinderloom',
    health: 3, damage: 1, width: 9, height: 9, speed: 128, flying: true, glyphs: 2,
    params: { chaseOrbit: 24, orbitSpeed: 5 },
    visual: { form: 'spark', color: '#a35a33', accent: '#ffd27a', eyes: 0, glow: 1 },
    lore: 'A spark that has been airborne long enough to develop a preference.',
    tags: ['aerial', 'swarm', 'fire'],
  }),
  e({
    id: 'bellowsbeast', name: 'Bellows Beast', archetype: 'charger', biome: 'cinderloom',
    health: 14, damage: 2, width: 22, height: 18, speed: 40,
    params: { chargeSpeed: 290, windup: 0.5, cooldown: 1.4, chargeTime: 1 },
    visual: { form: 'bull', color: '#381c16', accent: '#ff9a4a', eyes: 2, horns: 2, vents: 3 },
    lore: 'Inhales for a long time. What follows is brief.',
    tags: ['ground', 'charger', 'fire'],
  }),
  e({
    id: 'ventspider', name: 'Vent Spider', archetype: 'ambusher', biome: 'cinderloom',
    health: 8, damage: 2, width: 15, height: 13, speed: 68,
    params: { dropGravity: 2.1, triggerDepth: 150, windup: 0.22 },
    visual: { form: 'spider', color: '#1e1210', accent: '#ff9a4a', eyes: 8, legs: 8 },
    lore: 'Nests in the heat vents. Comes down when the heat changes shape.',
    tags: ['ceiling', 'ambush'],
  }),
  e({
    id: 'loomspindle', name: 'Loom Spindle', archetype: 'spinner', biome: 'cinderloom',
    health: 12, damage: 2, width: 18, height: 18, speed: 46,
    params: { spinTime: 2.4, restTime: 1, spinRate: 11 },
    visual: { form: 'spindle', color: '#57291d', accent: '#ffd27a', eyes: 0, blades: 4 },
    lore: 'Came loose from the loom and did not stop. The thread it carries is still warm.',
    tags: ['ground', 'spinner'],
  }),
  e({
    id: 'flueshrike', name: 'Flue Shrike', archetype: 'flyer', biome: 'cinderloom',
    health: 8, damage: 2, width: 15, height: 13, speed: 108, flying: true,
    params: { diveSpeed: 250, cooldown: 1.1, windup: 0.32, diveRange: 88 },
    visual: { form: 'bird', color: '#381c16', accent: '#ffd27a', eyes: 2, wings: 2, beak: true },
    lore: 'Rides the updrafts and comes down the flues without slowing.',
    tags: ['aerial', 'fast'],
  }),
  e({
    id: 'slagturret', name: 'Slag Turret', archetype: 'turret', biome: 'cinderloom',
    health: 12, damage: 2, width: 16, height: 18, speed: 0,
    params: { burst: 3, spread: 0.34, cooldown: 2.2, projectileSpeed: 165, windup: 0.5 },
    visual: { form: 'turret', color: '#1e1210', accent: '#ff9a4a', eyes: 1, barrel: true },
    lore: 'Fires molten scrap in threes. Nobody built it to do that.',
    tags: ['ranged', 'static', 'fire'],
  }),

  // =========================================================================
  // THE MARROW TERRACES — heavy, grounded, downward pressure.
  // =========================================================================
  e({
    id: 'marrowtiller', name: 'Marrow Tiller', archetype: 'walker', biome: 'marrowterraces',
    health: 13, damage: 2, width: 17, height: 20, speed: 42,
    params: { chaseSpeed: 86 },
    visual: { form: 'tiller', color: '#474038', accent: '#e8dcc8', eyes: 2, tools: 2 },
    lore: 'Works the calcium in rows. Considers anything upright to be a weed.',
    tags: ['ground'],
  }),
  e({
    id: 'ossuarygrub', name: 'Ossuary Grub', archetype: 'burrower', biome: 'marrowterraces',
    health: 10, damage: 2, width: 16, height: 18, speed: 0,
    params: { surfaceRange: 66, exposeTime: 1.7 },
    visual: { form: 'grub', color: '#2e2a26', accent: '#e8dcc8', eyes: 0, segments: 5 },
    lore: 'Eats the terraces from underneath, which is why the terraces are terraces.',
    tags: ['ground', 'burrow'],
  }),
  e({
    id: 'ribcagesentry', name: 'Ribcage Sentry', archetype: 'shielded', biome: 'marrowterraces',
    health: 16, damage: 2, width: 18, height: 22, speed: 24, poise: 42,
    params: { windup: 0.42, recovery: 0.6, cooldown: 1.6 },
    visual: { form: 'sentinel', color: '#1a1817', accent: '#e8dcc8', eyes: 3, shield: true, ribs: 5 },
    lore: 'Built from the ribs it stands between. Loyalty to a body that stopped needing it.',
    tags: ['ground', 'armoured'],
  }),
  e({
    id: 'chalkflier', name: 'Chalkflier', archetype: 'flyer', biome: 'marrowterraces',
    health: 8, damage: 2, width: 16, height: 13, speed: 88, flying: true,
    params: { diveSpeed: 215, cooldown: 1.3 },
    visual: { form: 'moth', color: '#63594c', accent: '#e8dcc8', eyes: 2, wings: 4, dusty: true },
    lore: 'Sheds a fine white dust that settles on everything and records nothing.',
    tags: ['aerial'],
  }),
  e({
    id: 'palegrower', name: 'Pale Grower', archetype: 'turret', biome: 'marrowterraces',
    health: 11, damage: 2, width: 16, height: 16, speed: 0,
    params: { burst: 1, cooldown: 1.6, projectileSpeed: 145, windup: 0.42, projectileSize: 4 },
    visual: { form: 'flower', color: '#474038', accent: '#b0d090', eyes: 0, petals: 4 },
    lore: 'The crop. It was always the crop. Nobody said it was harvested.',
    tags: ['ranged', 'static'],
  }),
  e({
    id: 'terracesplit', name: 'Terrace Split', archetype: 'splitter', biome: 'marrowterraces',
    health: 12, damage: 2, width: 18, height: 16, speed: 46,
    visual: { form: 'boulder', color: '#2e2a26', accent: '#857866', eyes: 2 },
    lore: 'Rolls until it cannot, and then is two things that roll.',
    tags: ['ground', 'splitter'],
    onDeath: (enemy) => {
      enemy.bus?.queue('enemy:spawnRequest', {
        id: 'terracechunk', count: 3, x: enemy.body.box.centerX, y: enemy.body.box.centerY, scatter: 52,
      });
    },
  }),
  e({
    id: 'terracechunk', name: 'Terrace Chunk', archetype: 'splitter', biome: 'marrowterraces',
    health: 4, damage: 1, width: 10, height: 9, speed: 84, glyphs: 2,
    visual: { form: 'boulder', color: '#2e2a26', accent: '#857866', eyes: 1, small: true },
    lore: 'Smaller. No calmer.',
    tags: ['ground', 'swarm'],
  }),

  // =========================================================================
  // THE UMBRAL FEN — darkness, ambush, uncertainty.
  // =========================================================================
  e({
    id: 'fenlurker', name: 'Fen Lurker', archetype: 'stalker', biome: 'umbralfen',
    health: 12, damage: 2, width: 14, height: 20, speed: 34,
    params: { stalkSpeed: 3.4, cooldown: 1.2 },
    aggroRange: 90,
    visual: { form: 'humanoid', color: '#12181f', accent: '#8f7fd8', eyes: 2, glow: 0.5 },
    lore: 'Only ever seen out of the corner of the eye, which is where it prefers to be.',
    tags: ['ground', 'stalker', 'dark'],
  }),
  e({
    id: 'wispgrave', name: 'Wispgrave', archetype: 'flyer', biome: 'umbralfen',
    health: 7, damage: 2, width: 11, height: 11, speed: 74, flying: true,
    params: { amplitude: 20, diveSpeed: 185, cooldown: 1.6 },
    aggroRange: 120,
    visual: { form: 'wisp', color: '#1d242e', accent: '#8f7fd8', eyes: 1, glow: 1 },
    lore: 'A light that leads. It has never said where.',
    tags: ['aerial', 'dark'],
  }),
  e({
    id: 'bogmaw', name: 'Bog Maw', archetype: 'burrower', biome: 'umbralfen',
    health: 14, damage: 2, width: 20, height: 18, speed: 0,
    params: { surfaceRange: 52, exposeTime: 1.3, buriedOffset: 16 },
    visual: { form: 'maw', color: '#0a0d12', accent: '#5fc0a0', eyes: 0, teeth: 8 },
    lore: 'The fen is mostly water. This is the part that is not.',
    tags: ['ground', 'burrow', 'dark'],
  }),
  e({
    id: 'drownedlamp', name: 'Drowned Lamp', archetype: 'turret', biome: 'umbralfen',
    health: 9, damage: 2, width: 13, height: 17, speed: 0,
    params: { burst: 4, spread: 1.9, cooldown: 2.8, projectileSpeed: 108, windup: 0.7 },
    visual: { form: 'lamp', color: '#12181f', accent: '#8f7fd8', eyes: 1, glow: 1 },
    lore: 'Lit to guide travellers. Guides them exactly as far as itself.',
    tags: ['ranged', 'static', 'dark'],
  }),
  e({
    id: 'reedcreeper', name: 'Reed Creeper', archetype: 'ambusher', biome: 'umbralfen',
    health: 9, damage: 2, width: 13, height: 15, speed: 62,
    params: { dropGravity: 1.8, triggerWidth: 30 },
    visual: { form: 'creeper', color: '#1d242e', accent: '#5fc0a0', eyes: 4, reeds: 5 },
    lore: 'Reeds do not usually have that many joints. These do.',
    tags: ['ceiling', 'ambush', 'dark'],
  }),
  e({
    id: 'shadeswarm', name: 'Shadeswarm', archetype: 'swarm', biome: 'umbralfen',
    health: 3, damage: 1, width: 9, height: 9, speed: 116, flying: true, glyphs: 3,
    params: { chaseOrbit: 34, orbitSpeed: 5.2 },
    visual: { form: 'shade', color: '#0a0d12', accent: '#8f7fd8', eyes: 1 },
    lore: 'Pieces of a larger dark that got separated and are trying to reassemble.',
    tags: ['aerial', 'swarm', 'dark'],
  }),

  // =========================================================================
  // THE CLOCKSPILL — timing, rotation, relentlessness.
  // =========================================================================
  e({
    id: 'escapementhound', name: 'Escapement Hound', archetype: 'charger', biome: 'clockspill',
    health: 15, damage: 2, width: 20, height: 14, speed: 50,
    params: { chargeSpeed: 320, windup: 0.36, cooldown: 1.1, chargeTime: 0.9 },
    visual: { form: 'hound', color: '#2a2419', accent: '#ffd86a', eyes: 2, legs: 4, gears: 2 },
    lore: 'Releases exactly as much energy as it stores, on a schedule you cannot see.',
    tags: ['ground', 'charger'],
  }),
  e({
    id: 'ratchetwarden', name: 'Ratchet Warden', archetype: 'shielded', biome: 'clockspill',
    health: 18, damage: 2, width: 18, height: 22, speed: 30, poise: 46,
    params: { windup: 0.38, recovery: 0.55, cooldown: 1.4 },
    visual: { form: 'sentinel', color: '#171410', accent: '#ffd86a', eyes: 2, shield: true, gears: 3 },
    lore: 'Turns one way. Has always turned one way. Will not be turned.',
    tags: ['ground', 'armoured'],
  }),
  e({
    id: 'tickmite', name: 'Tickmite', archetype: 'swarm', biome: 'clockspill',
    health: 4, damage: 1, width: 9, height: 9, speed: 132, flying: true, glyphs: 3,
    params: { chaseOrbit: 26, orbitSpeed: 6 },
    visual: { form: 'mite', color: '#3f3624', accent: '#8fd0ff', eyes: 2 },
    lore: 'Counts. Nobody knows what, and it has never miscounted.',
    tags: ['aerial', 'swarm'],
  }),
  e({
    id: 'gearspinner', name: 'Gearspinner', archetype: 'spinner', biome: 'clockspill',
    health: 16, damage: 2, width: 20, height: 20, speed: 56,
    params: { spinTime: 3, restTime: 0.85, spinRate: 13 },
    visual: { form: 'gear', color: '#584a30', accent: '#ffd86a', eyes: 0, teeth: 12 },
    lore: 'A tooth came off somewhere and it has been compensating ever since.',
    tags: ['ground', 'spinner'],
  }),
  e({
    id: 'pendulumshade', name: 'Pendulum Shade', archetype: 'tether', biome: 'clockspill',
    health: 12, damage: 3, width: 16, height: 20, speed: 0,
    params: { radius: 62, angularSpeed: 2.2, gravity: 8 },
    visual: { form: 'pendulum', color: '#171410', accent: '#ffd86a', eyes: 1, blade: true },
    lore: 'Keeps time by removing things from it.',
    tags: ['hazard', 'tether'],
  }),
  e({
    id: 'springloader', name: 'Springloader', archetype: 'jumper', biome: 'clockspill',
    health: 11, damage: 2, width: 15, height: 14, speed: 60,
    params: { jumpPower: 420, jumpDistance: 160, restTime: 0.6, windup: 0.2 },
    visual: { form: 'spring', color: '#3f3624', accent: '#8fd0ff', eyes: 2, coils: 4 },
    lore: 'Wound past its rating a long time ago and has been releasing ever since.',
    tags: ['ground', 'fast'],
  }),

  // =========================================================================
  // THE ASHEN SPIRE — aerial, high-altitude, precision.
  // =========================================================================
  e({
    id: 'spiresentinel', name: 'Spire Sentinel', archetype: 'walker', biome: 'ashenspire',
    health: 16, damage: 2, width: 16, height: 22, speed: 48,
    params: { chaseSpeed: 100 },
    visual: { form: 'sentinel', color: '#3e404e', accent: '#ffb0b0', eyes: 3 },
    lore: 'Watches the horizon for a fleet that was recalled before it sailed.',
    tags: ['ground'],
  }),
  e({
    id: 'galewing', name: 'Galewing', archetype: 'flyer', biome: 'ashenspire',
    health: 11, damage: 2, width: 18, height: 14, speed: 124, flying: true,
    params: { diveSpeed: 275, cooldown: 1, windup: 0.3, amplitude: 30 },
    visual: { form: 'bird', color: '#2a2b36', accent: '#b0c8ff', eyes: 2, wings: 2 },
    lore: 'Nests where the wind is loudest, because nothing else will.',
    tags: ['aerial', 'fast'],
  }),
  e({
    id: 'bellringer', name: 'Bellringer', archetype: 'lobber', biome: 'ashenspire',
    health: 13, damage: 2, width: 17, height: 19, speed: 22,
    params: { cooldown: 1.9, projectileGravity: 600, projectileSize: 6, projectileDamage: 2 },
    visual: { form: 'ringer', color: '#181820', accent: '#ffb0b0', eyes: 2, bell: true },
    lore: 'Rings for an evacuation that concluded, one way or another, long ago.',
    tags: ['ranged'],
  }),
  e({
    id: 'updraftcling', name: 'Updraft Cling', archetype: 'ambusher', biome: 'ashenspire',
    health: 10, damage: 2, width: 14, height: 14, speed: 70,
    params: { dropGravity: 2.3, triggerDepth: 190, walksAfterLanding: false },
    visual: { form: 'lurker', color: '#181820', accent: '#b0c8ff', eyes: 5 },
    lore: 'Holds on with more limbs than seems necessary, until it does not.',
    tags: ['ceiling', 'ambush'],
  }),
  e({
    id: 'ashkite', name: 'Ash Kite', archetype: 'drifter', biome: 'ashenspire',
    health: 12, damage: 2, width: 20, height: 20, speed: 0, flying: true,
    params: { amplitudeX: 90, amplitudeY: 46, speed: 0.8, freqX: 1, freqY: 2 },
    visual: { form: 'kite', color: '#2a2b36', accent: '#ffb0b0', eyes: 0, tail: true },
    lore: 'Was flown from the tower once, on a string, by somebody. The string is gone.',
    tags: ['aerial', 'hazard'],
  }),
  e({
    id: 'crestlancer', name: 'Crest Lancer', archetype: 'charger', biome: 'ashenspire',
    health: 17, damage: 3, width: 20, height: 20, speed: 54,
    params: { chargeSpeed: 340, windup: 0.44, cooldown: 1.2 },
    visual: { form: 'lancer', color: '#2a2b36', accent: '#ffb0b0', eyes: 2, lance: true },
    lore: 'Charges along the parapet. There is not much parapet.',
    tags: ['ground', 'charger'],
  }),

  // =========================================================================
  // THE AURIC DEEP — submerged, slow, heavy.
  // =========================================================================
  e({
    id: 'auricdrifter', name: 'Auric Drifter', archetype: 'flyer', biome: 'auricdeep',
    health: 14, damage: 2, width: 18, height: 16, speed: 58, flying: true,
    params: { amplitude: 24, diveSpeed: 150, cooldown: 2 },
    visual: { form: 'jelly', color: '#463618', accent: '#ffd070', eyes: 0, translucent: true, glow: 0.7 },
    lore: 'Suspended in the gold, neither rising nor settling. Content.',
    tags: ['aerial', 'aquatic'],
  }),
  e({
    id: 'gildedsentinel', name: 'Gilded Sentinel', archetype: 'shielded', biome: 'auricdeep',
    health: 22, damage: 3, width: 19, height: 23, speed: 24, poise: 52,
    params: { windup: 0.44, recovery: 0.6, cooldown: 1.6 },
    visual: { form: 'sentinel', color: '#2e2410', accent: '#ffd070', eyes: 2, shield: true, gilt: true },
    lore: 'Guards a treasury that is now indistinguishable from the room it is in.',
    tags: ['ground', 'armoured'],
  }),
  e({
    id: 'sunkenchoir', name: 'Sunken Choir', archetype: 'turret', biome: 'auricdeep',
    health: 15, damage: 2, width: 17, height: 20, speed: 0,
    params: { burst: 6, spread: 2.4, cooldown: 3.2, projectileSpeed: 96, windup: 0.75 },
    visual: { form: 'choir', color: '#1a1508', accent: '#fff0c0', eyes: 3, mouths: 3 },
    lore: 'Three voices that were one person. They have not agreed since.',
    tags: ['ranged', 'static'],
  }),
  e({
    id: 'goldeel', name: 'Gold Eel', archetype: 'flyer', biome: 'auricdeep',
    health: 12, damage: 2, width: 22, height: 10, speed: 112, flying: true,
    params: { amplitude: 12, frequency: 3.4, diveSpeed: 230, cooldown: 1.1 },
    visual: { form: 'eel', color: '#2e2410', accent: '#ffd070', eyes: 2, segments: 7 },
    lore: 'Long, and getting longer. The deep does not discourage it.',
    tags: ['aerial', 'aquatic', 'fast'],
  }),
  e({
    id: 'anchorgrub', name: 'Anchor Grub', archetype: 'burrower', biome: 'auricdeep',
    health: 18, damage: 3, width: 20, height: 20, speed: 0,
    params: { surfaceRange: 62, exposeTime: 1.5 },
    visual: { form: 'grub', color: '#1a1508', accent: '#ffd070', eyes: 0, segments: 6 },
    lore: 'Ate the anchor. Ate the chain. Is working on the pier.',
    tags: ['ground', 'burrow'],
  }),

  // =========================================================================
  // THE LAST WEIR — the endgame roster. Every archetype at full pressure.
  // =========================================================================
  e({
    id: 'weirwarden', name: 'Weirwarden', archetype: 'mirror', biome: 'lastweir',
    health: 24, damage: 3, width: 15, height: 22, speed: 88, poise: 40,
    params: { standoff: 52, counterRange: 70, cooldown: 0.85, windup: 0.16 },
    visual: { form: 'humanoid', color: '#18202a', accent: '#70e0ff', eyes: 2, armoured: true },
    lore: 'The last of the engineers who chose to stay. It does not attack first.',
    tags: ['ground', 'counter', 'elite'],
  }),
  e({
    id: 'sluicelancer', name: 'Sluice Lancer', archetype: 'charger', biome: 'lastweir',
    health: 22, damage: 3, width: 21, height: 20, speed: 60,
    params: { chargeSpeed: 380, windup: 0.4, cooldown: 1, chargeTime: 1.1 },
    visual: { form: 'lancer', color: '#243040', accent: '#70e0ff', eyes: 2, lance: true },
    lore: 'Opens sluices by going through them.',
    tags: ['ground', 'charger', 'elite'],
  }),
  e({
    id: 'pressurechoir', name: 'Pressure Choir', archetype: 'turret', biome: 'lastweir',
    health: 20, damage: 3, width: 18, height: 20, speed: 0,
    params: { burst: 8, spread: 2.9, cooldown: 2.8, projectileSpeed: 130, windup: 0.6 },
    visual: { form: 'choir', color: '#0d1114', accent: '#ff7070', eyes: 4, mouths: 4 },
    lore: 'Sings the strain readings aloud. The numbers are not good.',
    tags: ['ranged', 'static', 'elite'],
  }),
  e({
    id: 'floodhound', name: 'Floodhound', archetype: 'stalker', biome: 'lastweir',
    health: 19, damage: 3, width: 19, height: 15, speed: 46,
    params: { stalkSpeed: 3.8, cooldown: 1 },
    visual: { form: 'hound', color: '#18202a', accent: '#ff7070', eyes: 4, legs: 4 },
    lore: 'Runs ahead of the water. It has been running for a very long time.',
    tags: ['ground', 'stalker', 'elite'],
  }),
  e({
    id: 'strainspinner', name: 'Strain Spinner', archetype: 'spinner', biome: 'lastweir',
    health: 21, damage: 3, width: 21, height: 21, speed: 62,
    params: { spinTime: 3.2, restTime: 0.75, spinRate: 15 },
    visual: { form: 'spindle', color: '#243040', accent: '#70e0ff', eyes: 0, blades: 6 },
    lore: 'Winds the cables that hold the gate. Has begun winding other things.',
    tags: ['ground', 'spinner', 'elite'],
  }),

  // =========================================================================
  // HIDDEN REGIONS — optional, and meaner for it.
  // =========================================================================
  e({
    id: 'marginghost', name: 'Margin Ghost', archetype: 'mirror', biome: 'blankmargin',
    health: 26, damage: 3, width: 14, height: 21, speed: 96, poise: 36,
    params: { standoff: 48, counterRange: 74, cooldown: 0.7, windup: 0.14 },
    visual: { form: 'humanoid', color: '#c4bfb4', accent: '#2a2620', eyes: 2, inverted: true },
    lore: 'A shape the page kept for someone. It moves the way you do, a moment later.',
    tags: ['ground', 'counter', 'elite', 'hidden'],
  }),
  e({
    id: 'guidelinewarden', name: 'Guideline Warden', archetype: 'tether', biome: 'blankmargin',
    health: 18, damage: 3, width: 16, height: 16, speed: 0,
    params: { radius: 70, angularSpeed: 2.6, gravity: 9 },
    visual: { form: 'bulb', color: '#aaa499', accent: '#2a2620', eyes: 1, tendril: true },
    lore: 'Keeps the line straight. Objects to anything that is not the line.',
    tags: ['hazard', 'tether', 'hidden'],
  }),
  e({
    id: 'strikethrough', name: 'Strikethrough', archetype: 'charger', biome: 'inkbelow',
    health: 24, damage: 3, width: 24, height: 10, speed: 70,
    params: { chargeSpeed: 420, windup: 0.32, cooldown: 0.9, chargeTime: 1.2, verticalTolerance: 40 },
    visual: { form: 'bar', color: '#161620', accent: '#c04070', eyes: 0, flat: true },
    lore: 'A line drawn through something, still travelling, still deleting.',
    tags: ['ground', 'charger', 'hidden'],
  }),
  e({
    id: 'drownedglyph', name: 'Drowned Glyph', archetype: 'flyer', biome: 'inkbelow',
    health: 18, damage: 3, width: 14, height: 14, speed: 118, flying: true,
    params: { diveSpeed: 290, cooldown: 0.9, windup: 0.28 },
    visual: { form: 'glyph', color: '#0e0e14', accent: '#4060c0', eyes: 1, glow: 0.8 },
    lore: 'A letter from an alphabet nobody finished. It resents the omission.',
    tags: ['aerial', 'fast', 'hidden'],
  }),
  e({
    id: 'blotmaw', name: 'Blotmaw', archetype: 'burrower', biome: 'inkbelow',
    health: 28, damage: 3, width: 24, height: 22, speed: 0,
    params: { surfaceRange: 70, exposeTime: 1.2 },
    visual: { form: 'maw', color: '#07070a', accent: '#c04070', eyes: 0, teeth: 10 },
    lore: 'Where the ink pooled deepest, something learned to be hungry in it.',
    tags: ['ground', 'burrow', 'hidden'],
  }),
  e({
    id: 'erasurehost', name: 'Erasure Host', archetype: 'splitter', biome: 'inkbelow',
    health: 20, damage: 3, width: 20, height: 18, speed: 58,
    visual: { form: 'blob', color: '#161620', accent: '#c04070', eyes: 3 },
    lore: 'Removing it produces more of it. This is, in its view, the point.',
    tags: ['ground', 'splitter', 'hidden'],
    onDeath: (enemy) => {
      enemy.bus?.queue('enemy:spawnRequest', {
        id: 'erasurefleck', count: 3, x: enemy.body.box.centerX, y: enemy.body.box.centerY, scatter: 56,
      });
    },
  }),
  e({
    id: 'erasurefleck', name: 'Erasure Fleck', archetype: 'swarm', biome: 'inkbelow',
    health: 5, damage: 2, width: 9, height: 9, speed: 140, flying: true, glyphs: 4,
    params: { chaseOrbit: 30, orbitSpeed: 6.4 },
    visual: { form: 'shade', color: '#07070a', accent: '#c04070', eyes: 1 },
    lore: 'Small enough to be missed. Numerous enough not to be.',
    tags: ['aerial', 'swarm', 'hidden'],
  }),
]);
