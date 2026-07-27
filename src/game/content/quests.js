/**
 * @file Quests.
 *
 * ## Quests as flag predicates, not scripts
 * A quest is a list of **stages**, each with a `complete` predicate evaluated
 * against world flags and progression. Nothing "runs" a quest; the quest system
 * simply asks each active quest whether its current stage is satisfied.
 *
 * This matters because a Metroidvania lets the player do things out of order.
 * A scripted quest breaks when the player finds the last step first; a predicate
 * quest just notices it is already done. Several quests below can legitimately
 * complete before they are started, and that is correct behaviour rather than a
 * bug to be prevented.
 */

/**
 * @typedef {Object} QuestStage
 * @property {string} id
 * @property {string} description Shown in the journal.
 * @property {(ctx: any) => boolean} complete
 * @property {string} [hint]
 */

/**
 * @typedef {Object} QuestDef
 * @property {string} id
 * @property {string} name
 * @property {string} giver NPC id.
 * @property {string} summary
 * @property {QuestStage[]} stages
 * @property {string} [reward] Item id.
 * @property {number} [glyphs]
 * @property {boolean} [optional]
 */

/** @type {Map<string, QuestDef>} */
export const QUESTS = new Map();

/** @param {QuestDef} def */
function quest(def) {
  if (QUESTS.has(def.id)) throw new Error(`Duplicate quest "${def.id}"`);
  QUESTS.set(def.id, def);
}

/** @param {string} id @returns {QuestDef|undefined} */
export function getQuest(id) { return QUESTS.get(id); }
/** @returns {QuestDef[]} */
export function allQuests() { return [...QUESTS.values()]; }

/** @param {any} c @param {string} f @returns {boolean} */
const flag = (c, f) => c?.world?.hasFlag?.(f) === true;
/** @param {any} c @param {string} i @returns {boolean} */
const owns = (c, i) => c?.progression?.has?.(i) === true;
/** @param {any} c @param {number} a @returns {boolean} */
const can = (c, a) => c?.player?.abilities?.owns?.(a) === true;

quest({
  id: 'q_first_record', name: 'The First Entry', giver: 'npc_warden',
  summary: 'Ollan asks you to transcribe something. Anything. He is not particular.',
  glyphs: 40,
  stages: [
    {
      id: 's1', description: 'Transcribe any inscription.',
      complete: (c) => (c?.player?.stats?.inscriptionsRead ?? 0) >= 1,
      hint: 'Inscriptions glow faintly. Stand at one and press Interact.',
    },
    {
      id: 's2', description: 'Return to Ollan in Quillrest.',
      complete: (c) => flag(c, 'talked:npc_warden:after_first_record'),
    },
  ],
});

quest({
  id: 'q_tide_line', name: 'The Water Line', giver: 'npc_tidewarden',
  summary: 'Ilm has marked the same water line four hundred times and would like a second opinion.',
  reward: 'seal_wanderer', optional: true,
  stages: [
    {
      id: 's1', description: 'Find the old high-water mark in the Shallows.',
      complete: (c) => flag(c, 'transcribed:salt_01'),
    },
  ],
});

quest({
  id: 'q_shelving', name: 'Load-Bearing', giver: 'npc_archivist',
  summary: 'Vell wants the ninth shelf surveyed before it becomes the eighth.',
  reward: 'seal_transcriber', glyphs: 90,
  stages: [
    {
      id: 's1', description: 'Transcribe three inscriptions in the Sunken Archive.',
      complete: (c) => ['arch_01', 'arch_02', 'arch_03']
        .filter((i) => flag(c, `transcribed:${i}`)).length >= 3,
    },
    {
      id: 's2', description: 'Report to Vell.',
      complete: (c) => flag(c, 'talked:npc_archivist:survey_done'),
    },
  ],
});

quest({
  id: 'q_valve_seventeen', name: 'Valve Seventeen', giver: 'npc_engineer',
  summary: 'Brack would like to know what is on the other side of a valve he cannot open.',
  reward: 'etch_inkflow', glyphs: 120, optional: true,
  stages: [
    {
      id: 's1', description: 'Reach the far side of the Verdigris outflow.',
      complete: (c) => flag(c, 'room:verdigris_outflow'),
      hint: 'The outflow is above the main channel. You will need to get up there.',
    },
  ],
});

quest({
  id: 'q_thin_places', name: 'The Thin Places', giver: 'npc_glasselder',
  summary: 'Isk will not name them. Isk will, however, let you find them.',
  reward: 'seal_glasscut', optional: true,
  stages: [
    {
      id: 's1', description: 'Break through three thin panes in the Glasswake.',
      complete: (c) => (c?.player?.stats?.secretsFound ?? 0) >= 3,
    },
  ],
});

quest({
  id: 'q_sixty_vertebrae', name: 'The Missing Sixty', giver: 'npc_marrowcounter',
  summary: 'Yew has counted three hundred and forty. Yew was told there were four hundred.',
  reward: 'etch_nib_3', glyphs: 200, optional: true,
  stages: [
    {
      id: 's1', description: 'Descend below the last terrace.',
      complete: (c) => flag(c, 'room:marrow_deep'),
    },
    {
      id: 's2', description: 'Tell Yew what is down there.',
      complete: (c) => flag(c, 'talked:npc_marrowcounter:told'),
    },
  ],
});

quest({
  id: 'q_four_hundred_third', name: 'The Four Hundred and Third Map', giver: 'npc_oracle',
  summary: 'Meriv would like a map drawn by somebody who is not Meriv.',
  reward: 'seal_lastlight', glyphs: 180, optional: true,
  stages: [
    {
      id: 's1', description: 'Visit every chamber of the Umbral Fen.',
      complete: (c) => (c?.mapSystem?.visited?.size ?? 0) >= 40,
    },
  ],
});

