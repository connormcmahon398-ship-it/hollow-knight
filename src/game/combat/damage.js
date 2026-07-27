/**
 * @file Damage payloads, health pools and the resistance model.
 *
 * ## Why a payload object rather than `takeDamage(5)`?
 * Damage in this game is never just a number. The same 2 points behave
 * differently depending on whether it came from a spike (no knockback, fixed
 * recoil direction, ignores parry), a boss slam (heavy knockback, unblockable),
 * or a poison pool (ticks, bypasses invulnerability frames). Encoding all of
 * that in a payload means the health system stays simple and every new damage
 * source is expressed as data.
 *
 * ## Integer health
 * Health is integral ("filaments"), not a float. In a game where the player has
 * five hit points, fractional damage is unreadable — the player cannot tell a
 * 0.7 hit from a 1.0 one, and healing to "4.3 filaments" is meaningless. Damage
 * modifiers therefore accumulate as a multiplier and round *once*, at the end,
 * with a floor of 1 so that stacking resistances can never make an attack
 * harmless.
 */

import { Events } from '../../engine/core/events.js';

/** Broad damage categories, used for resistances and for audio/VFX selection. */
export const DamageType = Object.freeze({
  PHYSICAL: 'physical',
  INK: 'ink',           // the player's magic
  SALT: 'salt',         // corrosive, the world's dominant hazard
  AETHER: 'aether',     // arcane, ignores most armour
  VOID: 'void',         // endgame; cannot be resisted
  ENVIRONMENT: 'environment', // spikes, crush, drowning
});

/** Flags that modify how a hit is processed. */
export const DamageFlags = Object.freeze({
  NONE: 0,
  /** Ignores invulnerability frames (damage-over-time, crush). */
  BYPASS_IFRAMES: 1 << 0,
  /** Cannot be parried or blocked. */
  UNBLOCKABLE: 1 << 1,
  /** Does not apply knockback. */
  NO_KNOCKBACK: 1 << 2,
  /** Does not trigger hit-stop (used for chip damage so combat stays fluid). */
  NO_HITSTOP: 1 << 3,
  /** Always deals at least 1 damage regardless of resistance. */
  PIERCING: 1 << 4,
  /** Kills outright; used by the abyss and by certain trap rooms. */
  LETHAL: 1 << 5,
});

/**
 * A single damage event. Pooled by the combat system, so consumers must not
 * retain a reference past the frame.
 */
export class DamagePayload {
  constructor() {
    this.reset();
  }

  reset() {
    this.amount = 0;
    this.type = DamageType.PHYSICAL;
    this.flags = DamageFlags.NONE;
    /** Direction the *target* should be pushed, normalised-ish. */
    this.dirX = 0;
    this.dirY = 0;
    this.knockback = 0;
    /** Frames of hit-stop to request on a successful hit. */
    this.hitstop = 0;
    /** Screen-shake trauma to add, 0..1. */
    this.trauma = 0;
    /** @type {any} The entity that dealt the damage. */
    this.source = null;
    /** @type {any} The hitbox that produced it, when applicable. */
    this.hitbox = null;
    /** World position of the impact, for particle placement. */
    this.impactX = 0;
    this.impactY = 0;
    /** Stagger applied to enemy poise. */
    this.poise = 0;
    return this;
  }

  /** @param {number} f @returns {boolean} */
  has(f) {
    return (this.flags & f) !== 0;
  }
}

/**
 * A health pool with invulnerability frames and resistances.
 *
 * Used by the player and by every enemy, because the alternative — a separate
 * simplified enemy health field — inevitably diverges and then bugs appear only
 * on enemies.
 */
