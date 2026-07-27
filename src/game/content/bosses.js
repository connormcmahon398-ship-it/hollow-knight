/**
 * @file The bosses of Aetherweir — 28 encounters.
 *
 * ## Composition, not repetition
 * Each boss is a *sequence of phases*, each phase a *weighted pool of patterns*
 * drawn from `boss-patterns.js`. What makes them distinct is the combination
 * and the pacing:
 *
 * - **Early bosses** have two phases, wide telegraphs (0.6-0.9s) and long
 *   recoveries, so they teach the vocabulary of reading a wind-up.
 * - **Mid bosses** have three phases and mix ranges, so no single distance is
 *   safe and the player must move through the fight rather than orbit it.
 * - **Late and secret bosses** have three or four phases, telegraphs down near
 *   the 0.28s fairness floor, and patterns that punish the standard answers.
 *
 * The `healthThreshold` values are fractions of max health; phase 0 is always
 * 1.0. Thresholds are spaced so no phase is over before the player has seen its
 * whole pattern pool — a phase that lasts eight seconds is scenery, not design.
 */

import { defineBoss } from '../boss/boss.js';
import {
  slam, dashAcross, ringBurst, aimedVolley, skyfall, summon, leapSmash,
  sweep, whirl, blinkStrike, beam, groundSpikes, guardCounter, dive, spiral, regroup,
} from './boss-patterns.js';

// =========================================================================
// THE SALT SHALLOWS
// =========================================================================

defineBoss({
  id: 'saltwarden', name: 'The Saltwarden', title: 'First Refusal',
  biome: 'saltshallows', health: 60, damage: 1, width: 26, height: 30,
  glyphs: 60, rewardAbility: 'skim',
  visual: { form: 'warden', color: '#6f6a5c', accent: '#e8dcc0', eyes: 2, preferredRange: 60 },
  lore: 'It was set here to turn back the tide. The tide stopped coming. It kept turning things back.',
  phases: [
    {
      id: 'p1', name: 'Standing', healthThreshold: 1, minTelegraph: 0.45,
      patterns: [
        sweep({ telegraph: 0.7, recovery: 0.95, damage: 1 }),
        slam({ telegraph: 0.85, recovery: 1.1, damage: 1, waveDamage: 1 }),
      ],
    },
    {
      id: 'p2', name: 'Yielding', healthThreshold: 0.45, aggression: 1.2, minTelegraph: 0.4,
      patterns: [
        sweep({ telegraph: 0.55, recovery: 0.8, damage: 1 }),
        slam({ telegraph: 0.7, recovery: 0.9, damage: 1 }),
        dashAcross({ telegraph: 0.55, recovery: 0.85, speed: 260 }),
      ],
    },
  ],
});

defineBoss({
  id: 'tidemother', name: 'The Tidemother', title: 'What The Water Left',
  biome: 'saltshallows', health: 85, damage: 1, width: 30, height: 26, optional: true,
  glyphs: 90, flying: true,
  visual: { form: 'jelly', color: '#7f9fb0', accent: '#dff0f8', translucent: true, preferredRange: 80 },
  lore: 'Every pool in the Shallows is a fragment of her. She has been reassembling for an age, patiently, in the wrong order.',
  phases: [
    {
      id: 'p1', name: 'Drifting', healthThreshold: 1,
      patterns: [
        ringBurst({ count: 8, telegraph: 0.8, recovery: 1, speed: 110, color: '#a8c8d8' }),
        dive({ telegraph: 0.6, recovery: 1, speed: 260 }),
      ],
    },
    {
      id: 'p2', name: 'Rising', healthThreshold: 0.5, aggression: 1.25,
      patterns: [
        ringBurst({ count: 12, rings: 2, telegraph: 0.65, recovery: 0.9, color: '#a8c8d8' }),
        dive({ telegraph: 0.45, recovery: 0.8, speed: 310 }),
        summon({ enemy: 'tidemote', count: 3, telegraph: 0.9, recovery: 1.1 }),
      ],
    },
  ],
});

// =========================================================================
// THE SUNKEN ARCHIVE
// =========================================================================

defineBoss({
  id: 'headarchivist', name: 'The Head Archivist', title: 'Still Cataloguing',
  biome: 'sunkenarchive', health: 110, damage: 1, width: 24, height: 32,
  glyphs: 120, rewardAbility: 'gripscript',
  visual: { form: 'humanoid', color: '#2f4050', accent: '#7fd4d8', robe: true, preferredRange: 74 },
  lore: 'Refused evacuation on the grounds that the collection had not been indexed. It has still not been indexed.',
  phases: [
    {
      id: 'p1', name: 'Order', healthThreshold: 1,
      patterns: [
        aimedVolley({ shots: 3, telegraph: 0.65, recovery: 0.85, color: '#7fd4d8' }),
        sweep({ telegraph: 0.6, recovery: 0.8 }),
      ],
    },
    {
      id: 'p2', name: 'Disorder', healthThreshold: 0.62, aggression: 1.15,
      patterns: [
        aimedVolley({ shots: 5, telegraph: 0.55, recovery: 0.75, color: '#7fd4d8' }),
        skyfall({ telegraph: 0.85, recovery: 1, duration: 1.6, color: '#c9a86a' }),
        dashAcross({ telegraph: 0.5, recovery: 0.8 }),
      ],
    },
    {
      id: 'p3', name: 'Collapse', healthThreshold: 0.28, aggression: 1.4, minTelegraph: 0.35,
      patterns: [
        aimedVolley({ shots: 6, telegraph: 0.42, recovery: 0.65, interval: 0.12, color: '#7fd4d8' }),
        skyfall({ telegraph: 0.7, recovery: 0.85, duration: 2, interval: 0.13 }),
        summon({ enemy: 'pagemite', count: 4, telegraph: 0.8, recovery: 1 }),
        whirl({ telegraph: 0.5, recovery: 1 }),
      ],
    },
  ],
});

defineBoss({
  id: 'gutterking', name: 'The Gutter King', title: 'Between The Pages',
  biome: 'sunkenarchive', health: 95, damage: 1, width: 30, height: 24, optional: true,
  glyphs: 110,
  visual: { form: 'worm', color: '#2c3a44', accent: '#9fd0d8', segments: 6, preferredRange: 50 },
  lore: 'The gap between two shelves is a kingdom if you are the right shape.',
  phases: [
    {
      id: 'p1', name: 'Surfacing', healthThreshold: 1,
      patterns: [
        groundSpikes({ telegraph: 0.75, recovery: 0.95, count: 5 }),
        leapSmash({ telegraph: 0.6, recovery: 0.9 }),
      ],
    },
    {
      id: 'p2', name: 'Swallowing', healthThreshold: 0.45, aggression: 1.3,
      patterns: [
        groundSpikes({ telegraph: 0.55, recovery: 0.8, count: 8, interval: 0.1 }),
        leapSmash({ telegraph: 0.45, recovery: 0.75 }),
        whirl({ telegraph: 0.55, recovery: 1, duration: 1.2 }),
      ],
    },
  ],
});

