/**
 * @file Items, upgrades and Seals — 62 acquirable things.
 *
 * ## Three kinds of progression, deliberately separated
 * 1. **Abilities** — permanent movement verbs. These are the Metroidvania
 *    spine, and there are relatively few of them so each one is an event.
 * 2. **Etchings** — permanent stat increases (health, ink, weapon tier). Small,
 *    numerous, and always strictly good, so finding one is never a decision.
 * 3. **Seals** — equippable modifiers with a **wax cost** and a limited budget.
 *    These are where build expression lives, because equipping one means *not*
 *    equipping another.
 *
 * Keeping them separate matters: if stat upgrades competed for slots, players
 * would hoard rather than experiment; if seals were permanent, there would be
 * no build at all.
 *
 * ## Seal design rule
 * Every seal must change *how you play*, not just a number. "+15% damage" is
 * not a seal; "your attacks deal more damage the longer you have gone without
 * being hit" is, because it changes what you do in a fight.
 */

/**
 * @typedef {Object} ItemDef
 * @property {string} id
 * @property {string} name
 * @property {string} kind 'ability'|'etching'|'seal'|'key'|'relic'
 * @property {string} description
 * @property {string} [flavour] Lore text.
 * @property {string} [ability] Ability id granted, for kind 'ability'.
 * @property {number} [waxCost] For seals.
 * @property {string} [biome] Where it is found, for the guide.
 * @property {boolean} [secret]
 * @property {(player: any, ctx: any) => void} [onAcquire]
 * @property {(player: any) => void} [onEquip]
 * @property {(player: any) => void} [onUnequip]
 */

/** @type {Map<string, ItemDef>} */
export const ITEMS = new Map();

/**
 * @param {ItemDef} def
 * @returns {ItemDef}
 */
function item(def) {
  if (ITEMS.has(def.id)) throw new Error(`Duplicate item "${def.id}"`);
  ITEMS.set(def.id, def);
  return def;
}

/** @param {string} id @returns {ItemDef|undefined} */
export function getItem(id) {
  return ITEMS.get(id);
}

/** @returns {ItemDef[]} */
export function allItems() {
  return [...ITEMS.values()];
}

// ===========================================================================
// ABILITIES — 16
// ===========================================================================

const ABILITY_PICKUPS = [
  ['skim', 'Skim', 'saltshallows'],
  ['gripscript', 'Gripscript', 'sunkenarchive'],
  ['paperwing', 'Paperwing', 'glasswake'],
  ['plumbstrike', 'Plumbstrike', 'weepinggallery'],
  ['linecast', 'Linecast', 'clockspill'],
  ['meniscus', 'Meniscus', 'auricdeep'],
  ['blotstep', 'Blotstep', 'umbralfen'],
  ['updraftsail', 'Updraft Sail', 'verdigris'],
  ['palimpsest', 'Palimpsest', 'sunkenarchive'],
  ['anchorbreak', 'Anchorbreak', 'marrowterraces'],
  ['mantle', 'Mantle', 'saltshallows'],
  ['tidemark', 'Tidemark', 'lastweir'],
  ['emberskin', 'Emberskin', 'cinderloom'],
  ['driftleaf', 'Driftleaf', 'ashenspire'],
  ['skyskim', 'Skyskim', 'glasswake'],
  ['deepwell', 'Deepwell', 'auricdeep'],
];

for (const [id, name, biome] of ABILITY_PICKUPS) {
  item({
    id: `ability_${id}`,
    name,
    kind: 'ability',
    ability: id,
    biome,
    description: `Grants the ${name} technique.`,
  });
}

// ===========================================================================
// ETCHINGS — permanent, strictly-good upgrades. 24 of them.
// ===========================================================================

/**
 * @param {string} id @param {string} name @param {string} biome
 * @param {string} desc @param {string} flavour
 * @param {(p: any) => void} apply
 */
function etching(id, name, biome, desc, flavour, apply) {
  item({
    id,
    name,
    kind: 'etching',
    biome,
    description: desc,
    flavour,
    onAcquire: apply,
  });
}

// Health: five filament etchings, spread across the world's difficulty curve.
const FILAMENT_LOCATIONS = ['saltshallows', 'sunkenarchive', 'verdigris', 'marrowterraces', 'clockspill', 'ashenspire'];
FILAMENT_LOCATIONS.forEach((biome, i) => {
  etching(
    `etch_filament_${i + 1}`,
    `Filament Etching ${romanise(i + 1)}`,
    biome,
    'Your frame holds one more filament. Maximum health increased by 1.',
    'A length of brass wire, wound and annealed. Somebody meant this to last.',
    (p) => p.health.setMax(p.health.max + 1),
  );
});

