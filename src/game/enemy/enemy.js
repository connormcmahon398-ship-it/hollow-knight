/**
 * @file The base enemy entity.
 *
 * ## Data-defined enemies over an archetype library
 * Sixty-plus enemy types written as sixty-plus bespoke classes would be sixty
 * places to fix the same bug. Instead an enemy is a **definition** (stats,
 * geometry, palette, drops, behaviour parameters) bound to an **archetype** (a
 * reusable AI state machine: walker, flyer, charger, turret, and so on).
 *
 * That split means:
 *  - A new enemy is usually a data entry, reviewed as content.
 *  - Fixing "chargers overshoot ledges" fixes it for every charger at once.
 *  - The archetype library is small enough to be tested exhaustively, and the
 *    content is large enough to fill a world.
 *
 * Enemies that genuinely need unique logic supply an `onUpdate` hook or extra
 * states via `customStates`, so the system does not become a straitjacket.
 *
 * ## Aggro model
 * Enemies use *line of sight plus range*, not raw distance. An enemy that
 * notices you through a wall reads as cheating; one that must actually see you
 * reads as alive. Once alerted they keep a memory timer, so breaking line of
 * sight does not instantly reset them either.
 */

import { Body, CollisionLayer } from '../../engine/physics/body.js';
import { StateMachine } from '../../engine/core/state-machine.js';
import { Health, DamageType, makeDamage, dealDamage } from '../combat/damage.js';
import { Hurtbox, Team } from '../combat/hitbox.js';
import { Events } from '../../engine/core/events.js';
import { clamp, moveToward } from '../../engine/math/math-utils.js';
import { hasGroundBelow, isPositionFree } from '../../engine/physics/tilemap-collider.js';

/**
 * States shared by every archetype. Archetypes add their own on top.
 * @type {Readonly<Record<string, string>>}
 */
export const EnemyState = Object.freeze({
  SPAWN: 'spawn',
  IDLE: 'idle',
  PATROL: 'patrol',
  ALERT: 'alert',
  CHASE: 'chase',
  ATTACK: 'attack',
  WINDUP: 'windup',
  RECOVER: 'recover',
  HURT: 'hurt',
  STAGGER: 'stagger',
  DEAD: 'dead',
  RETREAT: 'retreat',
  SPECIAL: 'special',
});

let nextEnemyId = 1;

/**
 * @typedef {Object} EnemyDef
 * @property {string} id Stable identifier, used by rooms and the save file.
 * @property {string} name Display name.
 * @property {string} archetype Key into the archetype registry.
 * @property {string} biome Home biome id, for the bestiary.
 * @property {number} health
 * @property {number} damage Contact damage.
 * @property {number} width @property {number} height Collider size.
 * @property {number} [speed] Movement speed, px/s.
 * @property {number} [aggroRange] px.
 * @property {number} [attackRange] px.
 * @property {number} [poise] Stagger pool; 0 disables staggering.
 * @property {number} [glyphs] Currency dropped.
 * @property {number} [inkDrop] Extra ink granted on kill.
 * @property {number} [gravityScale]
 * @property {boolean} [flying]
 * @property {boolean} [ignoresLedges] Walkers that will happily fall off.
 * @property {Record<string, number>} [resistances]
 * @property {any} [visual] Parameters consumed by the enemy painter.
 * @property {any} [params] Archetype-specific tuning.
 * @property {string} [lore] Bestiary entry.
 * @property {string[]} [tags] e.g. ['aerial','armoured','ranged'].
 * @property {(enemy: Enemy, dt: number) => void} [onUpdate]
 * @property {(enemy: Enemy) => void} [onDeath]
 * @property {(enemy: Enemy) => void} [onSpawn]
 */