// =========================================================================
// VERDIGRIS WATERWORKS
// =========================================================================

defineBoss({
  id: 'sluiceengine', name: 'The Sluice Engine', title: 'Opens On Schedule',
  biome: 'verdigris', health: 140, damage: 2, width: 34, height: 30,
  glyphs: 150, rewardAbility: 'updraftsail',
  visual: { form: 'automaton', color: '#2b4740', accent: '#68e0a8', brass: true, preferredRange: 84 },
  lore: 'Not built to fight. Built to open, and to close, and to consider anything in the channel a blockage.',
  phases: [
    {
      id: 'p1', name: 'First Gate', healthThreshold: 1,
      patterns: [
        beam({ telegraph: 0.95, recovery: 1.1, color: '#68e0a8' }),
        slam({ telegraph: 0.7, recovery: 0.95, damage: 2 }),
      ],
    },
    {
      id: 'p2', name: 'Second Gate', healthThreshold: 0.6,
      patterns: [
        beam({ telegraph: 0.8, recovery: 0.95 }),
        slam({ telegraph: 0.6, recovery: 0.85, damage: 2 }),
        ringBurst({ count: 10, telegraph: 0.7, recovery: 0.9, color: '#68e0a8' }),
      ],
    },
    {
      id: 'p3', name: 'Full Flow', healthThreshold: 0.3, aggression: 1.35, minTelegraph: 0.35,
      patterns: [
        beam({ telegraph: 0.6, recovery: 0.8, length: 300 }),
        ringBurst({ count: 14, rings: 2, telegraph: 0.55, recovery: 0.8 }),
        skyfall({ telegraph: 0.7, recovery: 0.9, duration: 2.2, damage: 2 }),
        dashAcross({ telegraph: 0.42, recovery: 0.7, speed: 380 }),
      ],
    },
  ],
});

defineBoss({
  id: 'verdigrisheart', name: 'The Verdigris Heart', title: 'Green And Beating',
  biome: 'verdigris', health: 120, damage: 2, width: 28, height: 28, optional: true, glyphs: 140,
  visual: { form: 'flower', color: '#1b2e2a', accent: '#68e0a8', petals: 6, preferredRange: 90 },
  lore: 'The corrosion reached the pump and did not stop being corrosion. It only started being a pump as well.',
  phases: [
    {
      id: 'p1', name: 'Systole', healthThreshold: 1,
      patterns: [
        spiral({ telegraph: 0.75, recovery: 1.1, arms: 2, color: '#68e0a8' }),
        summon({ enemy: 'gasketmite', count: 2, telegraph: 0.9, recovery: 1.2 }),
      ],
    },
    {
      id: 'p2', name: 'Diastole', healthThreshold: 0.5, aggression: 1.3,
      patterns: [
        spiral({ telegraph: 0.6, recovery: 0.9, arms: 3, step: 0.5 }),
        ringBurst({ count: 16, telegraph: 0.65, recovery: 0.85 }),
        summon({ enemy: 'gasketchip', count: 4, telegraph: 0.8, recovery: 1 }),
      ],
    },
  ],
});

// =========================================================================
// THE GLASSWAKE
// =========================================================================

defineBoss({
  id: 'facetedone', name: 'The Faceted One', title: 'Six Answers, One Question',
  biome: 'glasswake', health: 160, damage: 2, width: 26, height: 30,
  glyphs: 180, rewardAbility: 'paperwing',
  visual: { form: 'crystal', color: '#2c3a56', accent: '#a8d8ff', facets: 6, preferredRange: 70 },
  lore: 'Speaks in six voices at once, each a slightly different account of the same afternoon.',
  phases: [
    {
      id: 'p1', name: 'Reflection', healthThreshold: 1,
      patterns: [
        ringBurst({ count: 6, telegraph: 0.7, recovery: 0.95, color: '#a8d8ff' }),
        dashAcross({ telegraph: 0.55, recovery: 0.85, speed: 320 }),
      ],
    },
    {
      id: 'p2', name: 'Refraction', healthThreshold: 0.65, aggression: 1.2,
      patterns: [
        ringBurst({ count: 12, rings: 2, telegraph: 0.6, recovery: 0.85 }),
        blinkStrike({ telegraph: 0.55, recovery: 1, damage: 2 }),
        sweep({ telegraph: 0.5, recovery: 0.75, damage: 2 }),
      ],
    },
    {
      id: 'p3', name: 'Shatter', healthThreshold: 0.3, aggression: 1.5, minTelegraph: 0.32,
      patterns: [
        ringBurst({ count: 18, rings: 3, telegraph: 0.5, recovery: 0.75, interval: 0.22 }),
        blinkStrike({ telegraph: 0.4, recovery: 0.8, damage: 2 }),
        whirl({ telegraph: 0.45, recovery: 0.95, damage: 2 }),
        summon({ enemy: 'chimeswarm', count: 5, telegraph: 0.75, recovery: 0.9 }),
      ],
    },
  ],
});

defineBoss({
  id: 'glasskinelder', name: 'The Glasskin Elder', title: 'Walked The Wake Barefoot',
  biome: 'glasswake', health: 145, damage: 2, width: 22, height: 32, optional: true, glyphs: 170,
  visual: { form: 'humanoid', color: '#1c2438', accent: '#e0b8ff', cloak: true, preferredRange: 56 },
  lore: 'Knows exactly where the glass is thin. Will fight you on the thin part.',
  phases: [
    {
      id: 'p1', name: 'Measured', healthThreshold: 1,
      patterns: [
        sweep({ telegraph: 0.6, recovery: 0.8, damage: 2 }),
        guardCounter({ telegraph: 0.4, recovery: 0.85, damage: 2 }),
        dashAcross({ telegraph: 0.5, recovery: 0.8 }),
      ],
    },
    {
      id: 'p2', name: 'Unmeasured', healthThreshold: 0.42, aggression: 1.4, minTelegraph: 0.33,
      patterns: [
        sweep({ telegraph: 0.42, recovery: 0.6, damage: 2 }),
        blinkStrike({ telegraph: 0.4, recovery: 0.75, damage: 2 }),
        guardCounter({ telegraph: 0.35, recovery: 0.7, damage: 2 }),
        whirl({ telegraph: 0.45, recovery: 0.9 }),
      ],
    },
  ],
});

// =========================================================================
// THE WEEPING GALLERY
// =========================================================================

