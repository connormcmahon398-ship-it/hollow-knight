/**
 * @file Progression: inventory, equipment, and completion tracking.
 *
 * ## The wax budget
 * Seals cost **wax**, and the player's wax capacity grows slowly across the
 * game. This is the whole of the build system, and it is deliberately simple:
 * one resource, one budget, no classes or trees. A tree would imply the player
 * should specialise permanently; a budget invites them to re-specialise for the
 * fight in front of them, which is what keeps a long game from settling into one
 * strategy.
 *
 * Seals may only be changed while resting at a Wellspring. That restriction is
 * what makes the choice cost something — swapping mid-fight would let the player
 * carry every answer at once.
 */

import { Events } from '../../engine/core/events.js';
import { getItem, allItems, allUpgrades } from '../content/items.js';
import { Ability, parseAbilityMask } from '../player/abilities.js';
import { allBossDefs } from '../boss/boss.js';

export class Progression {
  /**
   * @param {Partial<import('../context.js').GameContext>} ctx
   */
  constructor(ctx) {
    this.ctx = ctx;
    this.bus = ctx.bus;

    /** Every item id the player owns. @type {Set<string>} */
    this.owned = new Set();
    /** Seals currently equipped, in order. @type {string[]} */
    this.equipped = [];
    /** Wax capacity; seals consume it. */
    this.waxCapacity = 3;
    /** Bosses defeated. @type {Set<string>} */
    this.bossesDefeated = new Set();
    /** Inscriptions transcribed. @type {Set<string>} */
    this.transcribed = new Set();

    /**
     * Narrative alignment, driven by choices at inscriptions and with NPCs.
     * Positive is faithful recording; negative is redaction. The ending is
     * chosen from this plus explicit final choices.
     */
    this.record = 0;

    this._wire();
  }

  /** @private */
  _wire() {
    if (!this.bus) return;
    this.bus.on(Events.ITEM_ACQUIRED, (e) => this.acquire(e.id));
    this.bus.on(Events.BOSS_DEFEATED, (e) => {
      this.bossesDefeated.add(e.def.id);
    });
    this.bus.on(Events.INSCRIPTION_TRANSCRIBED, (e) => {
      this.transcribed.add(e.id);
      this.record += 1;
    });
  }

  /**
   * @param {string} id
   * @returns {boolean} true if newly acquired
   */
  acquire(id) {
    if (this.owned.has(id)) return false;
    const def = getItem(id);
    if (!def) {
      console.warn(`Progression: unknown item "${id}"`);
      return false;
    }
    this.owned.add(id);
    const player = this.ctx.player;
    if (!player) return true;

    if (def.kind === 'ability' && def.ability) {
      this.grantAbilityById(def.ability);
    } else if (def.kind === 'etching') {
      def.onAcquire?.(player, this.ctx);
      this.bus?.emit(Events.UPGRADE_ACQUIRED, { id, def });
      // Etchings also widen the wax budget on a fixed cadence, so build
      // capacity grows with exploration rather than with combat.
      if (this.countOfKind('etching') % 3 === 0) {
        this.waxCapacity++;
      }
    } else if (def.kind === 'seal') {
      this.bus?.emit(Events.UPGRADE_ACQUIRED, { id, def });
      // Auto-equip if it fits and nothing is displaced; a new seal the player
      // cannot see the effect of is a worse reward.
      if (this.waxUsed + (def.waxCost ?? 1) <= this.waxCapacity) this.equip(id);
    }
    return true;
  }

  /**
   * @param {string} abilityId
   * @returns {boolean}
   */
  grantAbilityById(abilityId) {
    const player = this.ctx.player;
    if (!player) return false;
    let mask;
    try {
      mask = parseAbilityMask(abilityId);
    } catch {
      console.warn(`Progression: unknown ability "${abilityId}"`);
      return false;
    }
    return player.grantAbility(mask);
  }

  /** @returns {number} */
  get waxUsed() {
    let total = 0;
    for (const id of this.equipped) total += getItem(id)?.waxCost ?? 1;
    return total;
  }