export class Enemy {
  /**
   * @param {EnemyDef} def
   * @param {Partial<import('../context.js').GameContext>} ctx
   */
  constructor(def, ctx) {
    this.id = nextEnemyId++;
    this.def = def;
    this.ctx = ctx;
    this.bus = ctx.bus;
    this.type = def.id;
    this.name = def.name;

    this.body = new Body({
      width: def.width,
      height: def.height,
      layer: CollisionLayer.ENEMY,
      gravityScale: def.flying ? 0 : (def.gravityScale ?? 1),
    });
    this.body.owner = this;

    this.health = new Health(def.health, {
      iframeDuration: 0.08,
      resistances: def.resistances,
    });
    this.health.maxPoise = def.poise ?? 0;
    this.health.poise = this.health.maxPoise;

    this.hurtbox = new Hurtbox(this, { team: Team.ENEMY });

    /** Contact damage hitbox, refreshed while alive. @type {import('../combat/hitbox.js').Hitbox|null} */
    this.contactHitbox = null;

    this.facing = 1;
    this.speed = def.speed ?? 40;
    this.aggroRange = def.aggroRange ?? 140;
    this.attackRange = def.attackRange ?? 32;

    /** True once the enemy has noticed the player. */
    this.alerted = false;
    /** Seconds of remembered aggro after losing sight. */
    this.alertMemory = 0;
    /** Distance to the player, refreshed each step. */
    this.distanceToPlayer = Infinity;
    /** Whether the player is currently visible. */
    this.canSeePlayer = false;

    /** Home position, used by patrol and leash behaviour. */
    this.homeX = 0;
    this.homeY = 0;
    /** Patrol bounds, derived from the room at spawn. */
    this.patrolMinX = -Infinity;
    this.patrolMaxX = Infinity;

    /** Generic per-archetype cooldown. */
    this.attackCooldown = 0;
    /** Scratch space for archetypes; avoids ad-hoc fields on the instance. */
    this.blackboard = /** @type {Record<string, any>} */ ({});

    /** Visual state read by the painter. */
    this.visual = {
      flash: 0,
      squash: 1,
      wobble: 0,
      /** Continuous phase for idle animation, so a room of enemies is not in lockstep. */
      phase: (ctx.rng?.next() ?? Math.random()) * Math.PI * 2,
      deathProgress: 0,
    };

    /** Set once the enemy has been removed and should be culled. */
    this.finished = false;
    /** Set when the enemy is off-screen and cheaply updated. */
    this.dormant = false;
    /** Room-unique index, used so saved kills persist. */
    this.spawnKey = '';
    /**
     * Discriminator set by {@link import('../boss/boss.js').Boss}. Declared here
     * so every consumer can branch on it without a type guard.
     */
    this.isBoss = false;

    this.machine = new StateMachine({ debugName: `Enemy:${def.id}` });
    /** @type {(() => void)[]} */
    this._unsubscribers = [];

    this._buildStates();
  }

  /** @private */
  _buildStates() {
    // Every enemy gets these; the archetype adds and overrides.
    this.machine.addAll({
      [EnemyState.SPAWN]: {
        enter: () => {
          this.def.onSpawn?.(this);
        },
        update: () => {
          if (this.machine.timeInState > 0.15) this.machine.change(EnemyState.IDLE);
        },
      },
      [EnemyState.HURT]: {
        enter: () => {
          this.visual.flash = 1;
          this.visual.squash = 0.78;
        },
        update: (dt) => {
          this.body.velocity.x = moveToward(this.body.velocity.x, 0, 400 * dt);
          if (this.machine.timeInState > 0.16) {
            this.alerted = true;
            this.alertMemory = 6;
            this.machine.change(EnemyState.CHASE);
          }
        },
      },
      [EnemyState.STAGGER]: {
        enter: () => {
          this.visual.flash = 1;
          this.body.velocity.x *= 0.3;
        },
        update: (dt) => {
          this.body.velocity.x = moveToward(this.body.velocity.x, 0, 600 * dt);
          if (this.machine.timeInState > 0.75) this.machine.change(EnemyState.CHASE);
        },
      },
      [EnemyState.DEAD]: {
        enter: () => {
          this.hurtbox.enabled = false;
          this.body.layer = CollisionLayer.NONE;
          this.body.velocity.y = -110;
          this._onDeath();
        },
        update: (dt) => {
          this.visual.deathProgress += dt * 2.6;
          this.body.velocity.x = moveToward(this.body.velocity.x, 0, 220 * dt);
          if (this.visual.deathProgress >= 1) this.finished = true;
        },
        canExit: () => false,
      },
    });

    const archetype = ARCHETYPES[this.def.archetype];
    if (!archetype) {
      throw new Error(`Enemy "${this.def.id}": unknown archetype "${this.def.archetype}"`);
    }
    archetype.build(this, this.machine, this.def.params ?? {});
    this.machine.force(EnemyState.SPAWN);
  }

