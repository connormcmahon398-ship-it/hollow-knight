/**
 * @file Movement abilities — the spine of Metroidvania progression.
 *
 * ## Why abilities are a bitmask
 * Ability checks happen in the innermost loops of the character controller
 * ("can I wall jump?" runs every frame). A `Set<string>` lookup is fine, but a
 * bitmask makes the check a single AND, makes the whole ability state a single
 * integer in the save file, and — most usefully — makes *gate requirements*
 * expressible as data: a door needing dash+doubleJump is just `SKIM | PAPERWING`.
 *
 * The world's connectivity checker (used by the world validation tool to prove
 * the game is completable) relies on that property.
 *
 * ## Design rule for ability gates
 * Each ability must open **more than one** region, and at least one ability must
 * open a shortcut back to an already-visited area. An ability that unlocks
 * exactly one door is a key, not an ability, and keys are less interesting
 * because they teach the player nothing about how to move.
 */

/**
 * Ability flags. The numeric values are part of the save format and must never
 * be reordered.
 */
/** @type {Readonly<Record<string, number>>} */
export const Ability = Object.freeze({
  NONE: 0,
  /** Horizontal burst. Crosses wide gaps and cancels momentum. */
  SKIM: 1 << 0,
  /** Cling to and jump from vertical surfaces. Opens vertical shafts. */
  GRIPSCRIPT: 1 << 1,
  /** A second jump in mid-air. */
  PAPERWING: 1 << 2,
  /** Downward strike that bounces off whatever it hits. */
  PLUMBSTRIKE: 1 << 3,
  /** Ink line that pulls the player toward anchor points. */
  LINECAST: 1 << 4,
  /** Swim freely through aether instead of sinking. */
  MENISCUS: 1 << 5,
  /** Pass through thin, marked walls. */
  BLOTSTEP: 1 << 6,
  /** Ride vertical currents upward instead of being buffeted. */
  UPDRAFTSAIL: 1 << 7,
  /** Reveal hidden geometry, inscriptions and false walls. */
  PALIMPSEST: 1 << 8,
  /** Heavy downward smash that breaks reinforced floors. */
  ANCHORBREAK: 1 << 9,
  /** Pull up onto ledges instead of sliding off them. */
  MANTLE: 1 << 10,
  /** A long, fast ground dash used for traversal and for one late gate. */
  TIDEMARK: 1 << 11,
  /** Survive and move through searing regions. */
  EMBERSKIN: 1 << 12,
  /** Slow descent, letting the player cross wide gaps from height. */
  DRIFTLEAF: 1 << 13,
  /** Air-dash: the dash may be used once while airborne. */
  SKYSKIM: 1 << 14,
  /** Doubles the ink capacity and unlocks the final region's seals. */
  DEEPWELL: 1 << 15,
});