// Ink capacity.
['saltshallows', 'glasswake', 'weepinggallery', 'umbralfen', 'auricdeep'].forEach((biome, i) => {
  etching(
    `etch_reservoir_${i + 1}`,
    `Reservoir Etching ${romanise(i + 1)}`,
    biome,
    'Your reservoir deepens. Maximum ink increased by 22.',
    'The Scriveners measured a life in reservoirs. Most managed four.',
    (p) => { p.maxInk += 22; },
  );
});

// Weapon tiers.
['sunkenarchive', 'cinderloom', 'marrowterraces', 'clockspill', 'lastweir'].forEach((biome, i) => {
  etching(
    `etch_nib_${i + 1}`,
    `Nib Regrind ${romanise(i + 1)}`,
    biome,
    'Your nib is reground. All attacks deal 1 more damage.',
    'Sharpening a nib removes metal. There is a number of times this can be done.',
    (p) => { p.nibTier += 1; },
  );
});

// Ink gain and healing.
etching('etch_inkflow', 'Inkflow Etching', 'verdigris',
  'Strikes yield 40% more ink.',
  'The channel was always there. It was only ever a question of widening it.',
  (p) => { p.inkGainScale *= 1.4; });

etching('etch_quickhand', 'Quickhand Etching', 'weepinggallery',
  'Focusing is 35% faster.',
  'Speed is not haste. Haste is what you do when you have not practised.',
  (p) => { p.focusSpeedScale *= 1.35; });

etching('etch_deepdraught', 'Deep Draught Etching', 'auricdeep',
  'Focusing restores 2 filaments instead of 1.',
  'Drawn from further down, where the ink has had time to settle.',
  (p) => { p.focusPotency = 2; });

etching('etch_steadyhand', 'Steady Hand Etching', 'glasswake',
  'The dash cooldown is reduced by a third.',
  'A line drawn twice in quick succession is still one line, if the hand is steady.',
  (p) => { p.dashCooldownScale = 0.66; });

etching('etch_longreach', 'Long Reach Etching', 'ashenspire',
  'Your nib strikes 20% further.',
  'The arm did not grow. The intention did.',
  (p) => { p.reachScale = 1.2; });

etching('etch_ledger', 'Ledger Etching', 'quillrest',
  'Glyphs recovered from the fallen are increased by half.',
  'Somebody kept very careful accounts, right up until they did not.',
  (p) => { p.glyphScale = 1.5; });

etching('etch_marginnote', 'Margin Note', 'blankmargin',
  'Inscriptions reveal a second layer of text.',
  'Underneath every account, a correction nobody submitted.',
  (p) => { p.readsDeeply = true; });

etching('etch_lastword', 'Last Word Etching', 'inkbelow',
  'At one filament, your attacks deal double damage.',
  'The final entry in a ledger is always the most honest one.',
  (p) => { p.desperationDamage = true; });

// ===========================================================================
// SEALS — equippable, budget-limited, build-defining. 26 of them.
// ===========================================================================

/**
 * @param {string} id @param {string} name @param {number} wax
 * @param {string} biome @param {string} desc @param {string} flavour
 * @param {(p: any) => void} onEquip @param {(p: any) => void} onUnequip
 */
function seal(id, name, wax, biome, desc, flavour, onEquip, onUnequip) {
  item({
    id, name, kind: 'seal', waxCost: wax, biome,
    description: desc, flavour, onEquip, onUnequip,
  });
}

seal('seal_unbroken', 'Seal of the Unbroken', 3, 'glasswake',
  'Your damage rises the longer you go untouched, up to double.',
  'A vow kept is heavier than a vow made.',
  (p) => { p.sealUnbroken = true; }, (p) => { p.sealUnbroken = false; });

seal('seal_hunger', 'Seal of Hunger', 2, 'umbralfen',
  'Strikes yield much more ink, but you take one extra damage from every hit.',
  'It eats what it is given, and then it looks at you.',
  (p) => { p.inkGainScale *= 2; p.health.damageTaken += 0.5; },
  (p) => { p.inkGainScale /= 2; p.health.damageTaken -= 0.5; });

seal('seal_stillness', 'Seal of Stillness', 2, 'weepinggallery',
  'Focusing cannot be interrupted by damage, but costs double ink.',
  'Whoever wore this finished the sentence.',
  (p) => { p.sealStillness = true; }, (p) => { p.sealStillness = false; });

