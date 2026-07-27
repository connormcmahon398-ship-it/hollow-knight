/**
 * @file NPCs and their dialogue trees — 32 characters.
 *
 * ## Dialogue as a state machine over world flags
 * Each NPC is a set of *nodes*; which node they open with is decided by a
 * `condition` evaluated against world flags and progression. That is how a
 * character can react to a boss you felled two regions ago without anybody
 * writing a branching script: the world's state is the branch.
 *
 * ## Writing rule
 * Nobody in Aetherweir explains the setting to you. They talk about their own
 * business, and the setting is the residue. A character who says "as you know,
 * the weirs hold back the aether" is a character who has been written badly.
 */

/**
 * @typedef {Object} DialogueNode
 * @property {string} id
 * @property {string[]} lines
 * @property {(ctx: any) => boolean} [condition] When true, this node is preferred.
 * @property {number} [priority] Higher wins among satisfied conditions.
 * @property {Array<{text: string, effect?: string, next?: string, record?: number}>} [choices]
 * @property {string} [setsFlag]
 * @property {string} [givesItem]
 */

/**
 * @typedef {Object} NpcDef
 * @property {string} id
 * @property {string} name
 * @property {string} title
 * @property {string} biome
 * @property {string} [faction]
 * @property {DialogueNode[]} nodes
 */

/** @type {Map<string, NpcDef>} */
export const NPCS = new Map();

/** @param {NpcDef} def */
function npc(def) {
  if (NPCS.has(def.id)) throw new Error(`Duplicate NPC "${def.id}"`);
  NPCS.set(def.id, def);
}

/** @param {string} id @returns {NpcDef|undefined} */
export function getNpc(id) { return NPCS.get(id); }
/** @returns {NpcDef[]} */
export function allNpcs() { return [...NPCS.values()]; }

/**
 * Choose which node an NPC opens with, given world state.
 * @param {NpcDef} def
 * @param {any} ctx
 * @returns {DialogueNode}
 */
export function selectNode(def, ctx) {
  let best = def.nodes[0];
  let bestPriority = -Infinity;
  for (const node of def.nodes) {
    if (!node.condition) continue;
    let ok = false;
    try { ok = node.condition(ctx); } catch { ok = false; }
    if (!ok) continue;
    const p = node.priority ?? 0;
    if (p > bestPriority) { bestPriority = p; best = node; }
  }
  return best;
}

/** @param {any} ctx @param {string} flag @returns {boolean} */
const flag = (ctx, f) => ctx?.world?.hasFlag?.(f) === true;

// ===========================================================================

npc({
  id: 'npc_warden', name: 'Ollan', title: 'Warden of Quillrest', biome: 'quillrest', faction: 'scriveners',
  nodes: [
    { id: 'default', lines: [
      'Another Quill. Good. We are short of hands and long of opinions.',
      'You will find the Order meets on odd days and the Choir on even ones. I have stopped attending both.',
      'Record what you find. That is the whole of the instruction and it has never once been enough.',
    ]},
    { id: 'post_warden', priority: 2, condition: (c) => flag(c, 'boss:saltwarden'), lines: [
      'The Sentinel on the flats has stopped, then. It stood there four hundred years waiting for a tide.',
      'I will not pretend that is a tragedy. I will not pretend it is nothing, either.',
    ]},
    { id: 'endgame', priority: 5, condition: (c) => flag(c, 'boss:weirwrightprime'), lines: [
      'You have been to the Weir. I can see it on you; everyone comes back from there walking differently.',
      'So. You know what I know. What will you write?',
    ], choices: [
      { text: 'Everything, as it happened.', record: 3, effect: 'ending_lean_faithful' },
      { text: 'Nothing. Let it go.', record: -3, effect: 'ending_lean_redaction' },
      { text: 'Something kinder.', record: -1, effect: 'ending_lean_forgery' },
    ]},
  ],
});