/** Human-facing names and descriptions, used by the UI and the map legend. */
export const AbilityInfo = Object.freeze({
  [Ability.SKIM]: {
    id: 'skim',
    name: 'Skim',
    tagline: 'A stroke across the page.',
    description: 'Dash a short distance, ignoring gravity. Crosses gaps and slips past danger.',
    hint: 'Hold nothing back; the line must be drawn in one motion.',
  },
  [Ability.GRIPSCRIPT]: {
    id: 'gripscript',
    name: 'Gripscript',
    tagline: 'The margin holds what the page will not.',
    description: 'Cling to vertical surfaces and leap from them.',
    hint: 'Shafts that seemed to end may only have been unread.',
  },
  [Ability.PAPERWING]: {
    id: 'paperwing',
    name: 'Paperwing',
    tagline: 'A folded thing remembers being flat.',
    description: 'A second leap while airborne.',
    hint: 'Height was never the obstacle. Reach was.',
  },
  [Ability.PLUMBSTRIKE]: {
    id: 'plumbstrike',
    name: 'Plumbstrike',
    tagline: 'Down is a direction, and also a measure.',
    description: 'Strike downward and rebound from whatever the nib finds.',
    hint: 'Spikes are a floor to those who never touch them.',
  },
  [Ability.LINECAST]: {
    id: 'linecast',
    name: 'Linecast',
    tagline: 'Every line is a promise to return.',
    description: 'Cast an ink line to an anchor and be drawn to it.',
    hint: 'Look for the old iron rings. The Weirwrights left them everywhere.',
  },
  [Ability.MENISCUS]: {
    id: 'meniscus',
    name: 'Meniscus',
    tagline: 'The surface is a wall until you are the surface.',
    description: 'Move freely through aether rather than sinking.',
    hint: 'What drowned you now carries you.',
  },
  [Ability.BLOTSTEP]: {
    id: 'blotstep',
    name: 'Blotstep',
    tagline: 'A word struck through is still a word.',
    description: 'Step through walls that were written thin.',
    hint: 'Some stone was drawn in haste.',
  },
  [Ability.UPDRAFTSAIL]: {
    id: 'updraftsail',
    name: 'Updraft Sail',
    tagline: 'Wind is only weather until you agree with it.',
    description: 'Ride vertical currents upward.',
    hint: 'The vents of the Cinderloom are not obstacles.',
  },
  [Ability.PALIMPSEST]: {
    id: 'palimpsest',
    name: 'Palimpsest',
    tagline: 'Beneath every page, an earlier page.',
    description: 'See what was written and then written over: false walls, buried marks.',
    hint: 'Hold still, and read the room instead of crossing it.',
  },
  [Ability.ANCHORBREAK]: {
    id: 'anchorbreak',
    name: 'Anchorbreak',
    tagline: 'Some seals were meant to be broken by weight.',
    description: 'A heavy downward smash that shatters reinforced floors.',
    hint: 'The floor of the Marrow Terraces was never solid, only patient.',
  },
  [Ability.MANTLE]: {
    id: 'mantle',
    name: 'Mantle',
    tagline: 'To reach the ledge is not to hold it.',
    description: 'Catch and pull up onto ledges.',
    hint: 'Missed jumps become caught ones.',
  },
  [Ability.TIDEMARK]: {
    id: 'tidemark',
    name: 'Tidemark',
    tagline: 'The high water line of a vanished sea.',
    description: 'A long, unstoppable ground dash that shatters brittle stone.',
    hint: 'Run the length of the basin and do not stop.',
  },
  [Ability.EMBERSKIN]: {
    id: 'emberskin',
    name: 'Emberskin',
    tagline: 'Brass remembers the forge fondly.',
    description: 'Endure searing heat that would otherwise unmake you.',
    hint: 'The Cinderloom is not closed. It is only hot.',
  },
  [Ability.DRIFTLEAF]: {
    id: 'driftleaf',
    name: 'Driftleaf',
    tagline: 'Falling, slowly, is a kind of flight.',
    description: 'Slow your descent, crossing gaps no jump could.',
    hint: 'Height is distance, if you are patient.',
  },
  [Ability.SKYSKIM]: {
    id: 'skyskim',
    name: 'Skyskim',
    tagline: 'The page does not end where the ground does.',
    description: 'Your dash may be spent once in mid-air.',
    hint: 'The gap was never too wide. You were.',
  },
  [Ability.DEEPWELL]: {
    id: 'deepwell',
    name: 'Deepwell',
    tagline: 'There is more ink in you than you have ever spent.',
    description: 'Your reservoir doubles, and the deepest seals answer to you.',
    hint: 'The last weir will not open for a shallow hand.',
  },
});

/**
 * The player's ability state.
 *
 * Kept as its own object rather than fields on the player so it can be
 * serialised, diffed, and — importantly — *simulated* by the world validation
 * tool, which walks the map with hypothetical ability sets to prove every
 * required item is reachable.
 */
