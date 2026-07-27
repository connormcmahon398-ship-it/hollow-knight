/**
 * @file Attack definitions — the frame data of the player's melee moveset.
 *
 * ## Why attacks are data
 * Combat tuning is the most iterated part of an action game. Expressing each
 * attack as a record of geometry and frame data means tuning is a diff to a
 * table rather than a rewrite of the controller, and it lets the same data drive
 * the debug overlay, the training-room readout and the tutorial prompts.
 *
 * ## Reading the numbers
 * - `offsetX/Y` are relative to the player's centre, in *facing space* (positive
 *   X is forward). The player is 11x20px, so an offset of 20 places the box just
 *   beyond arm's reach.
 * - `damageMultiplier` scales the player's base damage. The forward slash is the
 *   baseline at 1.0; specialised attacks trade damage for utility.
 * - `hitstop` is in frames at 60Hz. This is the most important feel number in
 *   the file: it is the freeze on impact that communicates weight.
 * - `poise` is stagger damage against enemies that have a poise pool.
 *
 * ## Why the up-slash is worse than the forward slash
 * Deliberate. The up-slash reaches a space the player cannot otherwise threaten
 * and, crucially, is the tool for handling flyers. Giving it equal damage would
 * make it strictly better than the forward slash for any target that can be
 * approached from below. It trades 15% damage for that coverage.
 */

/**
 * The directions an attack can be aimed.
 * @type {Readonly<Record<string, string>>}
 */
export const AttackDirection = Object.freeze({
  FORWARD: 'forward',
  UP: 'up',
  DOWN: 'down',
});

/**
 * @typedef {Object} AttackSpec
 * @property {string} id
 * @property {string} direction
 * @property {number} offsetX
 * @property {number} offsetY
 * @property {number} width
 * @property {number} height
 * @property {number} damageMultiplier
 * @property {number} knockback
 * @property {number} [knockbackAngle] radians; omit to push away from the box centre
 * @property {number} hitstop frames
 * @property {number} trauma screen shake, 0..1
 * @property {number} poise
 * @property {boolean} pogo
 * @property {string} description
 */

/** @type {Record<string, AttackSpec>} */
export const ATTACK_SPECS = Object.freeze({
  [AttackDirection.FORWARD]: {
    id: 'slash',
    direction: AttackDirection.FORWARD,
    // Reaches ~2 tiles ahead. Tall enough to hit a crouching enemy and one
    // standing on a half-block, which removes a whole class of "I swung and it
    // went over its head" frustration.
    offsetX: 19,
    offsetY: -1,
    width: 30,
    height: 26,
    damageMultiplier: 1,
    knockback: 150,
    hitstop: 5,
    trauma: 0.07,
    poise: 10,
    pogo: false,
    description: 'A level stroke of the nib.',
  },

  [AttackDirection.UP]: {
    id: 'slashUp',
    direction: AttackDirection.UP,
    offsetX: 2,
    offsetY: -21,
    width: 30,
    height: 26,
    // Slightly weaker: it covers a space nothing else reaches, and is the
    // primary answer to flyers.
    damageMultiplier: 0.85,
    knockback: 120,
    // Fixed upward angle: pushing a flyer up keeps it in the space the player
    // is already threatening, so the follow-up is natural.
    knockbackAngle: -Math.PI / 2,
    hitstop: 5,
    trauma: 0.06,
    poise: 8,
    pogo: false,
    description: 'A rising stroke, struck overhead.',
  },

  [AttackDirection.DOWN]: {
    id: 'slashDown',
    direction: AttackDirection.DOWN,
    offsetX: 1,
    offsetY: 20,
    width: 26,
    height: 28,
    // Lower damage, but it grants height and refunds the double jump. Its value
    // is mobility, and pricing it as a damage tool would make every fight a
    // pogo fight.
    damageMultiplier: 0.8,
    knockback: 110,
    knockbackAngle: Math.PI / 2,
    hitstop: 6,
    trauma: 0.1,
    poise: 12,
    pogo: true,
    description: 'A plumb stroke, straight down. The nib rebounds.',
  },
});

/**
 * Charged variants, unlocked by upgrades. Kept as a separate table because they
 * share nothing but shape with the base moveset and mixing them would make the
 * base table harder to read.
 * @type {Record<string, AttackSpec>}
 */
export const CHARGED_ATTACK_SPECS = Object.freeze({
  cleave: {
    id: 'cleave',
    direction: AttackDirection.FORWARD,
    offsetX: 24,
    offsetY: -1,
    width: 44,
    height: 34,
    damageMultiplier: 2.4,
    knockback: 300,
    hitstop: 10,
    trauma: 0.24,
    poise: 40,
    pogo: false,
    description: 'A held stroke, released in one long sweep.',
  },
  sunder: {
    id: 'sunder',
    direction: AttackDirection.DOWN,
    offsetX: 0,
    offsetY: 22,
    width: 40,
    height: 32,
    damageMultiplier: 2.1,
    knockback: 240,
    knockbackAngle: Math.PI / 2,
    hitstop: 12,
    trauma: 0.34,
    poise: 55,
    pogo: true,
    description: 'The full weight of the nib, driven downward.',
  },
});

/**
 * Total frames an attack occupies, for the debug overlay and training room.
 * @param {number} startup @param {number} active @param {number} recovery
 * @returns {{total: number, startup: number, active: number, recovery: number}}
 */
export function frameData(startup, active, recovery) {
  return { total: startup + active + recovery, startup, active, recovery };
}
