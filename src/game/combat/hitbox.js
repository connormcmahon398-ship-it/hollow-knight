/**
 * @file Hitboxes, hurtboxes and the combat resolution system.
 *
 * ## Separating hitboxes from physics bodies
 * A physics body answers "where can I stand". A hitbox answers "what did my
 * blade sweep through". Conflating them is a classic mistake: it forces attack
 * ranges to match collision sizes, prevents attacks from reaching through thin
 * walls (or requires them to), and makes multi-hit attacks impossible.
 *
 * Hitboxes here are therefore independent volumes with their own lifetime,
 * owner, team and hit-tracking.
 *
 * ## Hit-tracking ("who have I already hit?")
 * Every activation of a hitbox keeps a set of targets it has struck. Without
 * this, a hitbox that stays active for eight frames deals eight instances of
 * damage to whatever it overlaps — the single most common source of "why did
 * that enemy die instantly" bugs. Multi-hit attacks opt in explicitly by
 * setting a `hitInterval`.
 *
 * ## Frame data
 * Attacks are described in *frames at 60Hz* rather than seconds, because that
 * is how combat is tuned and communicated: "6 frames of startup, 4 active, 10
 * recovery" is meaningful, "0.1s startup" is not. The system converts once.
 */

import { AABB } from '../../engine/math/aabb.js';
import { Events } from '../../engine/core/events.js';
import { makeDamage, dealDamage, DamageFlags, DamageType } from './damage.js';
import { SpatialHash } from '../../engine/math/spatial-hash.js';

/** Which side an attack belongs to. */
export const Team = Object.freeze({
  PLAYER: 'player',
  ENEMY: 'enemy',
  NEUTRAL: 'neutral',   // hits everyone; environmental traps
});

/** Seconds per frame at the tuning frame rate. */
export const FRAME = 1 / 60;

/**
 * @typedef {Object} HitboxSpec
 * @property {number} offsetX Position relative to the owner's centre, in facing space.
 * @property {number} offsetY
 * @property {number} width
 * @property {number} height
 * @property {number} damage
 * @property {string} [team]
 * @property {string} [damageType]
 * @property {number} [flags]
 * @property {number} [knockback]
 * @property {number} [knockbackAngle] radians; when omitted, derived from relative position
 * @property {number} [hitstop] frames
 * @property {number} [trauma]
 * @property {number} [poise]
 * @property {number} [activeFrames] how long the box stays live
 * @property {number} [hitInterval] seconds between repeat hits on the same target; 0 = single hit
 * @property {boolean} [pogo] whether striking with this box bounces the attacker
 * @property {number} [inkGain] resource granted to the attacker on a hit
 * @property {string} [id] identifier used for VFX and audio selection
 */

let nextHitboxId = 1;

export class Hitbox {
  constructor() {
    this.id = nextHitboxId++;
    this.box = new AABB();
    /** @type {any} */
    this.owner = null;
    this.team = Team.NEUTRAL;
    this.active = false;
    this.remaining = 0;
    this.damage = 0;
    this.damageType = DamageType.PHYSICAL;
    this.flags = DamageFlags.NONE;
    this.knockback = 0;
    this.knockbackAngle = NaN;
    this.hitstop = 0;
    this.trauma = 0;
    this.poise = 0;
    this.hitInterval = 0;
    this.pogo = false;
    this.inkGain = 0;
    this.specId = '';
    /** Targets already struck by this activation. @type {Map<any, number>} */
    this.hitTargets = new Map();
    /** Age of this activation, seconds. */
    this.age = 0;
    /** Set true once the box has connected with anything this activation. */
    this.connected = false;
    /** True when the box struck terrain rather than an entity. */
    this.hitTerrain = false;
  }

  reset() {
    this.owner = null;
    this.active = false;
    this.remaining = 0;
    this.hitTargets.clear();
    this.age = 0;
    this.connected = false;
    this.hitTerrain = false;
    this.knockbackAngle = NaN;
  }

  /**
   * Position the box in world space from its owner and facing.
   * @param {number} centerX @param {number} centerY
   * @param {number} facing -1 or 1
   * @param {HitboxSpec} spec
   */
  place(centerX, centerY, facing, spec) {
    const ox = spec.offsetX * facing;
    this.box.set(
      centerX + ox - spec.width / 2,
      centerY + spec.offsetY - spec.height / 2,
      spec.width,
      spec.height,
    );
  }
}