quest({
  id: 'q_the_recall', name: 'The Recall Order', giver: 'npc_spirekeeper',
  summary: 'Two runners were dispatched to the Spire. Tam has their names and not the runners.',
  reward: 'relic_ferrymark', glyphs: 260,
  stages: [
    {
      id: 's1', description: 'Find what became of the first runner.',
      complete: (c) => flag(c, 'transcribed:spire_02'),
    },
    {
      id: 's2', description: 'Reach the top of the Ashen Spire.',
      complete: (c) => flag(c, 'transcribed:spire_03'),
    },
    {
      id: 's3', description: 'Tell Tam. Or do not.',
      complete: (c) => flag(c, 'talked:npc_spirekeeper:told')
        || flag(c, 'talked:npc_spirekeeper:withheld'),
    },
  ],
});

quest({
  id: 'q_tolerance', name: 'If We Revise Tolerance', giver: 'npc_weirwright',
  summary: 'Orsa would like the strain readings taken personally. Orsa will not be going.',
  reward: 'key_weirseal', glyphs: 400,
  stages: [
    {
      id: 's1', description: 'Read the strain log at the Last Weir.',
      complete: (c) => flag(c, 'transcribed:weir_02'),
    },
    {
      id: 's2', description: 'Defeat what is holding the sluice.',
      complete: (c) => flag(c, 'boss:weirwrightprime'),
    },
  ],
});

quest({
  id: 'q_the_unwritten', name: 'The Proposal', giver: 'npc_choirspeaker',
  summary: 'Vare proposes that the record be put down. Vare would like your help putting it down.',
  optional: true,
  stages: [
    {
      id: 's1', description: 'Hear the Choir out.',
      complete: (c) => flag(c, 'talked:npc_choirspeaker:heard'),
    },
    {
      id: 's2', description: 'Redact three inscriptions, or refuse.',
      complete: (c) => flag(c, 'choir:redacted') || flag(c, 'choir:refused'),
    },
  ],
});

quest({
  id: 'q_last_page', name: 'Room Left', giver: 'npc_orderscribe',
  summary: 'Hela believes the record has a final page and that somebody left it blank on purpose.',
  reward: 'relic_lastpage', optional: true,
  stages: [
    {
      id: 's1', description: 'Descend into the Ink Below.',
      complete: (c) => flag(c, 'room:inkbelow_01'),
    },
    {
      id: 's2', description: 'Find what is at the bottom.',
      complete: (c) => flag(c, 'boss:theerasure'),
    },
  ],
});

quest({
  id: 'q_nine_strokes', name: 'Nine, And Then The Tenth', giver: 'npc_glassnomad',
  summary: 'A ring cut into a lecture-hall floor. Vash suggests you not enter it.',
  reward: 'etch_lastword', glyphs: 500, optional: true,
  stages: [
    {
      id: 's1', description: 'Survive the nine rounds.',
      complete: (c) => flag(c, 'trial:round9'),
    },
    {
      id: 's2', description: 'Survive the tenth.',
      complete: (c) => flag(c, 'boss:ninthstroke'),
    },
  ],
});

/**
 * Tracks active quests and evaluates their stages.
 * Kept minimal: a quest system that does anything clever is a quest system that
 * disagrees with the world state.
 */
export class QuestSystem {
  /** @param {any} ctx */
  constructor(ctx) {
    this.ctx = ctx;
    /** @type {Map<string, number>} quest id -> current stage index */
    this.active = new Map();
    /** @type {Set<string>} */
    this.completed = new Set();
  }

  /** @param {string} id */
  start(id) {
    if (this.completed.has(id) || this.active.has(id)) return;
    if (!QUESTS.has(id)) return;
    this.active.set(id, 0);
    this.ctx.bus?.emit('quest:started', { id, def: QUESTS.get(id) });
  }

  /** Re-evaluate every active quest. Called on any world-flag change. */
  evaluate() {
    for (const [id, stageIndex] of [...this.active]) {
      const def = QUESTS.get(id);
      if (!def) continue;
      let index = stageIndex;
      // A player who did the last step first should complete several stages at
      // once, so keep advancing while stages are already satisfied.
      while (index < def.stages.length && def.stages[index].complete(this.ctx)) {
        index++;
        this.ctx.bus?.emit('quest:advanced', { id, stage: index, def });
      }
      if (index >= def.stages.length) {
        this.active.delete(id);
        this.completed.add(id);
        this._grantReward(def);
        this.ctx.bus?.emit('quest:completed', { id, def });
      } else if (index !== stageIndex) {
        this.active.set(id, index);
      }
    }
  }

  /**
   * @param {QuestDef} def
   * @private
   */
  _grantReward(def) {
    if (def.glyphs) this.ctx.player?.addGlyphs(def.glyphs, `completed ${def.name}`);
    if (def.reward) this.ctx.progression?.acquire(def.reward);
  }

  /** @returns {Array<{def: QuestDef, stage: any}>} */
  journal() {
    const out = [];
    for (const [id, index] of this.active) {
      const def = QUESTS.get(id);
      if (def) out.push({ def, stage: def.stages[index] });
    }
    return out;
  }

  /** @returns {object} */
  toJSON() {
    return { active: [...this.active], completed: [...this.completed] };
  }

  /** @param {any} data */
  load(data) {
    if (!data) return;
    this.active = new Map(data.active ?? []);
    this.completed = new Set(data.completed ?? []);
  }
}