  /**
   * @param {number} x world x (centre)
   * @param {number} y world y (feet)
   * @param {number} [facing]
   */
  spawnAt(x, y, facing = 1) {
    this.body.placeFeetAt(x, y);
    this.facing = facing;
    this.homeX = x;
    this.homeY = y;
    this.machine.force(EnemyState.SPAWN);
  }

  /** Register with the world's systems. */
  attach() {
    this.ctx.physics?.add(this.body);
    this.ctx.combat?.registerHurtbox(this.hurtbox);
  }

  /** Unregister. */
  detach() {
    this.ctx.physics?.remove(this.body);
    this.ctx.combat?.unregisterHurtbox(this.hurtbox);
    for (const off of this._unsubscribers) off();
    this._unsubscribers.length = 0;
  }

  /**
   * @param {number} dt
   */
  update(dt) {
    this.health.update(dt);
    this.visual.flash = Math.max(0, this.visual.flash - dt * 4);
    this.visual.squash = moveToward(this.visual.squash, 1, dt * 3.5);
    this.visual.phase += dt;
    this.attackCooldown = Math.max(0, this.attackCooldown - dt);

    if (this.health.dead && !this.machine.is(EnemyState.DEAD)) {
      this.machine.force(EnemyState.DEAD);
    }

    if (!this.machine.is(EnemyState.DEAD)) {
      this._senseWorld(dt);
      // Poise breaking interrupts whatever the enemy was doing, which is the
      // player's reward for sustained aggression.
      if (this.health.staggered) {
        this.machine.force(EnemyState.STAGGER);
      }
    }

    this.machine.update(dt);
    this.def.onUpdate?.(this, dt);

    this.hurtbox.sync(this.body, this.facing);
    this._refreshContactDamage();
  }

  /** @param {number} dt */
  lateUpdate(dt) {
    this.machine.lateUpdate(dt);
  }

  /**
   * Refresh awareness of the player.
   * @param {number} dt
   * @private
   */
  _senseWorld(dt) {
    const player = this.ctx.player;
    if (!player || player.health.dead) {
      this.canSeePlayer = false;
      this.distanceToPlayer = Infinity;
      return;
    }

    const dx = player.body.box.centerX - this.body.box.centerX;
    const dy = player.body.box.centerY - this.body.box.centerY;
    this.distanceToPlayer = Math.hypot(dx, dy);
    this.toPlayerX = dx;
    this.toPlayerY = dy;

    const map = this.ctx.map;
    const inRange = this.distanceToPlayer <= this.aggroRange;
    this.canSeePlayer = inRange && (!map || map.hasLineOfSight(
      this.body.box.centerX, this.body.box.centerY,
      player.body.box.centerX, player.body.box.centerY,
    ));

    if (this.canSeePlayer) {
      this.alerted = true;
      // Memory keeps the enemy hunting for a while after losing sight, which
      // reads as persistence rather than as a goldfish.
      this.alertMemory = 3.5;
    } else if (this.alertMemory > 0) {
      this.alertMemory -= dt;
      if (this.alertMemory <= 0) this.alerted = false;
    }
  }