defineBoss({
  id: 'gardenerofthefall', name: 'The Gardener of the Fall', title: 'Still Pruning',
  biome: 'weepinggallery', health: 155, damage: 2, width: 28, height: 32,
  glyphs: 170, rewardAbility: 'plumbstrike',
  visual: { form: 'keeper', color: '#2e4642', accent: '#b8f0d0', vines: true, preferredRange: 66 },
  lore: 'The garden survived because somebody kept working after there was no longer a reason to.',
  phases: [
    {
      id: 'p1', name: 'Tending', healthThreshold: 1,
      patterns: [
        sweep({ telegraph: 0.65, recovery: 0.9, damage: 2, reach: 40, width: 66 }),
        groundSpikes({ telegraph: 0.75, recovery: 1, count: 5, damage: 2 }),
      ],
    },
    {
      id: 'p2', name: 'Overgrowth', healthThreshold: 0.58, aggression: 1.2,
      patterns: [
        sweep({ telegraph: 0.5, recovery: 0.75, damage: 2 }),
        groundSpikes({ telegraph: 0.6, recovery: 0.85, count: 7, damage: 2 }),
        skyfall({ telegraph: 0.8, recovery: 1, damage: 2, color: '#b8f0d0' }),
      ],
    },
    {
      id: 'p3', name: 'Wild', healthThreshold: 0.27, aggression: 1.45, minTelegraph: 0.34,
      patterns: [
        sweep({ telegraph: 0.4, recovery: 0.6, damage: 2 }),
        groundSpikes({ telegraph: 0.5, recovery: 0.75, count: 10, interval: 0.1, damage: 2 }),
        leapSmash({ telegraph: 0.45, recovery: 0.7, damage: 2 }),
        summon({ enemy: 'vinelash', count: 2, telegraph: 0.85, recovery: 1 }),
      ],
    },
  ],
});

defineBoss({
  id: 'rainmother', name: 'The Rainmother', title: 'Source Unfound',
  biome: 'weepinggallery', health: 130, damage: 2, width: 30, height: 24,
  optional: true, glyphs: 150, flying: true,
  visual: { form: 'bird', color: '#1e2e2c', accent: '#f0e0a0', wings: 4, preferredRange: 92 },
  lore: 'Nobody has found where the Gallery rain comes from. She has never volunteered it.',
  phases: [
    {
      id: 'p1', name: 'Drizzle', healthThreshold: 1,
      patterns: [
        skyfall({ telegraph: 0.8, recovery: 1, duration: 1.6, color: '#cfeee0' }),
        dive({ telegraph: 0.6, recovery: 0.95 }),
      ],
    },
    {
      id: 'p2', name: 'Downpour', healthThreshold: 0.48, aggression: 1.35,
      patterns: [
        skyfall({ telegraph: 0.6, recovery: 0.8, duration: 2.4, interval: 0.11, damage: 2 }),
        dive({ telegraph: 0.42, recovery: 0.75, speed: 380 }),
        ringBurst({ count: 12, telegraph: 0.6, recovery: 0.85 }),
      ],
    },
  ],
});

// =========================================================================
// THE CINDERLOOM
// =========================================================================

defineBoss({
  id: 'loommaster', name: 'The Loommaster', title: 'Wove The Sky Its Colour',
  biome: 'cinderloom', health: 190, damage: 2, width: 32, height: 34,
  glyphs: 220, rewardAbility: 'emberskin',
  visual: { form: 'automaton', color: '#57291d', accent: '#ff9a4a', glow: 1, preferredRange: 72 },
  lore: 'Every colour the sky ever was, it made. It is very hard to explain to it that the sky is gone.',
  phases: [
    {
      id: 'p1', name: 'Warp', healthThreshold: 1,
      patterns: [
        beam({ telegraph: 0.9, recovery: 1.1, color: '#ff9a4a', damage: 2 }),
        slam({ telegraph: 0.7, recovery: 0.95, damage: 2 }),
        aimedVolley({ shots: 3, telegraph: 0.6, recovery: 0.8, color: '#ffd27a' }),
      ],
    },
    {
      id: 'p2', name: 'Weft', healthThreshold: 0.62, aggression: 1.25,
      patterns: [
        beam({ telegraph: 0.7, recovery: 0.9, damage: 2 }),
        whirl({ telegraph: 0.55, recovery: 1, damage: 2, driftSpeed: 110 }),
        spiral({ telegraph: 0.65, recovery: 0.95, arms: 3, color: '#ff9a4a' }),
      ],
    },
    {
      id: 'p3', name: 'Unravelling', healthThreshold: 0.3, aggression: 1.5, minTelegraph: 0.32,
      patterns: [
        beam({ telegraph: 0.55, recovery: 0.75, length: 320, damage: 2 }),
        spiral({ telegraph: 0.5, recovery: 0.8, arms: 4, step: 0.55, interval: 0.07 }),
        dashAcross({ telegraph: 0.4, recovery: 0.65, speed: 400 }),
        summon({ enemy: 'cinderdart', count: 5, telegraph: 0.7, recovery: 0.9 }),
      ],
    },
  ],
});

defineBoss({
  id: 'bellowstwins', name: 'The Bellows Twins', title: 'Inhale, Exhale',
  biome: 'cinderloom', health: 175, damage: 2, width: 30, height: 26, optional: true, glyphs: 200,
  visual: { form: 'bull', color: '#381c16', accent: '#ff9a4a', horns: 4, preferredRange: 100 },
  lore: 'Two halves of one machine that were separated for maintenance and have been trying to meet ever since.',
  phases: [
    {
      id: 'p1', name: 'Inhale', healthThreshold: 1,
      patterns: [
        dashAcross({ telegraph: 0.5, recovery: 0.8, speed: 360 }),
        leapSmash({ telegraph: 0.55, recovery: 0.85, damage: 2 }),
      ],
    },
    {
      id: 'p2', name: 'Exhale', healthThreshold: 0.5, aggression: 1.45, minTelegraph: 0.3,
      patterns: [
        dashAcross({ telegraph: 0.36, recovery: 0.6, speed: 430 }),
        leapSmash({ telegraph: 0.42, recovery: 0.7, damage: 2 }),
        whirl({ telegraph: 0.45, recovery: 0.85, damage: 2 }),
      ],
    },
  ],
});

// =========================================================================
// THE MARROW TERRACES
// =========================================================================

defineBoss({
  id: 'marrowmatriarch', name: 'The Marrow Matriarch', title: 'Counts The Vertebrae',
  biome: 'marrowterraces', health: 200, damage: 2, width: 34, height: 32,
  glyphs: 240, rewardAbility: 'anchorbreak',
  visual: { form: 'tiller', color: '#474038', accent: '#e8dcc8', preferredRange: 64 },
  lore: 'Knows the fossil by name, joint by joint. Considers the terraces a courtesy she extends to it.',
  phases: [
    {
      id: 'p1', name: 'Furrow', healthThreshold: 1,
      patterns: [
        slam({ telegraph: 0.75, recovery: 1, damage: 2, width: 90 }),
        groundSpikes({ telegraph: 0.7, recovery: 0.95, count: 6, damage: 2 }),
      ],
    },
    {
      id: 'p2', name: 'Harrow', healthThreshold: 0.6, aggression: 1.25,
      patterns: [
        slam({ telegraph: 0.6, recovery: 0.85, damage: 2 }),
        groundSpikes({ telegraph: 0.55, recovery: 0.8, count: 9, damage: 2 }),
        leapSmash({ telegraph: 0.55, recovery: 0.85, damage: 2 }),
      ],
    },
    {
      id: 'p3', name: 'Fallow', healthThreshold: 0.28, aggression: 1.4, minTelegraph: 0.33,
      patterns: [
        slam({ telegraph: 0.5, recovery: 0.7, damage: 2, waveSpeed: 240 }),
        groundSpikes({ telegraph: 0.45, recovery: 0.7, count: 12, interval: 0.09, damage: 2 }),
        summon({ enemy: 'terracechunk', count: 4, telegraph: 0.75, recovery: 0.9 }),
        whirl({ telegraph: 0.45, recovery: 0.9, damage: 2 }),
      ],
    },
  ],
});