seal('seal_swiftline', 'Seal of the Swift Line', 2, 'clockspill',
  'You move a quarter faster and your dash refreshes instantly, but you take a quarter more damage.',
  'It is not that time moves faster. It is that you stopped waiting for it.',
  (p) => { p.speedScale = 1.25; p.health.damageTaken += 0.25; },
  (p) => { p.speedScale = 1; p.health.damageTaken -= 0.25; });

seal('seal_ballast', 'Seal of Ballast', 3, 'auricdeep',
  'You cannot be knocked back, and armour reduces every hit by 1. Your movement is a fifth slower.',
  'The Weirwrights weighted their boots. It was not superstition.',
  (p) => { p.health.armour += 1; p.noKnockback = true; p.speedScale = 0.8; },
  (p) => { p.health.armour -= 1; p.noKnockback = false; p.speedScale = 1; });

seal('seal_echo', 'Seal of the Echo', 3, 'sunkenarchive',
  'Every third strike releases a second, weaker strike behind you.',
  'Read anything aloud in the Archive and it will read it back.',
  (p) => { p.sealEcho = true; }, (p) => { p.sealEcho = false; });

seal('seal_kindling', 'Seal of Kindling', 2, 'cinderloom',
  'Your strikes set enemies alight, dealing damage over time.',
  'The Cinderloom never went out. It only ever went quiet.',
  (p) => { p.sealKindling = true; }, (p) => { p.sealKindling = false; });

seal('seal_thrift', 'Seal of Thrift', 1, 'quillrest',
  'Focusing costs a third less ink.',
  'The most valuable habit the Scriveners taught was stopping early.',
  (p) => { p.focusCostScale = 0.66; }, (p) => { p.focusCostScale = 1; });

seal('seal_lodestone', 'Seal of the Lodestone', 1, 'verdigris',
  'Glyphs from the fallen are drawn to you across the room.',
  'Iron filings, and a very patient magnet.',
  (p) => { p.sealLodestone = true; }, (p) => { p.sealLodestone = false; });

seal('seal_wanderer', 'Seal of the Wanderer', 1, 'saltshallows',
  'The map fills in as you travel, without a cartographer.',
  'Some people simply remember where they have been.',
  (p) => { p.sealWanderer = true; }, (p) => { p.sealWanderer = false; });

seal('seal_glasscut', 'Seal of the Glass Cut', 3, 'glasswake',
  'Your attacks deal much more damage, but you have one fewer filament.',
  'It cuts on the draw and on the return.',
  (p) => { p.damageBonus += 2; p.health.setMax(p.health.max - 1, false); },
  (p) => { p.damageBonus -= 2; p.health.setMax(p.health.max + 1, false); });

seal('seal_lastlight', 'Seal of the Last Light', 2, 'umbralfen',
  'You carry your own light, and the dark cannot close on you.',
  'Held up, it shows a circle. Held down, it shows a path.',
  (p) => { p.lightRadius = 200; }, (p) => { p.lightRadius = 96; });

seal('seal_rebound', 'Seal of Rebound', 2, 'weepinggallery',
  'Downward strikes bounce higher and refresh your dash.',
  'Down is only a direction if you intend to stay there.',
  (p) => { p.sealRebound = true; }, (p) => { p.sealRebound = false; });

seal('seal_tally', 'Seal of the Tally', 2, 'marrowterraces',
  'Each enemy felled without taking damage adds a stacking damage bonus.',
  'The Marrowfolk count everything. It is how they know the terraces are finite.',
  (p) => { p.sealTally = true; }, (p) => { p.sealTally = false; });

seal('seal_quiet', 'Seal of the Quiet Step', 1, 'umbralfen',
  'Enemies notice you at half the usual distance.',
  'The trick is not silence. The trick is being uninteresting.',
  (p) => { p.stealthScale = 0.5; }, (p) => { p.stealthScale = 1; });

seal('seal_counterweight', 'Seal of the Counterweight', 3, 'clockspill',
  'Perfectly timed attacks against an incoming strike deflect it.',
  'Every mechanism that lifts is a mechanism that drops something else.',
  (p) => { p.sealCounter = true; }, (p) => { p.sealCounter = false; });

seal('seal_overflow', 'Seal of Overflow', 2, 'auricdeep',
  'Ink above your maximum is not wasted; it becomes a temporary shield.',
  'The reservoir was always going to spill. The question was where.',
  (p) => { p.sealOverflow = true; }, (p) => { p.sealOverflow = false; });