npc({
  id: 'npc_cassiar', name: 'Cassiar', title: 'the Unmarked', biome: 'quillrest', faction: 'cartographers',
  nodes: [
    { id: 'default', lines: [
      'Maps. I sell maps of places I have been.',
      'There is a fellow two stalls down who sells maps of places he has not been. His are cheaper and much more popular.',
      'Bring me a Gatestone rubbing and I will fill in what I know.',
    ]},
    { id: 'mapped', priority: 2, condition: (c) => flag(c, 'gatestone:gate_shallows'), lines: [
      'The flats, then. Good. That one is easy; the difficulty of the flats is that nothing in them is difficult, and people relax.',
    ]},
  ],
});

// --- Generated from a compact table; each entry is hand-written prose. ---

npc({
  id: "npc_archivist", name: "Vell", title: "Head Archivist",
  biome: "sunkenarchive", faction: "scriveners",
  nodes: [
    { id: 'default', lines: ["The water is at the ninth shelf. I reshelved by height. It is a triage, and I know the difference.","Do not touch the ninth shelf. The ninth shelf is load-bearing now.","I have indexed to the fourteenth. Nobody has come to check. I find I do not require it."] },
  ],
});

npc({
  id: "npc_junior", name: "Ferrun", title: "Junior Archivist",
  biome: "sunkenarchive", faction: "scriveners",
  nodes: [
    { id: 'default', lines: ["If you are going deeper, take the west stair. The east one is a description of a stair.","She will not leave. I bring her food. She thanks me by title.","I have started bringing two meals. She has not noticed and I have not mentioned it."] },
  ],
});

npc({
  id: "npc_engineer", name: "Brack", title: "Works Engineer",
  biome: "verdigris", faction: "weirwrights",
  nodes: [
    { id: 'default', lines: ["The green is the pipe. Do not scrape it. Scraping it is how we lost the sixth aqueduct.","Valve seventeen opens at the fourth bell. Whether or not there is anything to let through.","I have decided that is dignity rather than malfunction. It has been a long posting."] },
  ],
});

npc({
  id: "npc_glasselder", name: "Isk", title: "Glasskin Elder",
  biome: "glasswake", faction: "glasskin",
  nodes: [
    { id: 'default', lines: ["Do not name the thin places. Naming implies they will still be there when you return.","We walk it barefoot. The sound tells us where it is thin.","You will not hear it. That is not an insult; you are not built to."] },
  ],
});

npc({
  id: "npc_glasschild", name: "Nen", title: "a Glasskin child",
  biome: "glasswake", faction: "glasskin",
  nodes: [
    { id: 'default', lines: ["My elder says you are made of ink. Is it true that you can be spilled?","One for the pane and two for the crack.","Three for the step you should not take back. Do you know the rest? Nobody knows the rest."] },
  ],
});

npc({
  id: "npc_gardener", name: "Thessaly", title: "the Gardener",
  biome: "weepinggallery", faction: "none",
  nodes: [
    { id: 'default', lines: ["I came here to die and somebody handed me a trowel. That was some time ago.","It rains. I have stopped considering why to be my business. The roses do not ask.","You may sit. The bench is dry, which in this place is a considerable claim."] },
  ],
});

npc({
  id: "npc_loomhand", name: "Corr", title: "a Loom-hand",
  biome: "cinderloom", faction: "sootwrights",
  nodes: [
    { id: 'default', lines: ["Heat is not the hazard. The hazard is that you will get used to the heat.","Third shift. Nobody has loaded thread since before I was made.","They are weaving the air. The air is coming out slightly different."] },
  ],
});

npc({
  id: "npc_kilnkeeper", name: "Ash", title: "Kiln Keeper",
  biome: "cinderloom", faction: "sootwrights",
  nodes: [
    { id: 'default', lines: ["A fire that is kept is not the same as a fire that burns. Somebody has to be here.","The fire has not gone out. I would like that noted somewhere permanent.","You are permanent, are you not? You are a Quill. Note it."] },
  ],
});

npc({
  id: "npc_marrowfarmer", name: "Dol", title: "a Marrowfolk farmer",
  biome: "marrowterraces", faction: "marrowfolk",
  nodes: [
    { id: 'default', lines: ["Do not dig on the sixth terrace. Not for what is under it. For how recently it moved.","The council has ruled the eleventh vertebra is a hill.","The eleventh vertebra has not been consulted. I raised this. I was thanked for my contribution."] },
  ],
});