  /**
   * Enemies deal damage by touch. Rather than a permanent hitbox (which would
   * be tested every step for every enemy), the contact box is only spawned when
   * the player is actually near, which keeps the combat broad-phase small.
   * @private
   */
  _refreshContactDamage() {
    if (this.health.dead || this.def.damage <= 0) return;
    if (this.distanceToPlayer > 96) return;
    const combat = this.ctx.combat;
    if (!combat) return;

    combat.spawnHitboxAt(
      this,
      {
        offsetX: 0,
        offsetY: 0,
        width: this.body.box.w,
        height: this.body.box.h,
        damage: this.def.damage,
        team: Team.ENEMY,
        damageType: DamageType.PHYSICAL,
        knockback: 0,
        activeFrames: 1,
        id: 'contact',
      },
      this.body.box.x,
      this.body.box.y,
    );
  }

  /** Called once when the entity dies. Subclasses extend this. @protected */
  _onDeath() {
    const player = this.ctx.player;
    if (player) {
      player.stats.enemiesFelled++;
      if (this.def.glyphs) player.addGlyphs(this.def.glyphs, `slew ${this.name}`);
      if (this.def.inkDrop) player.gainInk(this.def.inkDrop);
    }
    this.bus?.emit(Events.SPAWN_PARTICLES, {
      kind: 'enemyDeath',
      x: this.body.box.centerX,
      y: this.body.box.centerY,
      color: this.def.visual?.color,
    });
    this.bus?.emit(Events.SFX, { id: 'enemyDeath' });
    this.def.onDeath?.(this);
  }

  /**
   * Turn to face a horizontal direction.
   * @param {number} dir
   */
  face(dir) {
    if (dir !== 0) this.facing = Math.sign(dir);
  }

  /** Face the player, if there is one. */
  facePlayer() {
    const player = this.ctx.player;
    if (player) this.face(player.body.box.centerX - this.body.box.centerX);
  }

  /**
   * Walk in the current facing direction, turning at ledges and walls.
   * The shared implementation of the single most common enemy behaviour.
   * @param {number} dt
   * @param {number} [speed]
   * @param {boolean} [respectLedges]
   */
  walkForward(dt, speed = this.speed, respectLedges = !this.def.ignoresLedges) {
    const body = this.body;
    const map = this.ctx.map;

    if (body.hitWallLeft && this.facing < 0) this.facing = 1;
    else if (body.hitWallRight && this.facing > 0) this.facing = -1;

    if (respectLedges && map && body.grounded) {
      // Probe just beyond the leading edge; if there is nothing to stand on,
      // turn around rather than walking into the void.
      const probeX = this.facing > 0 ? body.box.right + 1 : body.box.x - 3;
      if (!hasGroundBelow(map, probeX, body.box.bottom, 2, 6)) {
        this.facing = -this.facing;
      }
    }

    if (this.facing > 0 && this.patrolMaxX !== Infinity && body.box.right > this.patrolMaxX) {
      this.facing = -1;
    } else if (this.facing < 0 && this.patrolMinX !== -Infinity && body.box.x < this.patrolMinX) {
      this.facing = 1;
    }

    body.velocity.x = moveToward(body.velocity.x, this.facing * speed, 900 * dt);
  }

  /**
   * Fly toward a point with steering, used by every aerial archetype.
   * @param {number} tx @param {number} ty
   * @param {number} dt
   * @param {number} [speed]
   * @param {number} [accel]
   */
  flyToward(tx, ty, dt, speed = this.speed, accel = 260) {
    const dx = tx - this.body.box.centerX;
    const dy = ty - this.body.box.centerY;
    const len = Math.hypot(dx, dy) || 1;
    const v = this.body.velocity;
    v.x = moveToward(v.x, (dx / len) * speed, accel * dt);
    v.y = moveToward(v.y, (dy / len) * speed, accel * dt);
    this.face(dx);
  }