defineBoss({
  id: 'thepatientone', name: 'The Patient One', title: 'What The Terraces Are Built On',
  biome: 'marrowterraces', health: 240, damage: 3, width: 40, height: 36,
  optional: true, secret: true, glyphs: 320,
  visual: { form: 'maw', color: '#1a1817', accent: '#b0d090', teeth: 12, preferredRange: 80 },
  lore: 'The Marrowfolk farm its ribs and call it geology. It has been listening to them do it.',
  phases: [
    {
      id: 'p1', name: 'Stirring', healthThreshold: 1,
      patterns: [
        groundSpikes({ telegraph: 0.7, recovery: 0.9, count: 8, damage: 3 }),
        skyfall({ telegraph: 0.75, recovery: 0.95, damage: 2 }),
      ],
    },
    {
      id: 'p2', name: 'Waking', healthThreshold: 0.66, aggression: 1.3,
      patterns: [
        groundSpikes({ telegraph: 0.55, recovery: 0.75, count: 11, damage: 3 }),
        ringBurst({ count: 14, rings: 2, telegraph: 0.6, recovery: 0.85, damage: 2 }),
        slam({ telegraph: 0.6, recovery: 0.8, damage: 3 }),
      ],
    },
    {
      id: 'p3', name: 'Risen', healthThreshold: 0.33, aggression: 1.6, minTelegraph: 0.3,
      patterns: [
        groundSpikes({ telegraph: 0.42, recovery: 0.62, count: 14, interval: 0.08, damage: 3 }),
        ringBurst({ count: 20, rings: 3, telegraph: 0.5, recovery: 0.7, damage: 2 }),
        slam({ telegraph: 0.45, recovery: 0.65, damage: 3, waveSpeed: 260 }),
        summon({ enemy: 'ossuarygrub', count: 2, telegraph: 0.7, recovery: 0.9 }),
      ],
    },
  ],
});

// =========================================================================
// THE UMBRAL FEN
// =========================================================================

defineBoss({
  id: 'fenoracle', name: 'The Fen Oracle', title: 'Maps It Differently Each Time',
  biome: 'umbralfen', health: 185, damage: 2, width: 24, height: 34,
  glyphs: 230, rewardAbility: 'blotstep',
  visual: { form: 'humanoid', color: '#12181f', accent: '#8f7fd8', glow: 1, preferredRange: 78 },
  lore: 'Has drawn the Fen four hundred times. No two maps agree, and she insists all of them are current.',
  phases: [
    {
      id: 'p1', name: 'First Map', healthThreshold: 1,
      patterns: [
        blinkStrike({ telegraph: 0.6, recovery: 1, damage: 2 }),
        aimedVolley({ shots: 3, telegraph: 0.6, recovery: 0.85, color: '#8f7fd8' }),
      ],
    },
    {
      id: 'p2', name: 'Second Map', healthThreshold: 0.62, aggression: 1.25,
      patterns: [
        blinkStrike({ telegraph: 0.48, recovery: 0.85, damage: 2 }),
        spiral({ telegraph: 0.65, recovery: 0.95, arms: 2, color: '#8f7fd8' }),
        summon({ enemy: 'shadeswarm', count: 4, telegraph: 0.8, recovery: 1 }),
      ],
    },
    {
      id: 'p3', name: 'No Map', healthThreshold: 0.3, aggression: 1.5, minTelegraph: 0.3,
      patterns: [
        blinkStrike({ telegraph: 0.35, recovery: 0.7, damage: 2 }),
        spiral({ telegraph: 0.5, recovery: 0.8, arms: 4, interval: 0.07 }),
        ringBurst({ count: 16, rings: 2, telegraph: 0.5, recovery: 0.75 }),
        summon({ enemy: 'wispgrave', count: 3, telegraph: 0.7, recovery: 0.9 }),
      ],
    },
  ],
});

defineBoss({
  id: 'thingthatguides', name: 'The Thing That Guides', title: 'As Far As Itself',
  biome: 'umbralfen', health: 165, damage: 3, width: 22, height: 22,
  optional: true, glyphs: 210, flying: true,
  visual: { form: 'wisp', color: '#0a0d12', accent: '#8f7fd8', glow: 1, preferredRange: 96 },
  lore: 'It has never lied about where it is going.',
  phases: [
    {
      id: 'p1', name: 'Beckoning', healthThreshold: 1,
      patterns: [
        dive({ telegraph: 0.55, recovery: 0.9, damage: 3 }),
        ringBurst({ count: 9, telegraph: 0.7, recovery: 0.95, color: '#8f7fd8' }),
      ],
    },
    {
      id: 'p2', name: 'Arriving', healthThreshold: 0.45, aggression: 1.5, minTelegraph: 0.3,
      patterns: [
        dive({ telegraph: 0.38, recovery: 0.7, speed: 400, damage: 3 }),
        ringBurst({ count: 16, rings: 2, telegraph: 0.5, recovery: 0.75 }),
        spiral({ telegraph: 0.5, recovery: 0.8, arms: 3 }),
      ],
    },
  ],
});

// =========================================================================
// THE CLOCKSPILL
// =========================================================================

defineBoss({
  id: 'escapement', name: 'The Escapement', title: 'Releases Exactly Enough',
  biome: 'clockspill', health: 210, damage: 2, width: 30, height: 34,
  glyphs: 260, rewardAbility: 'linecast',
  visual: { form: 'gear', color: '#3f3624', accent: '#ffd86a', teeth: 14, preferredRange: 70 },
  lore: 'The part of a clock that decides when the rest of it may move. It has decided about you.',
  phases: [
    {
      id: 'p1', name: 'Tick', healthThreshold: 1,
      patterns: [
        sweep({ telegraph: 0.6, recovery: 0.85, damage: 2 }),
        dashAcross({ telegraph: 0.5, recovery: 0.8, speed: 350 }),
        ringBurst({ count: 12, telegraph: 0.7, recovery: 0.9, color: '#ffd86a' }),
      ],
    },
    {
      id: 'p2', name: 'Tock', healthThreshold: 0.66, aggression: 1.3,
      patterns: [
        sweep({ telegraph: 0.45, recovery: 0.7, damage: 2 }),
        dashAcross({ telegraph: 0.4, recovery: 0.65, speed: 400 }),
        beam({ telegraph: 0.75, recovery: 0.95, damage: 2 }),
      ],
    },
    {
      id: 'p3', name: 'Unwound', healthThreshold: 0.32, aggression: 1.7, minTelegraph: 0.28,
      patterns: [
        sweep({ telegraph: 0.33, recovery: 0.55, damage: 2 }),
        dashAcross({ telegraph: 0.3, recovery: 0.55, speed: 460 }),
        spiral({ telegraph: 0.45, recovery: 0.75, arms: 4, interval: 0.06 }),
        whirl({ telegraph: 0.4, recovery: 0.8, damage: 2, driftSpeed: 130 }),
      ],
    },
  ],
});