export class Health {
  /**
   * @param {number} max
   * @param {object} [options]
   * @param {number} [options.iframeDuration] seconds of invulnerability after a hit
   * @param {Partial<Record<string, number>>} [options.resistances] multiplier per DamageType
   */
  constructor(max, options = {}) {
    this.max = max;
    this.current = max;
    this.iframeDuration = options.iframeDuration ?? 0;
    this.iframeTimer = 0;
    /** @type {Record<string, number>} */
    this.resistances = { ...(options.resistances ?? {}) };
    /** Flat damage reduction applied before multipliers. */
    this.armour = 0;
    /** Multiplier applied to all incoming damage; drives difficulty modifiers. */
    this.damageTaken = 1;
    this.dead = false;
    /** Poise: when depleted, the entity staggers. Refills over time. */
    this.poise = 0;
    this.maxPoise = 0;
    this.poiseRegen = 6;
    /** True on the step the entity was staggered. */
    this.staggered = false;
    /** Damage taken this step, for UI feedback. */
    this.lastDamage = 0;
    /** Seconds since the last hit, drives hurt flashes and enemy aggression. */
    this.timeSinceHit = Infinity;
  }

  /** @param {number} dt */
  update(dt) {
    if (this.iframeTimer > 0) {
      this.iframeTimer -= dt;
      if (this.iframeTimer < 0) this.iframeTimer = 0;
    }
    this.timeSinceHit += dt;
    this.staggered = false;
    if (this.maxPoise > 0 && this.poise < this.maxPoise) {
      this.poise = Math.min(this.maxPoise, this.poise + this.poiseRegen * dt);
    }
  }

  /** @returns {boolean} */
  get invulnerable() {
    return this.iframeTimer > 0;
  }

  /** @returns {number} 0..1 */
  get fraction() {
    return this.max > 0 ? this.current / this.max : 0;
  }

  /**
   * Apply a damage payload.
   * @param {DamagePayload} payload
   * @returns {number} damage actually dealt; 0 means the hit was ignored
   */
  applyDamage(payload) {
    if (this.dead) return 0;
    if (this.invulnerable && !payload.has(DamageFlags.BYPASS_IFRAMES)) return 0;

    if (payload.has(DamageFlags.LETHAL)) {
      const dealt = this.current;
      this.current = 0;
      this.dead = true;
      this.lastDamage = dealt;
      this.timeSinceHit = 0;
      return dealt;
    }

    const resist = this.resistances[payload.type] ?? 1;
    let dmg = (payload.amount - this.armour) * resist * this.damageTaken;

    // Round once, at the end. A floor of 1 on any attack that got this far
    // guarantees that stacked resistances can never make an enemy immune by
    // accident — true immunity must be declared explicitly as resistance 0.
    if (resist <= 0) {
      dmg = 0;
    } else {
      dmg = Math.max(payload.has(DamageFlags.PIERCING) ? 1 : 0, Math.round(dmg));
      if (dmg <= 0 && payload.amount > 0) dmg = 1;
    }

    if (dmg <= 0) return 0;

    this.current = Math.max(0, this.current - dmg);
    this.lastDamage = dmg;
    this.timeSinceHit = 0;
    if (this.iframeDuration > 0 && !payload.has(DamageFlags.BYPASS_IFRAMES)) {
      this.iframeTimer = this.iframeDuration;
    }

    if (this.maxPoise > 0 && payload.poise > 0) {
      this.poise -= payload.poise;
      if (this.poise <= 0) {
        this.poise = this.maxPoise;
        this.staggered = true;
      }
    }

    if (this.current <= 0) this.dead = true;
    return dmg;
  }

  /**
   * @param {number} amount
   * @returns {number} amount actually healed
   */
  heal(amount) {
    if (this.dead) return 0;
    const before = this.current;
    this.current = Math.min(this.max, this.current + amount);
    return this.current - before;
  }

  /** Restore to full and clear death. */
  reset() {
    this.current = this.max;
    this.dead = false;
    this.iframeTimer = 0;
    this.poise = this.maxPoise;
    this.timeSinceHit = Infinity;
  }