seal('seal_faultline', 'Seal of the Faultline', 3, 'marrowterraces',
  'Landing from a great height creates a shockwave.',
  'The terraces did not crack. They were always cracked; we simply arrived.',
  (p) => { p.sealFaultline = true; }, (p) => { p.sealFaultline = false; });

seal('seal_secondhand', 'Seal of the Second Hand', 2, 'clockspill',
  'When you would die, you instead survive at one filament. Once per rest.',
  'It goes round faster than the others and nobody watches it.',
  (p) => { p.sealSecondHand = true; }, (p) => { p.sealSecondHand = false; });

seal('seal_transcriber', 'Seal of the Transcriber', 1, 'sunkenarchive',
  'Transcribing is instantaneous, and reveals nearby secrets.',
  'Practice, mostly. A little contempt for the source material.',
  (p) => { p.sealTranscriber = true; }, (p) => { p.sealTranscriber = false; });

seal('seal_undertow', 'Seal of the Undertow', 2, 'auricdeep',
  'You move freely in fluid even without Meniscus, and faster with it.',
  'The current was never against you. You were simply across it.',
  (p) => { p.sealUndertow = true; }, (p) => { p.sealUndertow = false; });

seal('seal_ashheart', 'Seal of the Ash Heart', 2, 'cinderloom',
  'Searing terrain no longer harms you, but ice is lethal.',
  'You cannot be warm and cold. Choose, and be thorough about it.',
  (p) => { p.sealAshHeart = true; }, (p) => { p.sealAshHeart = false; });

seal('seal_longsight', 'Seal of the Long Sight', 1, 'ashenspire',
  'The camera draws back, showing more of the room.',
  'From the Spire you can see the whole basin. It does not help.',
  (p) => { p.cameraZoom = 0.82; }, (p) => { p.cameraZoom = 1; });

seal('seal_frugal', 'Seal of the Frugal Hand', 2, 'quillrest',
  'Scripts cost half as much ink, but deal half as much damage.',
  'Twice the sentences. Half the meaning. A common trade.',
  (p) => { p.scriptCostScale = 0.5; p.scriptDamageScale = 0.5; },
  (p) => { p.scriptCostScale = 1; p.scriptDamageScale = 1; });

seal('seal_witness', 'Seal of the Witness', 3, 'blankmargin',
  'You see what the record omitted: hidden platforms, false walls, buried marks.',
  'Somebody has to have been there. Otherwise it did not happen.',
  (p) => { p.sealWitness = true; }, (p) => { p.sealWitness = false; });

seal('seal_erasure', 'Seal of Erasure', 4, 'inkbelow',
  'Your strikes remove what they touch entirely, but you gain no ink from them.',
  'It does not kill. It edits.',
  (p) => { p.sealErasure = true; p.inkGainScale = 0; },
  (p) => { p.sealErasure = false; p.inkGainScale = 1; });

// ===========================================================================
// KEYS AND RELICS — narrative items and gate keys.
// ===========================================================================

item({
  id: 'key_weirseal', name: 'The Weirwright\'s Seal', kind: 'key', biome: 'lastweir',
  description: 'Opens the final sluice.',
  flavour: 'Stamped, countersigned, and never filed.',
});
item({
  id: 'relic_firstpage', name: 'The First Page', kind: 'relic', biome: 'blankmargin', secret: true,
  description: 'The opening line of the record, in a hand nobody recognises.',
  flavour: '"Let it be written that the sky was, at that time, still above us."',
});
item({
  id: 'relic_lastpage', name: 'The Last Page', kind: 'relic', biome: 'inkbelow', secret: true,
  description: 'Blank. Deliberately.',
  flavour: 'Someone left room.',
});
item({
  id: 'relic_ferrymark', name: 'The Ferrymark', kind: 'relic', biome: 'quillrest',
  description: 'Attunes you to every Gatestone you have found.',
  flavour: 'A token for a crossing that no longer requires a ferry.',
});

/**
 * @param {number} n
 * @returns {string}
 */
function romanise(n) {
  const table = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];
  return table[n] ?? String(n);
}

/** @returns {ItemDef[]} */
export function allSeals() {
  return allItems().filter((i) => i.kind === 'seal');
}

/** @returns {ItemDef[]} */
export function allEtchings() {
  return allItems().filter((i) => i.kind === 'etching');
}

/** @returns {ItemDef[]} */
export function allUpgrades() {
  return allItems().filter((i) => i.kind === 'etching' || i.kind === 'seal');
}