defineBoss({
  id: 'hourhand', name: 'The Hour Hand', title: 'Slow, And Then Not',
  biome: 'clockspill', health: 195, damage: 3, width: 36, height: 20, optional: true, glyphs: 240,
  visual: { form: 'bar', color: '#171410', accent: '#ffd86a', flat: true, preferredRange: 110 },
  lore: 'It moves once an hour. You are unlikely to be here for an hour, but it is willing to make an exception.',
  phases: [
    {
      id: 'p1', name: 'Sweeping', healthThreshold: 1,
      patterns: [
        beam({ telegraph: 1, recovery: 1.2, length: 300, damage: 3 }),
        dashAcross({ telegraph: 0.6, recovery: 0.9, speed: 380 }),
      ],
    },
    {
      id: 'p2', name: 'Striking', healthThreshold: 0.45, aggression: 1.5, minTelegraph: 0.3,
      patterns: [
        beam({ telegraph: 0.6, recovery: 0.85, length: 340, damage: 3 }),
        dashAcross({ telegraph: 0.34, recovery: 0.6, speed: 480 }),
        groundSpikes({ telegraph: 0.5, recovery: 0.75, count: 12, damage: 2 }),
      ],
    },
  ],
});

// =========================================================================
// THE ASHEN SPIRE
// =========================================================================

defineBoss({
  id: 'spirekeeper', name: 'The Spire Keeper', title: 'Watches For A Fleet',
  biome: 'ashenspire', health: 225, damage: 3, width: 28, height: 36,
  glyphs: 290, rewardAbility: 'driftleaf',
  visual: { form: 'sentinel', color: '#3e404e', accent: '#ffb0b0', preferredRange: 74 },
  lore: 'The fleet was recalled. The recall order reached everyone but the top of the tower.',
  phases: [
    {
      id: 'p1', name: 'Vigil', healthThreshold: 1,
      patterns: [
        sweep({ telegraph: 0.6, recovery: 0.85, damage: 3 }),
        aimedVolley({ shots: 4, telegraph: 0.6, recovery: 0.8, color: '#ffb0b0' }),
      ],
    },
    {
      id: 'p2', name: 'Alarm', healthThreshold: 0.64, aggression: 1.3,
      patterns: [
        sweep({ telegraph: 0.45, recovery: 0.7, damage: 3 }),
        leapSmash({ telegraph: 0.5, recovery: 0.8, damage: 3 }),
        skyfall({ telegraph: 0.7, recovery: 0.9, damage: 2 }),
      ],
    },
    {
      id: 'p3', name: 'Last Watch', healthThreshold: 0.3, aggression: 1.6, minTelegraph: 0.29,
      patterns: [
        sweep({ telegraph: 0.35, recovery: 0.55, damage: 3 }),
        leapSmash({ telegraph: 0.4, recovery: 0.65, damage: 3 }),
        beam({ telegraph: 0.55, recovery: 0.8, damage: 3 }),
        ringBurst({ count: 18, rings: 2, telegraph: 0.5, recovery: 0.75 }),
      ],
    },
  ],
});

defineBoss({
  id: 'galecrown', name: 'The Gale Crown', title: 'What The Wind Says',
  biome: 'ashenspire', health: 200, damage: 3, width: 32, height: 26,
  optional: true, glyphs: 270, flying: true,
  visual: { form: 'bird', color: '#2a2b36', accent: '#b0c8ff', wings: 6, preferredRange: 100 },
  lore: 'At the top of the Spire the wind forms words. This is what the words are for.',
  phases: [
    {
      id: 'p1', name: 'Circling', healthThreshold: 1,
      patterns: [
        dive({ telegraph: 0.55, recovery: 0.9, damage: 3 }),
        ringBurst({ count: 10, telegraph: 0.7, recovery: 0.9, color: '#b0c8ff' }),
      ],
    },
    {
      id: 'p2', name: 'Stooping', healthThreshold: 0.55, aggression: 1.4,
      patterns: [
        dive({ telegraph: 0.4, recovery: 0.7, speed: 400, damage: 3 }),
        skyfall({ telegraph: 0.65, recovery: 0.85, duration: 2.2, damage: 2 }),
        spiral({ telegraph: 0.55, recovery: 0.8, arms: 3 }),
      ],
    },
    {
      id: 'p3', name: 'Screaming', healthThreshold: 0.25, aggression: 1.7, minTelegraph: 0.28,
      patterns: [
        dive({ telegraph: 0.3, recovery: 0.6, speed: 460, damage: 3 }),
        ringBurst({ count: 22, rings: 3, telegraph: 0.45, recovery: 0.7 }),
        summon({ enemy: 'galewing', count: 3, telegraph: 0.7, recovery: 0.9 }),
      ],
    },
  ],
});

// =========================================================================
// THE AURIC DEEP
// =========================================================================

defineBoss({
  id: 'gildedchoir', name: 'The Gilded Choir', title: 'Three Voices, One Throat',
  biome: 'auricdeep', health: 240, damage: 3, width: 30, height: 34,
  glyphs: 320, rewardAbility: 'deepwell',
  visual: { form: 'choir', color: '#2e2410', accent: '#ffd070', mouths: 3, preferredRange: 86 },
  lore: 'They were one archivist. The gold got in and gave each opinion its own mouth.',
  phases: [
    {
      id: 'p1', name: 'Unison', healthThreshold: 1,
      patterns: [
        ringBurst({ count: 12, telegraph: 0.75, recovery: 1, color: '#ffd070' }),
        aimedVolley({ shots: 4, telegraph: 0.6, recovery: 0.8 }),
      ],
    },
    {
      id: 'p2', name: 'Harmony', healthThreshold: 0.68, aggression: 1.25,
      patterns: [
        ringBurst({ count: 16, rings: 2, telegraph: 0.6, recovery: 0.85 }),
        spiral({ telegraph: 0.6, recovery: 0.9, arms: 3, color: '#ffd070' }),
        beam({ telegraph: 0.8, recovery: 1, damage: 3 }),
      ],
    },
    {
      id: 'p3', name: 'Discord', healthThreshold: 0.32, aggression: 1.6, minTelegraph: 0.28,
      patterns: [
        ringBurst({ count: 24, rings: 3, telegraph: 0.48, recovery: 0.7, interval: 0.2 }),
        spiral({ telegraph: 0.45, recovery: 0.75, arms: 5, interval: 0.06 }),
        blinkStrike({ telegraph: 0.35, recovery: 0.7, damage: 3 }),
        summon({ enemy: 'goldeel', count: 2, telegraph: 0.7, recovery: 0.9 }),
      ],
    },
  ],
});