npc({
  id: "npc_marrowcounter", name: "Yew", title: "the Counter",
  biome: "marrowterraces", faction: "marrowfolk",
  nodes: [
    { id: 'default', lines: ["Everything finite can be counted. That is not a comfort, it is a deadline.","Three hundred and forty. I have counted three hundred and forty.","I am told there were four hundred. I would like to know who is holding the other sixty."] },
  ],
});

npc({
  id: "npc_oracle", name: "Meriv", title: "the Fen Oracle",
  biome: "umbralfen", faction: "none",
  nodes: [
    { id: 'default', lines: ["You will want a light. I have none. I have four hundred and two maps and no light.","Map four hundred and two. It differs from four hundred and one in the position of everything.","Both are current. This is the nature of the Fen and not, as has been suggested, of me."] },
  ],
});

npc({
  id: "npc_lampwalker", name: "Sel", title: "a Lampwalker",
  biome: "umbralfen", faction: "none",
  nodes: [
    { id: 'default', lines: ["I walk with my eyes closed now. It is not worse.","The lights offer to guide you. Do not accept.","They have never lied about where they are going. That is the trouble."] },
  ],
});

npc({
  id: "npc_horologist", name: "Pel", title: "a Horologist",
  biome: "clockspill", faction: "weirwrights",
  nodes: [
    { id: 'default', lines: ["When the engine broke the calendar did not stop. It stopped agreeing with itself. That is worse.","Room seven runs eleven minutes fast. Room eight runs eleven minutes slow.","Do not carry anything between them that you are fond of."] },
  ],
});

npc({
  id: "npc_windingclerk", name: "Ovel", title: "the Winding Clerk",
  biome: "clockspill", faction: "weirwrights",
  nodes: [
    { id: 'default', lines: ["You are welcome to try. The key is where the key has always been, which is nowhere.","It needs rewinding every three minutes. I have not rewound it in some time.","I would like to say that was a decision."] },
  ],
});

npc({
  id: "npc_spirekeeper", name: "Tam", title: "the Spire Watch",
  biome: "ashenspire", faction: "weirwrights",
  nodes: [
    { id: 'default', lines: ["A recall order was sent. Two runners were dispatched. I have their names. I do not have them.","Day one thousand and six. No fleet. Weather clear. Watch maintained.","You are not a fleet. I have checked twice."] },
  ],
});

npc({
  id: "npc_diver", name: "Kelle", title: "a Deep Diver",
  biome: "auricdeep", faction: "none",
  nodes: [
    { id: 'default', lines: ["Everything down here that moves is moving against a great deal of encouragement not to.","It is not water. We call it water because the alternative is unpleasant.","We are swimming in the thing the world was made of. Say it out loud once and then stop."] },
  ],
});

npc({
  id: "npc_weirwright", name: "Orsa", title: "a Weirwright",
  biome: "lastweir", faction: "weirwrights",
  nodes: [
    { id: 'default', lines: ["Sixth bell within tolerance. Seventh within tolerance. Eighth within tolerance if we revise tolerance.","Rated for a century. Signed, sealed, filed.","\"Rated for\" is not a promise. I said so at the time. At length. To a room that had emptied."] },
  ],
});

npc({
  id: "npc_choirspeaker", name: "Vare", title: "Speaker of the Unwritten",
  biome: "quillrest", faction: "choir",
  nodes: [
    { id: 'default', lines: ["We are not asking you to lie. We are asking you to stop.","The record is a weight. We propose putting it down.","You disagree. Everyone disagrees, at first, and then they read what is in it."] },
  ],
});

npc({
  id: "npc_orderscribe", name: "Hela", title: "of the Faithful Record",
  biome: "quillrest", faction: "scriveners",
  nodes: [
    { id: 'default', lines: ["Transcribe everything. Especially the parts you would rather not.","They will tell you the record is a weight. It is. That is what a record is for.","A thing nobody has to carry did not happen."] },
  ],
});