  /**
   * Change maximum health, preserving the current value where possible.
   * @param {number} newMax
   * @param {boolean} [healDifference] top up by the amount gained
   */
  setMax(newMax, healDifference = true) {
    const gained = newMax - this.max;
    this.max = newMax;
    if (healDifference && gained > 0) this.current += gained;
    this.current = Math.min(this.current, this.max);
  }

  /**
   * Grant temporary invulnerability, e.g. after a room transition or respawn.
   * @param {number} seconds
   */
  grantIFrames(seconds) {
    this.iframeTimer = Math.max(this.iframeTimer, seconds);
  }
}

/**
 * A pool of damage payloads.
 *
 * Combat allocates a payload for every hitbox-hurtbox contact test that lands,
 * which during a boss fight with 40 projectiles on screen is a lot of tiny
 * short-lived objects.
 */
class PayloadPool {
  constructor() {
    /** @type {DamagePayload[]} */
    this._free = [];
  }

  /** @returns {DamagePayload} */
  acquire() {
    const p = this._free.pop();
    return p ? p.reset() : new DamagePayload();
  }

  /** @param {DamagePayload} p */
  release(p) {
    if (this._free.length < 128) this._free.push(p);
  }
}

export const payloadPool = new PayloadPool();

/**
 * Build a payload from a plain description. The ergonomic front door to the
 * damage system.
 *
 * @param {object} spec
 * @param {number} spec.amount
 * @param {string} [spec.type]
 * @param {number} [spec.flags]
 * @param {number} [spec.dirX] @param {number} [spec.dirY]
 * @param {number} [spec.knockback]
 * @param {number} [spec.hitstop]
 * @param {number} [spec.trauma]
 * @param {any} [spec.source]
 * @param {number} [spec.impactX] @param {number} [spec.impactY]
 * @param {number} [spec.poise]
 * @returns {DamagePayload}
 */
export function makeDamage(spec) {
  const p = payloadPool.acquire();
  p.amount = spec.amount;
  p.type = spec.type ?? DamageType.PHYSICAL;
  p.flags = spec.flags ?? DamageFlags.NONE;
  p.dirX = spec.dirX ?? 0;
  p.dirY = spec.dirY ?? 0;
  p.knockback = spec.knockback ?? 0;
  p.hitstop = spec.hitstop ?? 0;
  p.trauma = spec.trauma ?? 0;
  p.source = spec.source ?? null;
  p.impactX = spec.impactX ?? 0;
  p.impactY = spec.impactY ?? 0;
  p.poise = spec.poise ?? 0;
  return p;
}

/**
 * Convenience: apply damage to a target that owns `health` and `body`, handling
 * knockback, events and cleanup in one place.
 *
 * @param {any} target must expose `health` (Health) and optionally `body`
 * @param {DamagePayload} payload
 * @param {import('../../engine/core/events.js').EventBus} bus
 * @returns {number} damage dealt
 */
export function dealDamage(target, payload, bus) {
  if (!target || !target.health) return 0;
  const dealt = target.health.applyDamage(payload);
  if (dealt <= 0) {
    payloadPool.release(payload);
    return 0;
  }

  if (target.body && payload.knockback > 0 && !payload.has(DamageFlags.NO_KNOCKBACK)) {
    const len = Math.hypot(payload.dirX, payload.dirY) || 1;
    target.body.velocity.x = (payload.dirX / len) * payload.knockback;
    // Vertical knockback is deliberately dampened and biased upward: full
    // vertical knockback launches enemies off the screen and makes combat
    // unreadable, while a small upward pop makes hits feel like they connected.
    target.body.velocity.y = (payload.dirY / len) * payload.knockback * 0.45 - 40;
  }

  bus.emit(Events.DAMAGE_TAKEN, { target, payload, amount: dealt });
  bus.emit(Events.DAMAGE_DEALT, { source: payload.source, target, payload, amount: dealt });

  if (target.health.dead) {
    bus.queue(Events.ENTITY_KILLED, { entity: target, payload });
  }

  payloadPool.release(payload);
  return dealt;
}