defineBoss({
  id: 'anchorofthedeep', name: 'The Anchor', title: 'Ate The Chain',
  biome: 'auricdeep', health: 270, damage: 3, width: 38, height: 34, optional: true, glyphs: 350,
  visual: { form: 'grub', color: '#1a1508', accent: '#ffd070', segments: 8, preferredRange: 60 },
  lore: 'Started with the anchor. Worked outward. Has not been interrupted since.',
  phases: [
    {
      id: 'p1', name: 'Coiled', healthThreshold: 1,
      patterns: [
        groundSpikes({ telegraph: 0.7, recovery: 0.95, count: 8, damage: 3 }),
        whirl({ telegraph: 0.6, recovery: 1, damage: 3 }),
      ],
    },
    {
      id: 'p2', name: 'Uncoiled', healthThreshold: 0.5, aggression: 1.45, minTelegraph: 0.3,
      patterns: [
        groundSpikes({ telegraph: 0.5, recovery: 0.7, count: 13, interval: 0.09, damage: 3 }),
        whirl({ telegraph: 0.45, recovery: 0.85, damage: 3, driftSpeed: 120 }),
        leapSmash({ telegraph: 0.45, recovery: 0.7, damage: 3 }),
      ],
    },
  ],
});

// =========================================================================
// THE LAST WEIR — the endgame sequence
// =========================================================================

defineBoss({
  id: 'weirwrightprime', name: 'Weirwright Prime', title: 'Signed The Plans',
  biome: 'lastweir', health: 280, damage: 3, width: 28, height: 36,
  glyphs: 400, rewardAbility: 'tidemark',
  visual: { form: 'humanoid', color: '#243040', accent: '#70e0ff', armoured: true, preferredRange: 68 },
  lore: 'Designed a dam rated for a century, and has spent every year since the century arguing with it.',
  phases: [
    {
      id: 'p1', name: 'Specification', healthThreshold: 1,
      patterns: [
        sweep({ telegraph: 0.55, recovery: 0.8, damage: 3 }),
        aimedVolley({ shots: 4, telegraph: 0.55, recovery: 0.75, color: '#70e0ff' }),
        guardCounter({ telegraph: 0.4, recovery: 0.8, damage: 3 }),
      ],
    },
    {
      id: 'p2', name: 'Revision', healthThreshold: 0.68, aggression: 1.3,
      patterns: [
        sweep({ telegraph: 0.42, recovery: 0.65, damage: 3 }),
        dashAcross({ telegraph: 0.4, recovery: 0.65, speed: 430 }),
        beam({ telegraph: 0.7, recovery: 0.9, damage: 3 }),
        groundSpikes({ telegraph: 0.55, recovery: 0.8, count: 9, damage: 3 }),
      ],
    },
    {
      id: 'p3', name: 'Failure Mode', healthThreshold: 0.34, aggression: 1.65, minTelegraph: 0.28,
      patterns: [
        sweep({ telegraph: 0.32, recovery: 0.52, damage: 3 }),
        blinkStrike({ telegraph: 0.34, recovery: 0.65, damage: 3 }),
        beam({ telegraph: 0.5, recovery: 0.75, length: 340, damage: 3 }),
        ringBurst({ count: 20, rings: 3, telegraph: 0.45, recovery: 0.7 }),
        whirl({ telegraph: 0.4, recovery: 0.8, damage: 3, driftSpeed: 140 }),
      ],
    },
  ],
});

defineBoss({
  id: 'thelastweir', name: 'The Last Weir', title: 'The Hand Still Holding',
  biome: 'lastweir', health: 360, damage: 3, width: 44, height: 44,
  glyphs: 600,
  visual: { form: 'weir', color: '#0d1114', accent: '#70e0ff', preferredRange: 90 },
  lore: 'Not a creature. A structure that has been holding one position for so long that holding became a will.',
  phases: [
    {
      id: 'p1', name: 'Holding', healthThreshold: 1,
      patterns: [
        slam({ telegraph: 0.7, recovery: 0.9, damage: 3, width: 100 }),
        beam({ telegraph: 0.8, recovery: 1, damage: 3, length: 300 }),
        ringBurst({ count: 14, telegraph: 0.65, recovery: 0.85, color: '#70e0ff' }),
      ],
    },
    {
      id: 'p2', name: 'Straining', healthThreshold: 0.72, aggression: 1.25,
      patterns: [
        slam({ telegraph: 0.55, recovery: 0.75, damage: 3, waveSpeed: 240 }),
        skyfall({ telegraph: 0.7, recovery: 0.9, duration: 2.4, damage: 2 }),
        spiral({ telegraph: 0.6, recovery: 0.85, arms: 3 }),
        groundSpikes({ telegraph: 0.55, recovery: 0.78, count: 10, damage: 3 }),
      ],
    },
    {
      id: 'p3', name: 'Cracking', healthThreshold: 0.45, aggression: 1.5, minTelegraph: 0.3,
      patterns: [
        slam({ telegraph: 0.45, recovery: 0.65, damage: 3, waveSpeed: 280 }),
        beam({ telegraph: 0.55, recovery: 0.8, length: 360, damage: 3 }),
        ringBurst({ count: 22, rings: 3, telegraph: 0.5, recovery: 0.72 }),
        summon({ enemy: 'floodhound', count: 2, telegraph: 0.7, recovery: 0.9 }),
      ],
    },
    {
      id: 'p4', name: 'Giving', healthThreshold: 0.2, aggression: 1.85, minTelegraph: 0.28,
      patterns: [
        slam({ telegraph: 0.4, recovery: 0.58, damage: 3, waveSpeed: 320 }),
        spiral({ telegraph: 0.4, recovery: 0.68, arms: 5, interval: 0.055 }),
        skyfall({ telegraph: 0.5, recovery: 0.72, duration: 2.8, interval: 0.09, damage: 3 }),
        ringBurst({ count: 26, rings: 4, telegraph: 0.42, recovery: 0.65, interval: 0.18 }),
        beam({ telegraph: 0.45, recovery: 0.68, length: 400, damage: 3 }),
      ],
    },
  ],
});

// =========================================================================
// SECRET AND OPTIONAL BOSSES
// =========================================================================