/**
 * A hurtbox is the volume that *receives* hits. Kept separate from the physics
 * body so that, for example, a boss can have several independently damageable
 * parts, or a small enemy can have a generous hurtbox that makes it satisfying
 * to hit without making it easy to be hit *by*.
 */
export class Hurtbox {
  /**
   * @param {any} owner must expose a `health` field
   * @param {object} [options]
   * @param {string} [options.team]
   * @param {number} [options.width] defaults to the owner body's size
   * @param {number} [options.height]
   * @param {number} [options.offsetX]
   * @param {number} [options.offsetY]
   * @param {number} [options.damageMultiplier] weak points use >1
   * @param {string} [options.partId] identifies a boss part
   */
  constructor(owner, options = {}) {
    this.owner = owner;
    this.team = options.team ?? Team.ENEMY;
    this.box = new AABB();
    this.width = options.width ?? 0;
    this.height = options.height ?? 0;
    this.offsetX = options.offsetX ?? 0;
    this.offsetY = options.offsetY ?? 0;
    this.damageMultiplier = options.damageMultiplier ?? 1;
    this.partId = options.partId ?? '';
    this.enabled = true;
    /**
     * When true the hurtbox deflects attacks instead of taking them — armoured
     * shells, shields, a boss's guard phase. The attacker is recoiled and
     * gains no resource.
     */
    this.deflects = false;
  }

  /**
   * Refresh the world-space box from the owner's body.
   * @param {import('../../engine/physics/body.js').Body} body
   * @param {number} [facing]
   */
  sync(body, facing = 1) {
    const w = this.width || body.box.w;
    const h = this.height || body.box.h;
    this.box.set(
      body.box.centerX + this.offsetX * facing - w / 2,
      body.box.centerY + this.offsetY - h / 2,
      w,
      h,
    );
  }
}

/**
 * Resolves hitbox-vs-hurtbox contacts.
 *
 * Rebuilt each step from live hurtboxes; hitboxes are tested against the hash.
 * Hitboxes are usually far fewer than hurtboxes during normal play but far more
 * during boss fights, so indexing the hurtboxes keeps the common case cheap and
 * the worst case bounded.
 */
export class CombatSystem {
  /**
   * @param {import('../../engine/core/events.js').EventBus} bus
   */
  constructor(bus) {
    this.bus = bus;
    /** @type {Hitbox[]} */
    this.hitboxes = [];
    /** @type {Hitbox[]} */
    this._pool = [];
    /** @type {Hurtbox[]} */
    this.hurtboxes = [];
    /** @type {SpatialHash<Hurtbox>} */
    this.hash = new SpatialHash(48);
    /** @type {Hurtbox[]} */
    this._queryScratch = [];
    /**
     * Terrain the player's attacks can strike for a recoil/spark, set by the
     * scene each room.
     * @type {import('../../engine/physics/tilemap.js').Tilemap|null}
     */
    this.map = null;
    /** Global damage scaling, used by difficulty options and by NG+ cycles. */
    this.playerDamageScale = 1;
    this.enemyDamageScale = 1;
    /** Counters surfaced by the debug overlay. */
    this.stats = { hitboxesActive: 0, contactsResolved: 0 };
  }

  /** @param {Hurtbox} hurtbox */
  registerHurtbox(hurtbox) {
    if (!this.hurtboxes.includes(hurtbox)) this.hurtboxes.push(hurtbox);
  }

  /** @param {Hurtbox} hurtbox */
  unregisterHurtbox(hurtbox) {
    const i = this.hurtboxes.indexOf(hurtbox);
    if (i >= 0) this.hurtboxes.splice(i, 1);
  }

  /** Remove everything (room teardown). */
  clear() {
    for (const hb of this.hitboxes) {
      hb.reset();
      this._pool.push(hb);
    }
    this.hitboxes.length = 0;
    this.hurtboxes.length = 0;
    this.hash.clear();
  }

