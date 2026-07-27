/**
 * @file Inscriptions: the game's lore, delivered as transcription.
 *
 * ## Why lore is a mechanic here
 * The stated goal is environmental storytelling rather than exposition. The
 * trap is that "environmental storytelling" usually means a long text box
 * attached to a wall, which is exposition wearing a hat.
 *
 * The solution used here is that reading is an *act*: the player is a Quill
 * whose purpose is to record, and transcribing an inscription is a channelled
 * action that costs a moment of vulnerability and permanently adds the text to
 * their record. Lore is therefore something the player *does*, it accumulates
 * visibly, and — because the ending is determined by what was recorded — it has
 * mechanical weight.
 *
 * ## Writing rules followed here
 * 1. **No inscription explains the plot.** Each is a fragment of somebody's
 *    ordinary business. The plot is what you assemble from them.
 * 2. **Every inscription is in a voice**, not in the narrator's. Maintenance
 *    logs, complaints, warnings, half of an argument.
 * 3. **Nothing is dated in absolute terms**, because nobody down here agrees
 *    what year it is, and that disagreement is itself part of the story.
 */

/**
 * @typedef {Object} InscriptionDef
 * @property {string} id
 * @property {string} biome
 * @property {string} author Who wrote it, as the player would guess.
 * @property {string} text
 * @property {string} [deeper] Revealed only with the Margin Note etching.
 * @property {number} [recordValue] Effect on the narrative alignment.
 */

/** @type {Map<string, InscriptionDef>} */
export const INSCRIPTIONS = new Map();

/**
 * @param {InscriptionDef} def
 */
function inscribe(def) {
  if (INSCRIPTIONS.has(def.id)) throw new Error(`Duplicate inscription "${def.id}"`);
  INSCRIPTIONS.set(def.id, def);
}

/** @param {string} id @returns {InscriptionDef|undefined} */
export function getInscription(id) {
  return INSCRIPTIONS.get(id);
}

/** @returns {InscriptionDef[]} */
export function allInscriptions() {
  return [...INSCRIPTIONS.values()];
}

/**
 * @param {string} biome
 * @returns {InscriptionDef[]}
 */
export function inscriptionsForBiome(biome) {
  return allInscriptions().filter((i) => i.biome === biome);
}

// ===========================================================================