defineBoss({
  id: 'firstquill', name: 'The First Quill', title: 'Wrote The Opening Line',
  biome: 'blankmargin', health: 300, damage: 3, width: 24, height: 34,
  optional: true, secret: true, glyphs: 500,
  visual: { form: 'humanoid', color: '#c4bfb4', accent: '#2a2620', inverted: true, preferredRange: 62 },
  lore: 'The Scrivener who began the record. Waited in the margin to see whether anyone would finish it.',
  phases: [
    {
      id: 'p1', name: 'The Opening', healthThreshold: 1, minTelegraph: 0.32,
      patterns: [
        sweep({ telegraph: 0.42, recovery: 0.62, damage: 3 }),
        blinkStrike({ telegraph: 0.4, recovery: 0.72, damage: 3 }),
        aimedVolley({ shots: 5, telegraph: 0.45, recovery: 0.65, color: '#2a2620' }),
      ],
    },
    {
      id: 'p2', name: 'The Middle', healthThreshold: 0.7, aggression: 1.4, minTelegraph: 0.3,
      patterns: [
        sweep({ telegraph: 0.34, recovery: 0.52, damage: 3 }),
        blinkStrike({ telegraph: 0.32, recovery: 0.6, damage: 3 }),
        dashAcross({ telegraph: 0.32, recovery: 0.55, speed: 470 }),
        ringBurst({ count: 18, rings: 2, telegraph: 0.45, recovery: 0.65 }),
      ],
    },
    {
      id: 'p3', name: 'The Close', healthThreshold: 0.38, aggression: 1.8, minTelegraph: 0.28,
      patterns: [
        sweep({ telegraph: 0.3, recovery: 0.46, damage: 3 }),
        blinkStrike({ telegraph: 0.28, recovery: 0.55, damage: 3 }),
        spiral({ telegraph: 0.38, recovery: 0.62, arms: 5, interval: 0.055 }),
        beam({ telegraph: 0.42, recovery: 0.62, length: 380, damage: 3 }),
        whirl({ telegraph: 0.35, recovery: 0.7, damage: 3, driftSpeed: 160 }),
      ],
    },
  ],
});

defineBoss({
  id: 'theerasure', name: 'The Erasure', title: 'What Was Struck Out',
  biome: 'inkbelow', health: 330, damage: 3, width: 40, height: 38,
  optional: true, secret: true, glyphs: 550,
  visual: { form: 'blob', color: '#0e0e14', accent: '#c04070', preferredRange: 76 },
  lore: 'Every deletion the record ever made, pooled at the bottom and given a shape by pressure alone.',
  phases: [
    {
      id: 'p1', name: 'Spreading', healthThreshold: 1,
      patterns: [
        ringBurst({ count: 16, telegraph: 0.6, recovery: 0.85, color: '#c04070' }),
        slam({ telegraph: 0.6, recovery: 0.8, damage: 3 }),
        summon({ enemy: 'erasurefleck', count: 4, telegraph: 0.7, recovery: 0.9 }),
      ],
    },
    {
      id: 'p2', name: 'Deepening', healthThreshold: 0.66, aggression: 1.45, minTelegraph: 0.3,
      patterns: [
        ringBurst({ count: 22, rings: 2, telegraph: 0.48, recovery: 0.7 }),
        groundSpikes({ telegraph: 0.5, recovery: 0.72, count: 12, damage: 3 }),
        blinkStrike({ telegraph: 0.34, recovery: 0.62, damage: 3 }),
      ],
    },
    {
      id: 'p3', name: 'Complete', healthThreshold: 0.3, aggression: 1.9, minTelegraph: 0.28,
      patterns: [
        ringBurst({ count: 28, rings: 4, telegraph: 0.42, recovery: 0.62, interval: 0.16 }),
        spiral({ telegraph: 0.38, recovery: 0.6, arms: 6, interval: 0.05 }),
        skyfall({ telegraph: 0.48, recovery: 0.68, duration: 3, interval: 0.08, damage: 3 }),
        whirl({ telegraph: 0.32, recovery: 0.65, damage: 3, driftSpeed: 170 }),
      ],
    },
  ],
});

defineBoss({
  id: 'ninthstroke', name: 'The Ninth Stroke', title: 'And Then The Tenth',
  biome: 'ninestrokes', health: 290, damage: 3, width: 26, height: 34,
  optional: true, glyphs: 480,
  visual: { form: 'humanoid', color: '#403040', accent: '#ff70a0', preferredRange: 58 },
  lore: 'The trial has nine rounds. Nobody has ever explained the tenth, and everyone who reaches it stops asking.',
  phases: [
    {
      id: 'p1', name: 'Ninth', healthThreshold: 1, minTelegraph: 0.3,
      patterns: [
        sweep({ telegraph: 0.38, recovery: 0.56, damage: 3 }),
        dashAcross({ telegraph: 0.35, recovery: 0.58, speed: 440 }),
        guardCounter({ telegraph: 0.32, recovery: 0.65, damage: 3 }),
      ],
    },
    {
      id: 'p2', name: 'Tenth', healthThreshold: 0.5, aggression: 1.8, minTelegraph: 0.28,
      patterns: [
        sweep({ telegraph: 0.3, recovery: 0.45, damage: 3 }),
        dashAcross({ telegraph: 0.28, recovery: 0.5, speed: 500 }),
        blinkStrike({ telegraph: 0.3, recovery: 0.55, damage: 3 }),
        whirl({ telegraph: 0.32, recovery: 0.62, damage: 3, driftSpeed: 180 }),
      ],
    },
  ],
});

// --- Mini-bosses / guardians ------------------------------------------------

defineBoss({
  id: 'shallowsentinel', name: 'The Shallow Sentinel', title: 'Guards A Door',
  biome: 'saltshallows', health: 45, damage: 1, width: 22, height: 26, optional: true, glyphs: 40,
  visual: { form: 'sentinel', color: '#6f6a5c', accent: '#e8dcc0', shield: true, preferredRange: 54 },
  lore: 'The door is open. It has not been told.',
  phases: [
    {
      id: 'p1', name: 'Post', healthThreshold: 1,
      patterns: [
        sweep({ telegraph: 0.75, recovery: 1 }),
        guardCounter({ telegraph: 0.45, recovery: 0.9 }),
      ],
    },
  ],
});

defineBoss({
  id: 'archivewurm', name: 'The Archive Wurm', title: 'Reads By Eating',
  biome: 'sunkenarchive', health: 70, damage: 1, width: 26, height: 20, optional: true, glyphs: 70,
  visual: { form: 'worm', color: '#2c3a44', accent: '#7fd4d8', segments: 5, preferredRange: 60 },
  lore: 'Has consumed more of the collection than any scholar has read. Retains none of it.',
  phases: [
    {
      id: 'p1', name: 'Feeding', healthThreshold: 1,
      patterns: [
        leapSmash({ telegraph: 0.65, recovery: 0.95 }),
        groundSpikes({ telegraph: 0.7, recovery: 0.9, count: 4 }),
      ],
    },
  ],
});