  /**
   * Spawn a hitbox.
   * @param {any} owner
   * @param {HitboxSpec} spec
   * @param {number} centerX @param {number} centerY
   * @param {number} facing
   * @returns {Hitbox}
   */
  spawnHitbox(owner, spec, centerX, centerY, facing) {
    const hb = this._pool.pop() ?? new Hitbox();
    hb.reset();
    hb.owner = owner;
    hb.team = spec.team ?? Team.NEUTRAL;
    hb.damage = spec.damage;
    hb.damageType = spec.damageType ?? DamageType.PHYSICAL;
    hb.flags = spec.flags ?? DamageFlags.NONE;
    hb.knockback = spec.knockback ?? 0;
    hb.knockbackAngle = spec.knockbackAngle ?? NaN;
    hb.hitstop = spec.hitstop ?? 0;
    hb.trauma = spec.trauma ?? 0;
    hb.poise = spec.poise ?? 0;
    hb.hitInterval = spec.hitInterval ?? 0;
    hb.pogo = spec.pogo ?? false;
    hb.inkGain = spec.inkGain ?? 0;
    hb.specId = spec.id ?? '';
    hb.remaining = (spec.activeFrames ?? 4) * FRAME;
    hb.active = true;
    hb.place(centerX, centerY, facing, spec);
    this.hitboxes.push(hb);
    return hb;
  }

  /**
   * Spawn a hitbox that is not attached to a facing owner — used by
   * projectiles, explosions and environmental traps.
   * @param {any} owner
   * @param {HitboxSpec} spec
   * @param {number} x @param {number} y left/top corner
   * @returns {Hitbox}
   */
  spawnHitboxAt(owner, spec, x, y) {
    const hb = this.spawnHitbox(owner, spec, 0, 0, 1);
    hb.box.set(x, y, spec.width, spec.height);
    return hb;
  }

  /**
   * @param {number} dt
   */
  update(dt) {
    // Refresh the hurtbox index.
    this.hash.clear();
    for (let i = 0; i < this.hurtboxes.length; i++) {
      const hurt = this.hurtboxes[i];
      if (!hurt.enabled) continue;
      if (hurt.owner?.health?.dead) continue;
      this.hash.insertBox(hurt, hurt.box);
    }

    this.stats.hitboxesActive = 0;
    this.stats.contactsResolved = 0;

    for (let i = this.hitboxes.length - 1; i >= 0; i--) {
      const hb = this.hitboxes[i];
      hb.age += dt;
      hb.remaining -= dt;
      if (hb.remaining <= 0) {
        hb.reset();
        this._pool.push(hb);
        this.hitboxes.splice(i, 1);
        continue;
      }
      this.stats.hitboxesActive++;
      this._resolveHitbox(hb, dt);
    }
  }

  /**
   * @param {Hitbox} hb
   * @param {number} dt
   * @private
   */
  _resolveHitbox(hb, dt) {
    const candidates = this.hash.queryBox(hb.box, this._queryScratch);
    for (let i = 0; i < candidates.length; i++) {
      const hurt = candidates[i];
      if (!hurt.enabled) continue;
      if (hurt.owner === hb.owner) continue;
      if (!this._teamsHostile(hb.team, hurt.team)) continue;
      if (!hb.box.intersects(hurt.box)) continue;

      // Repeat-hit gating.
      const lastHit = hb.hitTargets.get(hurt.owner);
      if (lastHit !== undefined) {
        if (hb.hitInterval <= 0) continue;
        if (hb.age - lastHit < hb.hitInterval) continue;
      }
      hb.hitTargets.set(hurt.owner, hb.age);
      hb.connected = true;
      this.stats.contactsResolved++;

      if (hurt.deflects) {
        this._emitDeflect(hb, hurt);
        continue;
      }

      this._applyHit(hb, hurt);
    }
  }