  /**
   * Fire a projectile.
   * @param {object} spec
   * @param {number} spec.angle radians
   * @param {number} spec.speed
   * @param {number} [spec.damage]
   * @param {number} [spec.size]
   * @param {number} [spec.life]
   * @param {string} [spec.color]
   * @param {number} [spec.gravity]
   * @param {boolean} [spec.homing]
   */
  fireProjectile(spec) {
    this.bus?.queue('projectile:spawn', {
      owner: this,
      team: Team.ENEMY,
      x: this.body.box.centerX + Math.cos(spec.angle) * (this.body.box.w * 0.5 + 3),
      y: this.body.box.centerY + Math.sin(spec.angle) * (this.body.box.h * 0.4),
      vx: Math.cos(spec.angle) * spec.speed,
      vy: Math.sin(spec.angle) * spec.speed,
      damage: spec.damage ?? this.def.damage,
      size: spec.size ?? 3,
      life: spec.life ?? 3,
      color: spec.color ?? this.def.visual?.accent ?? '#d8c48a',
      gravity: spec.gravity ?? 0,
      homing: spec.homing ?? false,
    });
    this.bus?.emit(Events.SFX, { id: 'enemyShoot' });
  }

  /**
   * Angle from this enemy to the player.
   * @returns {number} radians
   */
  angleToPlayer() {
    const player = this.ctx.player;
    if (!player) return 0;
    return Math.atan2(
      player.body.box.centerY - this.body.box.centerY,
      player.body.box.centerX - this.body.box.centerX,
    );
  }

  /**
   * Spawn a melee hitbox in front of the enemy.
   * @param {object} spec
   * @param {number} spec.offsetX @param {number} spec.offsetY
   * @param {number} spec.width @param {number} spec.height
   * @param {number} [spec.damage]
   * @param {number} [spec.frames]
   * @param {number} [spec.knockback]
   */
  swing(spec) {
    this.ctx.combat?.spawnHitbox(
      this,
      {
        offsetX: spec.offsetX,
        offsetY: spec.offsetY,
        width: spec.width,
        height: spec.height,
        damage: spec.damage ?? this.def.damage,
        team: Team.ENEMY,
        knockback: spec.knockback ?? 140,
        activeFrames: spec.frames ?? 6,
        id: 'enemySwing',
      },
      this.body.box.centerX,
      this.body.box.centerY,
      this.facing,
    );
  }

  /** @returns {boolean} */
  get isDead() {
    return this.health.dead;
  }

  /** @returns {object} state to persist (only what varies) */
  toJSON() {
    return { key: this.spawnKey, dead: this.health.dead };
  }
}

// ============================================================================
// Archetype registry
// ============================================================================

/**
 * @typedef {Object} Archetype
 * @property {string} id
 * @property {string} description
 * @property {(enemy: Enemy, machine: StateMachine, params: any) => void} build
 */

/** @type {Record<string, Archetype>} */
export const ARCHETYPES = {};

/**
 * @param {Archetype} archetype
 */
export function registerArchetype(archetype) {
  if (ARCHETYPES[archetype.id]) {
    throw new Error(`Duplicate enemy archetype "${archetype.id}"`);
  }
  ARCHETYPES[archetype.id] = archetype;
}

// ============================================================================
// Enemy definition registry
// ============================================================================

/** @type {Map<string, EnemyDef>} */
export const ENEMY_DEFS = new Map();

/**
 * @param {EnemyDef} def
 * @returns {EnemyDef}
 */
export function defineEnemy(def) {
  if (ENEMY_DEFS.has(def.id)) throw new Error(`Duplicate enemy id "${def.id}"`);
  ENEMY_DEFS.set(def.id, def);
  return def;
}

/**
 * @param {EnemyDef[]} defs
 */
export function defineEnemies(defs) {
  for (const d of defs) defineEnemy(d);
}

/**
 * @param {string} id
 * @param {Partial<import('../context.js').GameContext>} ctx
 * @returns {Enemy}
 */
export function createEnemy(id, ctx) {
  const def = ENEMY_DEFS.get(id);
  if (!def) throw new Error(`Unknown enemy id "${id}"`);
  return new Enemy(def, ctx);
}

/** @returns {EnemyDef[]} */
export function allEnemyDefs() {
  return [...ENEMY_DEFS.values()];
}