  /** @returns {number} */
  get waxFree() {
    return this.waxCapacity - this.waxUsed;
  }

  /**
   * @param {string} id
   * @returns {boolean} whether it was equipped
   */
  equip(id) {
    if (!this.owned.has(id)) return false;
    if (this.equipped.includes(id)) return false;
    const def = getItem(id);
    if (!def || def.kind !== 'seal') return false;
    if ((def.waxCost ?? 1) > this.waxFree) return false;

    this.equipped.push(id);
    const player = this.ctx.player;
    if (player) def.onEquip?.(player);
    this.bus?.emit(Events.SEAL_EQUIPPED, { id, def });
    return true;
  }

  /**
   * @param {string} id
   * @returns {boolean}
   */
  unequip(id) {
    const i = this.equipped.indexOf(id);
    if (i < 0) return false;
    this.equipped.splice(i, 1);
    const def = getItem(id);
    const player = this.ctx.player;
    if (def && player) def.onUnequip?.(player);
    this.bus?.emit(Events.SEAL_UNEQUIPPED, { id, def });
    return true;
  }

  /**
   * @param {string} kind
   * @returns {number}
   */
  countOfKind(kind) {
    let n = 0;
    for (const id of this.owned) {
      if (getItem(id)?.kind === kind) n++;
    }
    return n;
  }

  /** @param {string} id @returns {boolean} */
  has(id) {
    return this.owned.has(id);
  }

  /**
   * Completion percentage, as shown on the pause screen and the ending card.
   *
   * Weighted so that the *interesting* content dominates: abilities and bosses
   * are worth far more than individual pickups, because a player at 90% should
   * have seen most of the game, not most of the collectibles.
   * @returns {number} 0..100
   */
  completionPercent() {
    const upgrades = allUpgrades();
    const bosses = allBossDefs();
    const abilities = allItems().filter((i) => i.kind === 'ability');

    const abilityScore = abilities.length
      ? (abilities.filter((a) => this.owned.has(a.id)).length / abilities.length) * 40
      : 0;
    const bossScore = bosses.length
      ? (this.bossesDefeated.size / bosses.length) * 35
      : 0;
    const upgradeScore = upgrades.length
      ? (upgrades.filter((u) => this.owned.has(u.id)).length / upgrades.length) * 20
      : 0;
    const loreScore = Math.min(1, this.transcribed.size / 60) * 5;

    return Math.round(abilityScore + bossScore + upgradeScore + loreScore);
  }

  /**
   * Which ending the current state qualifies for.
   *
   * The four endings are reached by *how the player treated the record*, which
   * is measured by what they transcribed, what they redacted, and the final
   * choice at the Last Weir.
   * @param {string} [finalChoice]
   * @returns {string}
   */
  determineEnding(finalChoice) {
    if (finalChoice === 'refuse' && this.owned.has('relic_lastpage')) return 'blankpage';
    if (finalChoice === 'redact' || this.record < -8) return 'redaction';
    if (finalChoice === 'forge') return 'forgery';
    return 'faithful';
  }

  /** @returns {object} */
  toJSON() {
    return {
      owned: [...this.owned],
      equipped: [...this.equipped],
      waxCapacity: this.waxCapacity,
      bossesDefeated: [...this.bossesDefeated],
      transcribed: [...this.transcribed],
      record: this.record,
    };
  }

  /**
   * @param {any} data
   */
  load(data) {
    if (!data) return;
    this.owned = new Set(data.owned ?? []);
    this.waxCapacity = data.waxCapacity ?? 3;
    this.bossesDefeated = new Set(data.bossesDefeated ?? []);
    this.transcribed = new Set(data.transcribed ?? []);
    this.record = data.record ?? 0;

    // Re-apply equipped seals through the normal path, so their effects land on
    // the freshly loaded player rather than being assumed.
    this.equipped = [];
    for (const id of data.equipped ?? []) this.equip(id);
  }
}