defineBoss({
  id: 'brasswatch', name: 'The Brass Watch', title: 'Three Movements',
  biome: 'clockspill', health: 130, damage: 2, width: 24, height: 28, optional: true, glyphs: 150,
  visual: { form: 'gear', color: '#584a30', accent: '#8fd0ff', teeth: 10, preferredRange: 72 },
  lore: 'Keeps perfect time for exactly three minutes, then must be rewound. Nobody has rewound it.',
  phases: [
    {
      id: 'p1', name: 'First Movement', healthThreshold: 1,
      patterns: [
        ringBurst({ count: 10, telegraph: 0.7, recovery: 0.9, color: '#8fd0ff' }),
        dashAcross({ telegraph: 0.5, recovery: 0.8 }),
      ],
    },
    {
      id: 'p2', name: 'Second Movement', healthThreshold: 0.55, aggression: 1.35,
      patterns: [
        ringBurst({ count: 14, rings: 2, telegraph: 0.55, recovery: 0.78 }),
        dashAcross({ telegraph: 0.38, recovery: 0.62, speed: 420 }),
        sweep({ telegraph: 0.42, recovery: 0.65, damage: 2 }),
      ],
    },
  ],
});

defineBoss({
  id: 'kilnwarden', name: 'The Kiln Warden', title: 'Keeps The Fire',
  biome: 'cinderloom', health: 120, damage: 2, width: 26, height: 28, optional: true, glyphs: 140,
  visual: { form: 'automaton', color: '#381c16', accent: '#ffd27a', glow: 0.9, preferredRange: 66 },
  lore: 'Has kept the fire lit since before the fall. Would like you to appreciate that.',
  phases: [
    {
      id: 'p1', name: 'Stoking', healthThreshold: 1,
      patterns: [
        slam({ telegraph: 0.7, recovery: 0.95, damage: 2 }),
        aimedVolley({ shots: 3, telegraph: 0.6, recovery: 0.8, color: '#ff9a4a' }),
      ],
    },
    {
      id: 'p2', name: 'Roaring', healthThreshold: 0.5, aggression: 1.35,
      patterns: [
        slam({ telegraph: 0.55, recovery: 0.8, damage: 2 }),
        spiral({ telegraph: 0.6, recovery: 0.85, arms: 2, color: '#ff9a4a' }),
        dashAcross({ telegraph: 0.42, recovery: 0.68, speed: 380 }),
      ],
    },
  ],
});

defineBoss({
  id: 'quarrymother', name: 'The Quarry Mother', title: 'Digs Downward',
  biome: 'marrowterraces', health: 140, damage: 2, width: 30, height: 26, optional: true, glyphs: 160,
  visual: { form: 'grub', color: '#2e2a26', accent: '#e8dcc8', segments: 5, preferredRange: 58 },
  lore: 'Every terrace is a year of her work. She is not finished, and does not intend to be.',
  phases: [
    {
      id: 'p1', name: 'Cutting', healthThreshold: 1,
      patterns: [
        groundSpikes({ telegraph: 0.7, recovery: 0.9, count: 6, damage: 2 }),
        leapSmash({ telegraph: 0.55, recovery: 0.85, damage: 2 }),
      ],
    },
    {
      id: 'p2', name: 'Deepening', healthThreshold: 0.48, aggression: 1.35,
      patterns: [
        groundSpikes({ telegraph: 0.55, recovery: 0.75, count: 10, damage: 2 }),
        leapSmash({ telegraph: 0.44, recovery: 0.7, damage: 2 }),
        summon({ enemy: 'terracechunk', count: 3, telegraph: 0.75, recovery: 0.9 }),
      ],
    },
  ],
});

defineBoss({
  id: 'thelampkeeper', name: 'The Lampkeeper', title: 'Lights The Way Back',
  biome: 'umbralfen', health: 115, damage: 2, width: 22, height: 30, optional: true, glyphs: 130,
  visual: { form: 'lamp', color: '#12181f', accent: '#8f7fd8', glow: 1, preferredRange: 82 },
  lore: 'Offers to guide you out. Has never once been asked where "out" is.',
  phases: [
    {
      id: 'p1', name: 'Offering', healthThreshold: 1,
      patterns: [
        ringBurst({ count: 9, telegraph: 0.75, recovery: 0.95, color: '#8f7fd8' }),
        blinkStrike({ telegraph: 0.55, recovery: 0.95, damage: 2 }),
      ],
    },
    {
      id: 'p2', name: 'Insisting', healthThreshold: 0.5, aggression: 1.4,
      patterns: [
        ringBurst({ count: 14, rings: 2, telegraph: 0.55, recovery: 0.78 }),
        blinkStrike({ telegraph: 0.42, recovery: 0.75, damage: 2 }),
        spiral({ telegraph: 0.55, recovery: 0.8, arms: 2 }),
      ],
    },
  ],
});

defineBoss({
  id: 'prismtwin', name: 'The Prism Twin', title: 'Second Opinion',
  biome: 'glasswake', health: 125, damage: 2, width: 22, height: 30, optional: true, glyphs: 145,
  visual: { form: 'prism', color: '#405275', accent: '#e0b8ff', facets: 4, preferredRange: 64 },
  lore: 'When the Faceted One speaks in six voices, this is the one that disagrees.',
  phases: [
    {
      id: 'p1', name: 'Disagreeing', healthThreshold: 1,
      patterns: [
        blinkStrike({ telegraph: 0.5, recovery: 0.9, damage: 2 }),
        ringBurst({ count: 8, telegraph: 0.65, recovery: 0.9, color: '#e0b8ff' }),
      ],
    },
    {
      id: 'p2', name: 'Insisting', healthThreshold: 0.5, aggression: 1.4, minTelegraph: 0.3,
      patterns: [
        blinkStrike({ telegraph: 0.38, recovery: 0.7, damage: 2 }),
        ringBurst({ count: 14, rings: 2, telegraph: 0.5, recovery: 0.72 }),
        sweep({ telegraph: 0.4, recovery: 0.62, damage: 2 }),
      ],
    },
  ],
});

defineBoss({
  id: 'thefirstweir', name: 'The First Weir', title: 'The One That Failed',
  biome: 'inkbelow', health: 260, damage: 3, width: 36, height: 36,
  optional: true, secret: true, glyphs: 420,
  visual: { form: 'weir', color: '#161620', accent: '#4060c0', preferredRange: 88 },
  lore: 'Before the Last Weir there was a first one. It is down here because it did not hold, and it knows.',
  phases: [
    {
      id: 'p1', name: 'Remembering', healthThreshold: 1,
      patterns: [
        beam({ telegraph: 0.7, recovery: 0.9, damage: 3, color: '#4060c0' }),
        slam({ telegraph: 0.6, recovery: 0.82, damage: 3 }),
      ],
    },
    {
      id: 'p2', name: 'Repeating', healthThreshold: 0.55, aggression: 1.5, minTelegraph: 0.3,
      patterns: [
        beam({ telegraph: 0.5, recovery: 0.72, length: 340, damage: 3 }),
        slam({ telegraph: 0.45, recovery: 0.65, damage: 3, waveSpeed: 300 }),
        ringBurst({ count: 20, rings: 3, telegraph: 0.45, recovery: 0.68 }),
        skyfall({ telegraph: 0.55, recovery: 0.75, duration: 2.6, damage: 3 }),
      ],
    },
  ],
});