npc({
  id: "npc_saltfarmer", name: "Bru", title: "a Salt-farmer",
  biome: "saltshallows", faction: "none",
  nodes: [
    { id: 'default', lines: ["If you are going east, the Sentinel is still there. It will not move for you. Nothing moves for anyone here.","We used to rake it. Now it rakes itself into the same ridges every night.","I have stopped pretending I am involved."] },
  ],
});

npc({
  id: "npc_tidewarden", name: "Ilm", title: "a Tide-warden",
  biome: "saltshallows", faction: "none",
  nodes: [
    { id: 'default', lines: ["You are new. Everything here is old. Be careful which of those you let win.","Marked the water line again. It has not moved in four hundred markings.","There is a difference between a job ending and a job being finished."] },
  ],
});

npc({
  id: "npc_wreckpicker", name: "Gorse", title: "a Wreck-picker",
  biome: "saltshallows", faction: "none",
  nodes: [
    { id: 'default', lines: ["Everything in the flats was once above the flats. Think about that or do not.","Brass, mostly. Some glass. Occasionally a hand.","I sell it in Quillrest. They do not ask where it came from and I do not volunteer."] },
  ],
});

npc({
  id: "npc_shelfwright", name: "Nim", title: "a Shelfwright",
  biome: "sunkenarchive", faction: "scriveners",
  nodes: [
    { id: 'default', lines: ["Higher, always higher. One day I will build a shelf at the ceiling and be finished.","I build shelves that will be underwater within the year.","This is not futility. It is a schedule."] },
  ],
});

npc({
  id: "npc_pipewalker", name: "Rell", title: "a Pipewalker",
  biome: "verdigris", faction: "weirwrights",
  nodes: [
    { id: 'default', lines: ["The valves keep their schedule. It is the only thing left in Aetherweir that does.","You can walk the whole district on the pipes if you never look down.","Looking down is not dangerous. It is only discouraging."] },
  ],
});

npc({
  id: "npc_glassnomad", name: "Vash", title: "a Glasskin Nomad",
  biome: "glasswake", faction: "glasskin",
  nodes: [
    { id: 'default', lines: ["You walk very heavily. I mean that descriptively.","We move because the wake moves. It has not moved in an age. We move anyway.","A caravan that stops is a settlement, and we have seen what happens to those."] },
  ],
});

npc({
  id: "npc_rainkeeper", name: "Bel", title: "a Rain-keeper",
  biome: "weepinggallery", faction: "none",
  nodes: [
    { id: 'default', lines: ["The plants here are the only certainly living things in Aetherweir. Do not step on them.","I do not make it rain. I keep it raining, which is a different and smaller job.","Nobody has ever asked me how."] },
  ],
});

npc({
  id: "npc_sootwright", name: "Kell", title: "a Sootwright",
  biome: "cinderloom", faction: "sootwrights",
  nodes: [
    { id: 'default', lines: ["The Loommaster still asks for thread. We stopped answering. It did not stop asking.","We made the sky its colour. Every colour it ever was.","It is very hard to explain to a loom that the sky is gone."] },
  ],
});

npc({
  id: "npc_bonewright", name: "Ser", title: "a Bonewright",
  biome: "marrowterraces", faction: "marrowfolk",
  nodes: [
    { id: 'default', lines: ["It is not a hill. I have never once thought it was a hill.","I carve the terraces. My grandmother carved the terraces.","Between us we have moved perhaps a finger of it."] },
  ],
});

npc({
  id: "npc_fenguide", name: "Oth", title: "a Fen Guide",
  biome: "umbralfen", faction: "none",
  nodes: [
    { id: 'default', lines: ["Most is a good number. Ask any of the others what their number is.","I take people in. I have never taken the same route twice, and never on purpose.","I bring most of them out."] },
  ],
});

npc({
  id: "npc_gearsmith", name: "Pell", title: "a Gearsmith",
  biome: "clockspill", faction: "weirwrights",
  nodes: [
    { id: 'default', lines: ["You are on a schedule you cannot see. Everyone here is. It is the one thing we all share.","A tooth came off somewhere. Everything since has been compensation.","I could find the tooth. I have decided the compensation is more interesting."] },
  ],
});