export class AbilitySet {
  /** @param {number} [initial] */
  constructor(initial = Ability.NONE) {
    this.flags = initial;
    /**
     * Abilities the player has but has chosen to disable. Supports optional
     * self-imposed challenge runs, which the achievement system rewards.
     */
    this.disabled = Ability.NONE;
  }

  /**
   * @param {number} ability
   * @returns {boolean}
   */
  has(ability) {
    return (this.flags & ability & ~this.disabled) === ability && ability !== 0;
  }

  /**
   * Ignores the disabled mask — used by save/load and the map legend, which
   * should show what you own rather than what is switched on.
   * @param {number} ability
   * @returns {boolean}
   */
  owns(ability) {
    return (this.flags & ability) === ability && ability !== 0;
  }

  /**
   * @param {number} required a mask of one or more abilities
   * @returns {boolean} true only if every required ability is present
   */
  hasAll(required) {
    return required === 0 || (this.flags & required & ~this.disabled) === required;
  }

  /**
   * @param {number} ability
   * @returns {boolean} true if this was newly granted
   */
  grant(ability) {
    if (this.owns(ability)) return false;
    this.flags |= ability;
    return true;
  }

  /** @param {number} ability */
  revoke(ability) {
    this.flags &= ~ability;
  }

  /** @param {number} ability @param {boolean} on */
  setEnabled(ability, on) {
    if (on) this.disabled &= ~ability;
    else this.disabled |= ability;
  }

  /** @returns {number} how many abilities are owned */
  count() {
    let n = 0;
    let f = this.flags;
    while (f) {
      n += f & 1;
      f >>>= 1;
    }
    return n;
  }

  /** @returns {number[]} owned ability flags, in unlock order */
  list() {
    /** @type {number[]} */
    const out = [];
    for (const value of Object.values(Ability)) {
      if (value !== 0 && this.owns(value)) out.push(value);
    }
    return out;
  }

  /** @returns {{flags: number, disabled: number}} */
  toJSON() {
    return { flags: this.flags, disabled: this.disabled };
  }

  /** @param {{flags?: number, disabled?: number}} data */
  load(data) {
    this.flags = data?.flags ?? 0;
    this.disabled = data?.disabled ?? 0;
  }

  /** @returns {AbilitySet} */
  clone() {
    const s = new AbilitySet(this.flags);
    s.disabled = this.disabled;
    return s;
  }
}

/**
 * Parse a human-readable requirement string into a mask.
 * Room and door content files write `"skim|paperwing"`, which is far more
 * legible than a number and is validated at load time.
 *
 * @param {string|number|null|undefined} spec
 * @returns {number}
 */
export function parseAbilityMask(spec) {
  if (spec === null || spec === undefined || spec === '') return Ability.NONE;
  if (typeof spec === 'number') return spec;
  let mask = Ability.NONE;
  for (const part of spec.split('|')) {
    const name = part.trim().toLowerCase();
    if (!name) continue;
    const found = Object.entries(AbilityInfo).find(([, info]) => info.id === name);
    if (!found) throw new Error(`parseAbilityMask: unknown ability "${name}"`);
    mask |= Number(found[0]);
  }
  return mask;
}

/**
 * @param {number} mask
 * @returns {string[]} ability ids
 */
export function abilityMaskToIds(mask) {
  /** @type {string[]} */
  const out = [];
  for (const [flag, info] of Object.entries(AbilityInfo)) {
    if ((mask & Number(flag)) !== 0) out.push(info.id);
  }
  return out;
}

/**
 * @param {number} mask
 * @returns {string} e.g. "Skim + Paperwing"
 */
export function describeAbilityMask(mask) {
  const names = [];
  for (const [flag, info] of Object.entries(AbilityInfo)) {
    if ((mask & Number(flag)) !== 0) names.push(info.name);
  }
  return names.length ? names.join(' + ') : 'None';
}