const ENTRIES = [
  // --- The Salt Shallows ---
  ['salt_01', 'saltshallows', 'a tide-warden, second shift',
    'Marked the water line again this morning. It has not moved in four hundred markings. '
    + 'I keep marking it. There is a difference between a job ending and a job being finished.'],
  ['salt_02', 'saltshallows', 'unsigned',
    'If you are reading this you have come from the wreck side. Good. The other way is also '
    + 'the wreck side. Everything here is the wreck side.'],
  ['salt_03', 'saltshallows', 'Quill of the Fourth Order',
    'Instructions for a new Quill: record what is. Not what was, unless what was is what is now. '
    + 'Not what should be, ever. The should-be is not our office.',
    'Somebody has added, in a different hand: "whose office is it then"'],
  ['salt_04', 'saltshallows', 'a salt-farmer',
    'We used to rake it. Now it rakes itself into the same ridges every night and I have '
    + 'stopped pretending I am involved.'],
  ['salt_05', 'saltshallows', 'the Sentinel\'s maintenance log',
    'Unit continues to refuse relief. Unit states the tide is due. Recommend reassignment. '
    + 'Recommend reassignment. Recommend reassignment.'],

  // --- Quillrest ---
  ['quill_01', 'quillrest', 'the Warden of Quillrest',
    'We agreed on three things when we founded this place: that the record must continue, '
    + 'that it must be true, and that we would settle the third point later.'],
  ['quill_02', 'quillrest', 'a notice on the scriptorium door',
    'The Order of the Faithful Record meets here on odd days. The Choir of Erasure meets here '
    + 'on even days. Please do not rearrange the furniture.'],
  ['quill_03', 'quillrest', 'a child, in chalk, quite low on the wall',
    'my father says the sky used to be up. i asked up where. he said just up. '
    + 'i said thats not a place. he said it was.'],
  ['quill_04', 'quillrest', 'Cassiar, cartographer',
    'I sell maps of places I have been. There are people here who sell maps of places they '
    + 'have not been. Ask them their prices. Then ask them their sources.'],

  // --- The Sunken Archive ---
  ['arch_01', 'sunkenarchive', 'the Head Archivist',
    'The water is at the ninth shelf. I have reshelved by height. This is not a cataloguing '
    + 'system, it is a triage, and I want the record to show that I know the difference.'],
  ['arch_02', 'sunkenarchive', 'a junior archivist',
    'She will not leave. I have asked. The council has asked. I have started bringing her '
    + 'food and she has started thanking me by title.'],
  ['arch_03', 'sunkenarchive', 'a shelf label, waterlogged',
    'AETHER — DISTRIBUTION — FAILURES — PROJECTED. Three volumes. Two recovered.'],
  ['arch_04', 'sunkenarchive', 'unsigned, on a beam above the waterline',
    'Everything below this line is now a description of what the Archive was. '
    + 'Everything above it is still the Archive.',
    'The line has been redrawn eleven times, each lower than the last.'],
  ['arch_05', 'sunkenarchive', 'the Head Archivist, later',
    'Indexed to the fourteenth shelf today. Nobody came. I find I do not mind. '
    + 'An index is for the future and the future is not obliged to arrive on time.'],

  // --- Verdigris Waterworks ---
  ['verd_01', 'verdigris', 'a works engineer',
    'Valve seventeen opens at the fourth bell whether or not there is anything to let through. '
    + 'I have decided this is dignity rather than malfunction.'],
  ['verd_02', 'verdigris', 'a safety notice',
    'THE GREEN IS NOT A GROWTH. THE GREEN IS THE PIPE. Do not attempt to remove the green. '
    + 'The green is what remains of the pipe.'],
  ['verd_03', 'verdigris', 'unsigned',
    'We were told the aqueducts fed the shelf. They fed the weirs. The weirs fed the shelf. '
    + 'Nobody thought to ask what fed the weirs, because the answer was: the sea, obviously, '
    + 'forever.'],

  // --- The Glasswake ---
  ['glass_01', 'glasswake', 'a Glasskin elder',
    'We do not name the thin places. Naming a thing implies it will still be there '
    + 'when you come back to say the name.'],
  ['glass_02', 'glasswake', 'unsigned, scratched into a pane',
    'It cooled in one night. Whatever it was doing before that, it was doing very fast.'],
  ['glass_03', 'glasswake', 'a Glasskin child\'s counting rhyme',
    'One for the pane and two for the crack, three for the step you should not take back, '
    + 'four for the elder, five for the wake, six for the promise the glass did not make.'],

  // --- The Weeping Gallery ---
  ['gall_01', 'weepinggallery', 'the Gardener',
    'It rains. I have not established why and I have stopped considering it my business. '
    + 'The roses do not ask.'],
  ['gall_02', 'weepinggallery', 'unsigned',
    'The only living things left in Aetherweir are on this cliff, and they are here because '
    + 'somebody kept watering them after there was no longer a reason to.'],
  ['gall_03', 'weepinggallery', 'a visitor',
    'I came here to die and the Gardener handed me a trowel.'],

  // --- The Cinderloom ---
  ['cind_01', 'cinderloom', 'a loom-hand',
    'Third shift. The looms are running. Nobody has loaded thread in longer than I have '
    + 'been alive. They are weaving the air and the air is coming out slightly different.'],
  ['cind_02', 'cinderloom', 'the Loommaster, in a hand that is clearly not human',
    'THE SKY REQUIRES ITS COLOUR. THE SKY REQUIRES ITS COLOUR. THE SKY REQUIRES',
    'Beneath, small and neat: "we told it. it did not stop. we stopped telling it."'],
  ['cind_03', 'cinderloom', 'a safety notice, half burned',
    'HEAT IS NOT THE HAZARD. THE HAZARD IS THAT YOU WILL GET USED TO THE HEAT.'],

  // --- The Marrow Terraces ---
  ['marr_01', 'marrowterraces', 'a Marrowfolk farmer',
    'The county council has ruled that the eleventh vertebra is a hill. '
    + 'The eleventh vertebra has not been consulted.'],
  ['marr_02', 'marrowterraces', 'the Matriarch',
    'I have counted three hundred and forty. I am told there were four hundred. '
    + 'I would like very much to be told who is holding the other sixty.'],
  ['marr_03', 'marrowterraces', 'unsigned',
    'Do not dig on the sixth terrace. Not because of what is under it. '
    + 'Because of how recently it moved.'],

  // --- The Umbral Fen ---
  ['fen_01', 'umbralfen', 'the Fen Oracle',
    'Map four hundred and two. Differs from four hundred and one in the position of everything. '
    + 'Both are current. This is the nature of the Fen and not, as has been suggested, of me.'],
  ['fen_02', 'umbralfen', 'a traveller',
    'The light offered to guide me. I asked where. It brightened. I took this as an answer '
    + 'and I would like the record to show that it was not one.'],
  ['fen_03', 'umbralfen', 'unsigned',
    'Something was spilled here that was never meant to leave its vessel. '
    + 'The bog is the shape of the spill. We are standing in a description of an accident.'],

  // --- The Clockspill ---
  ['clock_01', 'clockspill', 'a horologist',
    'The engine kept the shelf\'s calendar. When it broke, the calendar did not stop. '
    + 'It simply stopped agreeing with itself, which is worse.'],
  ['clock_02', 'clockspill', 'unsigned',
    'Room seven runs eleven minutes fast. Room eight runs eleven minutes slow. '
    + 'Do not carry anything between them that you are fond of.'],
  ['clock_03', 'clockspill', 'the Escapement, engraved on its own housing',
    'I DECIDE WHEN. THAT IS ALL I DECIDE. IT HAS ALWAYS BEEN ENOUGH.'],

  // --- The Ashen Spire ---
  ['spire_01', 'ashenspire', 'the Spire Keeper\'s log',
    'Day one thousand and six. No fleet. Weather clear. Watch maintained.'],
  ['spire_02', 'ashenspire', 'a recall order, never delivered',
    'ALL POSTS ARE RELIEVED. REPEAT: ALL POSTS ARE RELIEVED. Runner dispatched to the Spire. '
    + 'Runner has not returned. Second runner dispatched.'],
  ['spire_03', 'ashenspire', 'unsigned, at the very top',
    'From here you can see the whole basin, every weir, and exactly how much is left. '
    + 'I recommend not climbing this.'],

  // --- The Auric Deep ---
  ['auric_01', 'auricdeep', 'a diver',
    'It is not water. It has never been water. We call it water because the alternative '
    + 'is admitting we are swimming in the thing the world was made of.'],
  ['auric_02', 'auricdeep', 'unsigned',
    'The gold is the aether gone still. Everything down here that moves is moving because '
    + 'it decided to, against a very great deal of encouragement not to.'],

  // --- The Last Weir ---
  ['weir_01', 'lastweir', 'Weirwright Prime',
    'Rated for one century. Signed, sealed, and filed. I would like it noted that "rated for" '
    + 'is not a promise and that I said so at the time, at length, to a room that had emptied.'],
  ['weir_02', 'lastweir', 'a strain log, recent',
    'Sixth bell: within tolerance. Seventh bell: within tolerance. Eighth bell: '
    + 'within tolerance if we revise tolerance.'],
  ['weir_03', 'lastweir', 'unsigned, very large, across the gate',
    'IF YOU ARE READING THIS YOU ARE STANDING WHERE THE WATER WILL BE'],

  // --- Hidden regions ---
  ['margin_01', 'blankmargin', 'the First Quill',
    'I began the record because somebody had to. I stopped because I could not establish, '
    + 'to my own satisfaction, who it was for.',
    'The hand is identical to the instructions given to every new Quill.'],
  ['margin_02', 'blankmargin', 'unsigned',
    'This page was left blank. That is not the same as this page being empty. '
    + 'Somebody made a decision here.'],
  ['ink_01', 'inkbelow', 'unsigned',
    'Everything struck from the record had to go somewhere. Nobody asked where. '
    + 'The answer was: down, and it is still down here, and it is still a word.'],
  ['ink_02', 'inkbelow', 'a Quill of an order that no longer exists',
    'I redacted four thousand entries by hand. I was told it was mercy. '
    + 'I have come down here to check.'],
];

for (const [id, biome, author, text, deeper] of ENTRIES) {
  inscribe({ id, biome, author, text, deeper, recordValue: 1 });
}