  /**
   * @param {Hitbox} hb
   * @param {Hurtbox} hurt
   * @private
   */
  _applyHit(hb, hurt) {
    // Impact point: the centre of the overlap, which is where sparks belong.
    const impactX = (Math.max(hb.box.x, hurt.box.x) + Math.min(hb.box.right, hurt.box.right)) / 2;
    const impactY = (Math.max(hb.box.y, hurt.box.y) + Math.min(hb.box.bottom, hurt.box.bottom)) / 2;

    let dirX;
    let dirY;
    if (Number.isFinite(hb.knockbackAngle)) {
      dirX = Math.cos(hb.knockbackAngle);
      dirY = Math.sin(hb.knockbackAngle);
    } else {
      // Push the target away from the hitbox centre.
      dirX = hurt.box.centerX - hb.box.centerX;
      dirY = hurt.box.centerY - hb.box.centerY;
      if (dirX === 0 && dirY === 0) dirX = 1;
    }

    const scale = hb.team === Team.PLAYER ? this.playerDamageScale : this.enemyDamageScale;
    const payload = makeDamage({
      amount: hb.damage * hurt.damageMultiplier * scale,
      type: hb.damageType,
      flags: hb.flags,
      dirX,
      dirY,
      knockback: hb.knockback,
      hitstop: hb.hitstop,
      trauma: hb.trauma,
      poise: hb.poise,
      source: hb.owner,
      impactX,
      impactY,
    });
    payload.hitbox = hb;

    const dealt = dealDamage(hurt.owner, payload, this.bus);
    if (dealt > 0) {
      this.bus.emit(Events.ATTACK_CONNECTED, {
        attacker: hb.owner,
        target: hurt.owner,
        hitbox: hb,
        hurtbox: hurt,
        impactX,
        impactY,
        damage: dealt,
      });
      if (hb.hitstop > 0) this.bus.emit(Events.HITSTOP, { frames: hb.hitstop });
      if (hb.trauma > 0) this.bus.emit(Events.SCREEN_SHAKE, { amount: hb.trauma });
    }
  }

  /**
   * @param {Hitbox} hb
   * @param {Hurtbox} hurt
   * @private
   */
  _emitDeflect(hb, hurt) {
    this.bus.emit(Events.PARRIED, {
      attacker: hb.owner,
      target: hurt.owner,
      hitbox: hb,
      hurtbox: hurt,
      impactX: hb.box.centerX,
      impactY: hb.box.centerY,
    });
    this.bus.emit(Events.HITSTOP, { frames: 5 });
  }

  /**
   * @param {string} a @param {string} b
   * @returns {boolean}
   * @private
   */
  _teamsHostile(a, b) {
    if (a === Team.NEUTRAL || b === Team.NEUTRAL) return true;
    return a !== b;
  }

  /**
   * Does a hitbox overlap solid terrain? Used so that striking a wall produces
   * a spark and a recoil rather than passing through silently — a small detail
   * that does a lot of work for making the blade feel physical.
   * @param {Hitbox} hb
   * @returns {boolean}
   */
  hitboxTouchesTerrain(hb) {
    return this.map ? this.map.overlapsSolid(hb.box) : false;
  }

  /**
   * Find hurtboxes in a region, for abilities that need to query rather than
   * strike (homing, auto-target, area buffs).
   * @param {AABB} box
   * @param {string} hostileTo team to be hostile toward
   * @returns {Hurtbox[]}
   */
  queryHurtboxes(box, hostileTo) {
    const out = [];
    const candidates = this.hash.queryBox(box, this._queryScratch);
    for (const h of candidates) {
      if (!h.enabled || !this._teamsHostile(hostileTo, h.team)) continue;
      if (h.box.intersects(box)) out.push(h);
    }
    return out;
  }

  /**
   * Debug rendering of all combat volumes.
   * @param {import('../../engine/render/renderer.js').Renderer} renderer
   */
  debugRender(renderer) {
    for (const hb of this.hitboxes) {
      const color = hb.team === Team.PLAYER ? 'rgba(120,220,255,0.55)' : 'rgba(255,110,110,0.55)';
      renderer.strokeRect(hb.box.x, hb.box.y, hb.box.w, hb.box.h, color, 1);
    }
    for (const hurt of this.hurtboxes) {
      if (!hurt.enabled) continue;
      const color = hurt.deflects ? 'rgba(255,220,120,0.5)' : 'rgba(160,255,160,0.35)';
      renderer.strokeRect(hurt.box.x, hurt.box.y, hurt.box.w, hurt.box.h, color, 1);
    }
  }
}
