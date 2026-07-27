/**
 * @file The player character: Nib, a Quill of the Scrivener order.
 *
 * ## Architecture
 * The controller is a hierarchical state machine (see `engine/core/state-machine.js`)
 * over a physics `Body`. Each state owns one *movement verb* and declares its own
 * exits. The alternative — a single `update` with flags — is where platformer
 * controllers traditionally rot, because every new ability must be excluded from
 * every existing branch.
 *
 * Responsibilities are split three ways:
 *  - **This file** owns state, resources, and the states themselves.
 *  - **`movement-config.js`** owns every tuning number.
 *  - **`player-visual.js`** owns how the character is drawn, so tuning feel and
 *    tuning looks never fight over the same file.
 *
 * ## Two-phase update
 * `update` runs the state machine and writes velocity; the physics world then
 * integrates; `lateUpdate` runs afterwards so states can react to collision
 * results (landing, hitting a ceiling, touching a wall). Doing everything in one
 * pass would mean states act on last frame's collision data, which is exactly
 * the sort of one-frame lag that makes a controller feel mushy.
 *
 * ## Resource model
 * - **Filaments** (health): integral, small (5 to start), visible at a glance.
 * - **Ink**: earned by landing hits, spent on healing and scripts. This ties
 *   aggression to survival — the only way to heal is to have fought well — which
 *   is the central risk/reward loop of the combat design.
 */

import { Body, CollisionLayer } from '../../engine/physics/body.js';
import { StateMachine } from '../../engine/core/state-machine.js';
import { Health, DamageType, DamageFlags, makeDamage, dealDamage } from '../combat/damage.js';
import { Hurtbox, Team, FRAME } from '../combat/hitbox.js';
import { Events } from '../../engine/core/events.js';
import { Action } from '../../engine/input/input.js';
import { Ability, AbilitySet } from './abilities.js';
import { MovementConfig as C, GRAVITY } from './movement-config.js';
import { clamp, moveToward } from '../../engine/math/math-utils.js';
import { queryHazard, hasGroundBelow } from '../../engine/physics/tilemap-collider.js';
import { ATTACK_SPECS, AttackDirection } from './attacks.js';

/** Named states, so transitions are typo-proof. */
export const PlayerState = Object.freeze({
  IDLE: 'idle',
  RUN: 'run',
  JUMP: 'jump',
  FALL: 'fall',
  LAND: 'land',
  DASH: 'dash',
  WALL_SLIDE: 'wallSlide',
  WALL_JUMP: 'wallJump',
  ATTACK: 'attack',
  HURT: 'hurt',
  DEAD: 'dead',
  FOCUS: 'focus',
  CLIMB: 'climb',
  SWIM: 'swim',
  MANTLE: 'mantle',
  SIT: 'sit',
  LOCKED: 'locked',
  TRANSITION: 'transition',
});

export class Player {
  /**
   * @param {Partial<import('../context.js').GameContext>} ctx
   */
  constructor(ctx) {
    this.ctx = ctx;
    this.bus = ctx.bus;

    // --- physics ---
    this.body = new Body({
      width: C.width,
      height: C.height,
      layer: CollisionLayer.PLAYER,
    });
    this.body.owner = this;
    this.body.maxFallSpeed = C.maxFallSpeed;

    // --- combat ---
    this.health = new Health(5, { iframeDuration: 0 }); // i-frames managed by the hurt state
    this.hurtbox = new Hurtbox(this, { team: Team.PLAYER, width: C.width + 2, height: C.height });

    // --- resources ---
    /** Ink, the universal resource: heal, cast, and pay certain tolls. */
    this.ink = 0;
    this.maxInk = 99;
    /** Ink granted per landed hit, before upgrades. */
    this.inkPerHit = 11;

    /** Currency. */
    this.glyphs = 0;

    // --- progression ---
    this.abilities = new AbilitySet(Ability.NONE);
    /** Weapon tier: raises base damage. */
    this.nibTier = 0;
    /** Additive damage bonus from seals and upgrades. */
    this.damageBonus = 0;
    /** Multiplier applied to ink gain. */
    this.inkGainScale = 1;
    /** Multiplier on focus (healing) speed. */
    this.focusSpeedScale = 1;
    /** Extra filaments healed per focus. */
    this.focusPotency = 1;

    // --- facing / orientation ---
    /** -1 left, 1 right. */
    this.facing = 1;
    /** Direction the player is aiming attacks: from input, not from facing. */
    this.attackDir = AttackDirection.FORWARD;

    // --- timers and counters ---
    this.coyoteTimer = 0;
    this.wallCoyoteTimer = 0;
    this.wallCoyoteSide = 0;
    this.airJumpsUsed = 0;
    this.maxJumps = 1;
    this.dashCooldownTimer = 0;
    this.airDashUsed = false;
    this.attackCooldownTimer = 0;
    this.wallJumpLockoutTimer = 0;
    this.iframeTimer = 0;
    this.hurtFlashTimer = 0;
    /** Highest point of the current fall, for hard-landing detection. */
    this._fallStartY = 0;
    /** Set while the player is intangible (dash i-frames, transitions). */
    this.intangible = false;
    /** Seconds since the last successful attack; drives combo chaining. */
    this.timeSinceAttack = Infinity;
    /** Index in the attack chain, so successive slashes alternate. */
    this.comboIndex = 0;
    /** Time the player has been standing still, for idle animation variety. */
    this.idleTime = 0;

    // --- environment state ---
    this.inFluid = false;
    this.onClimbable = false;
    /** Set by the room when the player stands in a "safe" volume. */
    this.onSafeGround = false;
    /** Last position considered safe, used to restore after falling into a pit. */
    this.lastSafeX = 0;
    this.lastSafeY = 0;
    this._safeSampleTimer = 0;

    // --- ability state ---
    /** Charge accumulated while holding the focus button. */
    this.focusCharge = 0;
    /** Anchor currently held by the grapple line. @type {{x: number, y: number}|null} */
    this.grappleAnchor = null;

    /** Statistics, surfaced on the pause screen and used by achievements. */
    this.stats = {
      deaths: 0,
      enemiesFelled: 0,
      damageDealt: 0,
      damageTaken: 0,
      distanceTravelled: 0,
      jumps: 0,
      dashes: 0,
      attacks: 0,
      inscriptionsRead: 0,
      secretsFound: 0,
      timePlayed: 0,
    };

    /** Visual state consumed by the renderer, written by states. */
    this.visual = {
      squash: 1,
      stretch: 1,
      lean: 0,
      /** 0..1, drives the slash arc animation. */
      attackProgress: 0,
      attackDir: AttackDirection.FORWARD,
      /** Trailing positions for the dash after-image. */
      trail: /** @type {{x: number, y: number, age: number}[]} */ ([]),
      flash: 0,
      /** Cloak/ribbon sway, integrated separately from the body. */
      sway: 0,
      swayVel: 0,
    };

    /** @type {(() => void)[]} Subscriptions to release on teardown. */
    this._unsubscribers = [];

    this.machine = new StateMachine({ debugName: 'Player' });
    this._registerStates();
    this.machine.force(PlayerState.FALL);
  }

  /**
   * Register with the physics, combat and event systems.
   *
   * Kept out of the constructor so a Player can be built in isolation for tests
   * and for the ability-reachability simulator, neither of which wants live
   * subscriptions.
   */
  attach() {
    this.ctx.physics?.add(this.body);
    this.ctx.combat?.registerHurtbox(this.hurtbox);

    if (this.bus) {
      // The combat system knows a hit landed but not what it means to the
      // attacker. Routing it back here keeps ink gain, pogo bounces and combat
      // statistics with the entity they belong to.
      this._unsubscribers.push(
        this.bus.on(Events.ATTACK_CONNECTED, (e) => {
          if (e.attacker !== this) return;
          this.onAttackConnected(e.damage, e.hitbox);
        }),
      );
    }
  }

  /** Release every registration made by {@link attach}. */
  detach() {
    this.ctx.physics?.remove(this.body);
    this.ctx.combat?.unregisterHurtbox(this.hurtbox);
    for (const off of this._unsubscribers) off();
    this._unsubscribers.length = 0;
  }

  // ==========================================================================
  // Lifecycle
  // ==========================================================================

  /**
   * Place the player and reset volatile state. Called on room entry, respawn
   * and fast travel.
   * @param {number} x world x (centre)
   * @param {number} y world y (feet)
   * @param {number} [facing]
   */
  spawnAt(x, y, facing = 1) {
    this.body.placeFeetAt(x, y);
    this.facing = facing;
    this.lastSafeX = x;
    this.lastSafeY = y;
    this.coyoteTimer = 0;
    this.airJumpsUsed = 0;
    this.airDashUsed = false;
    this.dashCooldownTimer = 0;
    this.intangible = false;
    this.visual.trail.length = 0;
    this.machine.force(PlayerState.FALL);
    this.bus?.emit(Events.PLAYER_SPAWNED, { player: this, x, y });
  }

  /** Full reset for a new game or a load. */
  resetForNewRun() {
    this.health.max = 5;
    this.health.reset();
    this.ink = 0;
    this.glyphs = 0;
    this.abilities = new AbilitySet(Ability.NONE);
    this.nibTier = 0;
    this.damageBonus = 0;
    this.maxJumps = 1;
    for (const k of Object.keys(this.stats)) this.stats[k] = 0;
  }

  // ==========================================================================
  // Update
  // ==========================================================================

  /**
   * @param {number} dt
   */
  update(dt) {
    this.stats.timePlayed += dt;
    this.health.update(dt);

    // Timers.
    this.dashCooldownTimer = Math.max(0, this.dashCooldownTimer - dt);
    this.attackCooldownTimer = Math.max(0, this.attackCooldownTimer - dt);
    this.wallJumpLockoutTimer = Math.max(0, this.wallJumpLockoutTimer - dt);
    this.iframeTimer = Math.max(0, this.iframeTimer - dt);
    this.hurtFlashTimer = Math.max(0, this.hurtFlashTimer - dt);
    this.timeSinceAttack += dt;

    if (this.body.grounded) {
      this.coyoteTimer = C.coyoteTime;
      this.airJumpsUsed = 0;
      if (C.dashRefreshOnLand) this.airDashUsed = false;
    } else {
      this.coyoteTimer = Math.max(0, this.coyoteTimer - dt);
    }

    if (this.wallCoyoteTimer > 0) this.wallCoyoteTimer -= dt;

    // The combo window closes if the player stops attacking, so mashing and
    // deliberate chaining feel different.
    if (this.timeSinceAttack > 0.55) this.comboIndex = 0;

    this._updateSafeGround(dt);
    this._updateVisual(dt);

    this.machine.update(dt);

    this.hurtbox.sync(this.body, this.facing);
    this.hurtbox.enabled = !this.intangible && this.iframeTimer <= 0 && !this.health.dead;
  }

  /**
   * Runs after physics integration, so states can respond to collision results.
   * @param {number} dt
   */
  lateUpdate(dt) {
    // Track wall contact for wall-jump coyote time.
    if (!this.body.grounded && this.body.touchingWall()) {
      this.wallCoyoteTimer = C.wallCoyoteTime;
      this.wallCoyoteSide = this.body.wallDirection();
    }

    this.inFluid = this.body.inFluid;
    this.onClimbable = this.body.onClimbable;

    this.stats.distanceTravelled += Math.abs(this.body.box.x - this.body.prevX);

    this._checkHazards();
    this._checkCrush();

    this.machine.lateUpdate(dt);
  }

  /**
   * Contact damage from spike and brine tiles.
   * @private
   */
  _checkHazards() {
    if (this.intangible || this.iframeTimer > 0 || this.health.dead) return;
    const map = this.ctx.map;
    if (!map) return;
    const hazard = queryHazard(map, this.body.box);
    if (!hazard) return;

    // Hazards knock the player back toward the last safe ground rather than in a
    // physical direction. Physical knockback off a spike frequently launches the
    // player into another spike, which is the definition of unfair.
    const dir = this.lastSafeX < this.body.box.centerX ? 1 : -1;
    this.takeDamage({
      amount: hazard.damage,
      type: DamageType.ENVIRONMENT,
      dirX: dir,
      dirY: -1,
      knockback: C.hurtKnockbackX,
      source: 'hazard',
      restoreToSafe: true,
    });
  }

  /** @private */
  _checkCrush() {
    if (!this.body.crushed || this.health.dead || this.intangible) return;
    this.takeDamage({
      amount: 1,
      type: DamageType.ENVIRONMENT,
      flags: DamageFlags.BYPASS_IFRAMES,
      dirX: 0,
      dirY: -1,
      knockback: 0,
      source: 'crush',
      restoreToSafe: true,
    });
  }

  /**
   * Remember the last position it is safe to be returned to. Sampled
   * periodically rather than every frame, and only while genuinely settled, so
   * the recorded point is never mid-jump over a pit.
   * @param {number} dt
   * @private
   */
  _updateSafeGround(dt) {
    this._safeSampleTimer -= dt;
    if (this._safeSampleTimer > 0) return;
    this._safeSampleTimer = 0.2;

    const map = this.ctx.map;
    if (!map) return;
    if (!this.body.grounded) return;
    if (Math.abs(this.body.velocity.x) > C.runSpeed * 0.9) return;

    // Reject ledges: require ground under both edges of the collider so the
    // player is never restored to a spot they would immediately fall from.
    const b = this.body.box;
    if (!hasGroundBelow(map, b.x, b.bottom, b.w)) return;
    if (queryHazard(map, b)) return;

    this.lastSafeX = b.centerX;
    this.lastSafeY = b.bottom;
  }

  /**
   * @param {number} dt
   * @private
   */
  _updateVisual(dt) {
    const v = this.visual;

    // Squash and stretch decay back to neutral.
    v.squash = moveToward(v.squash, 1, dt * 4.5);
    v.stretch = moveToward(v.stretch, 1, dt * 4.5);
    v.flash = Math.max(0, v.flash - dt * 5);

    // Lean into horizontal motion; small, but it sells acceleration.
    const targetLean = clamp(this.body.velocity.x / C.runSpeed, -1, 1) * 0.13;
    v.lean += (targetLean - v.lean) * Math.min(1, dt * 12);

    // A simple spring drives the trailing ribbon, lagging behind body motion.
    const swayTarget = -this.body.velocity.x * 0.02;
    const swayAccel = (swayTarget - v.sway) * 90 - v.swayVel * 11;
    v.swayVel += swayAccel * dt;
    v.sway += v.swayVel * dt;

    // Age and cull the dash after-image.
    for (let i = v.trail.length - 1; i >= 0; i--) {
      v.trail[i].age += dt;
      if (v.trail[i].age > 0.26) v.trail.splice(i, 1);
    }
  }

  // ==========================================================================
  // Resources and damage
  // ==========================================================================

  /**
   * @param {number} amount
   * @returns {number} ink actually gained
   */
  gainInk(amount) {
    const before = this.ink;
    this.ink = clamp(this.ink + amount * this.inkGainScale, 0, this.maxInk);
    return this.ink - before;
  }

  /**
   * @param {number} amount
   * @returns {boolean} true if the player could pay
   */
  spendInk(amount) {
    if (this.ink < amount) return false;
    this.ink -= amount;
    return true;
  }

  /**
   * @param {number} amount
   * @param {string} [reason]
   */
  addGlyphs(amount, reason = '') {
    this.glyphs = Math.max(0, this.glyphs + amount);
    this.bus?.emit(Events.CURRENCY_CHANGED, { total: this.glyphs, delta: amount, reason });
  }

  /**
   * Base damage of the player's attacks, before per-attack multipliers.
   * @returns {number}
   */
  get attackDamage() {
    // Weapon tiers give a clear, chunky progression: 1 -> 2 -> 3 -> 4 -> 5.
    return 1 + this.nibTier + this.damageBonus;
  }

  /**
   * Take damage from any source.
   * @param {object} spec
   * @param {number} spec.amount
   * @param {string} [spec.type]
   * @param {number} [spec.flags]
   * @param {number} [spec.dirX] @param {number} [spec.dirY]
   * @param {number} [spec.knockback]
   * @param {any} [spec.source]
   * @param {boolean} [spec.restoreToSafe] return the player to safe ground
   * @returns {number} damage dealt
   */
  takeDamage(spec) {
    if (this.health.dead) return 0;
    const bypass = ((spec.flags ?? 0) & DamageFlags.BYPASS_IFRAMES) !== 0;
    if (!bypass && (this.iframeTimer > 0 || this.intangible)) return 0;

    const payload = makeDamage({
      amount: spec.amount,
      type: spec.type ?? DamageType.PHYSICAL,
      flags: spec.flags ?? DamageFlags.NONE,
      dirX: spec.dirX ?? -this.facing,
      dirY: spec.dirY ?? -1,
      knockback: 0, // knockback is applied by the hurt state, not by physics
      source: spec.source ?? null,
      impactX: this.body.box.centerX,
      impactY: this.body.box.centerY,
    });

    const dealt = this.health.applyDamage(payload);
    if (dealt <= 0) return 0;

    this.stats.damageTaken += dealt;
    this.iframeTimer = C.hurtIFrames;
    this.hurtFlashTimer = 0.3;
    this.visual.flash = 1;

    this.bus?.emit(Events.DAMAGE_TAKEN, { target: this, payload, amount: dealt });
    this.bus?.emit(Events.SCREEN_SHAKE, { amount: 0.42 });
    this.bus?.emit(Events.HITSTOP, { frames: 7 });
    this.bus?.emit(Events.FLASH, { color: '#ff5566', amount: 0.32 });

    if (this.health.dead) {
      this.machine.force(PlayerState.DEAD);
    } else {
      this.machine.force(PlayerState.HURT, {
        dirX: payload.dirX,
        restoreToSafe: spec.restoreToSafe === true,
      });
    }
    return dealt;
  }

  /**
   * Restore the player to the last safe standing position. Used after pits and
   * hazards, so falling into a spike pit costs health rather than a full death.
   */
  restoreToSafeGround() {
    this.body.placeFeetAt(this.lastSafeX, this.lastSafeY);
    this.body.velocity.zero();
  }

  // ==========================================================================
  // Ability helpers
  // ==========================================================================

  /** @param {number} ability @returns {boolean} */
  can(ability) {
    return this.abilities.has(ability);
  }

  /**
   * @param {number} ability
   * @returns {boolean} true if newly granted
   */
  grantAbility(ability) {
    if (!this.abilities.grant(ability)) return false;
    if (ability === Ability.PAPERWING) this.maxJumps = 2;
    if (ability === Ability.DEEPWELL) this.maxInk = 198;
    this.bus?.emit(Events.ABILITY_UNLOCKED, { ability, player: this });
    return true;
  }

  /** @returns {boolean} */
  canDash() {
    if (!this.can(Ability.SKIM)) return false;
    if (this.dashCooldownTimer > 0) return false;
    if (!this.body.grounded) {
      if (!this.can(Ability.SKYSKIM)) return false;
      if (this.airDashUsed) return false;
    }
    return true;
  }

  /** @returns {boolean} */
  canWallInteract() {
    return this.can(Ability.GRIPSCRIPT);
  }

  /**
   * Direction the player is aiming, derived from input.
   * @returns {string}
   * @private
   */
  _readAttackDirection() {
    const input = this.ctx.input;
    if (!input) return AttackDirection.FORWARD;
    const v = input.verticalDirection();
    if (v < 0) return AttackDirection.UP;
    // Downward attacks are only meaningful in the air; on the ground a down
    // input during an attack should still swing forward.
    if (v > 0 && !this.body.grounded && this.can(Ability.PLUMBSTRIKE)) return AttackDirection.DOWN;
    return AttackDirection.FORWARD;
  }

  // ==========================================================================
  // Shared movement helpers, used by several states
  // ==========================================================================

  /**
   * Horizontal acceleration toward the input direction.
   * @param {number} dt
   * @param {number} accel
   * @param {number} friction
   * @param {number} maxSpeed
   * @private
   */
  _applyHorizontal(dt, accel, friction, maxSpeed) {
    if (this.wallJumpLockoutTimer > 0) return;
    const input = this.ctx.input;
    const dir = input ? input.moveDirection() : 0;
    const v = this.body.velocity;

    if (dir !== 0) {
      this.facing = dir;
      // Turning around gets extra acceleration so direction changes are crisp
      // rather than mushy at speed.
      const turning = Math.sign(v.x) !== 0 && Math.sign(v.x) !== dir;
      const a = turning ? C.turnAccel : accel;
      v.x = moveToward(v.x, dir * maxSpeed, a * dt);
    } else {
      v.x = moveToward(v.x, 0, friction * dt);
    }
  }

  /**
   * Gravity with the asymmetric, apex-softened curve that defines the jump feel.
   * @param {number} dt
   * @private
   */
  _applyGravity(dt) {
    const v = this.body.velocity;
    let scale = 1;
    if (v.y > 0) {
      scale = C.fallGravityMultiplier;
    } else if (Math.abs(v.y) < C.apexThreshold) {
      scale = C.apexGravityMultiplier;
    }
    // The physics world applies base gravity; this applies only the difference,
    // so the two never double-count.
    v.y += GRAVITY * (scale - 1) * dt;
  }

  /**
   * Attempt a jump, honouring coyote time, buffering and air jumps.
   *
   * Eligibility is checked **before** the buffered press is consumed. Consuming
   * first and then discovering no jump is available would silently eat the
   * input, which defeats the entire point of buffering: a jump pressed just
   * before landing must survive to fire on touchdown.
   *
   * @returns {boolean} true if a jump was performed
   * @private
   */
  _tryJump() {
    const input = this.ctx.input;
    if (!input || !input.pressed(Action.JUMP, C.jumpBuffer)) return false;

    const groundJump = this.body.grounded || this.coyoteTimer > 0;
    const airJump = !groundJump
      && this.can(Ability.PAPERWING)
      && this.airJumpsUsed < this.maxAirJumps;

    if (!groundJump && !airJump) return false; // leave the buffer intact
    input.consume(Action.JUMP, C.jumpBuffer);

    if (groundJump) {
      this.airJumpsUsed = 0;
      this._doJump(C.jumpVelocity);
      return true;
    }

    this.airJumpsUsed++;
    this._doJump(C.doubleJumpVelocity);
    // A double jump gives a small horizontal nudge toward the held direction,
    // which turns it from "more height" into "a correction".
    const dir = input.moveDirection();
    if (dir !== 0) {
      this.body.velocity.x = clamp(
        this.body.velocity.x + dir * C.doubleJumpBoost,
        -C.maxAirSpeed,
        C.maxAirSpeed,
      );
    }
    this.bus?.emit(Events.SPAWN_PARTICLES, {
      kind: 'doubleJump',
      x: this.body.box.centerX,
      y: this.body.box.bottom,
    });
    return true;
  }

  /** @returns {number} air jumps available between touching the ground */
  get maxAirJumps() {
    return Math.max(0, this.maxJumps - 1);
  }

  /**
   * @param {number} velocity
   * @private
   */
  _doJump(velocity) {
    this.body.velocity.y = velocity;
    this.coyoteTimer = 0;
    this.stats.jumps++;
    this.visual.stretch = 1.22;
    this.visual.squash = 0.86;
    this.bus?.emit(Events.PLAYER_JUMPED, { player: this });
    this.bus?.emit(Events.SFX, { id: 'jump' });
    this.machine.change(PlayerState.JUMP);
  }

  /**
   * Cut the jump short when the button is released, giving variable height.
   * @private
   */
  _applyJumpCut() {
    const input = this.ctx.input;
    if (!input) return;
    const v = this.body.velocity;
    if (v.y < C.jumpCutThreshold && !input.isDown(Action.JUMP)) {
      v.y *= C.jumpCutMultiplier;
    }
  }

  /**
   * Common exits available from most grounded and airborne states.
   * @returns {boolean} true if a transition was taken
   * @private
   */
  _checkCommonTransitions() {
    const input = this.ctx.input;
    if (!input) return false;

    if (this.attackCooldownTimer <= 0 && input.consume(Action.ATTACK)) {
      this.attackDir = this._readAttackDirection();
      this.machine.change(PlayerState.ATTACK);
      return true;
    }
    if (this.canDash() && input.consume(Action.DASH)) {
      this.machine.change(PlayerState.DASH);
      return true;
    }
    if (this.inFluid && this.can(Ability.MENISCUS)) {
      this.machine.change(PlayerState.SWIM);
      return true;
    }
    if (this.onClimbable && Math.abs(input.axisY) > 0.5) {
      this.machine.change(PlayerState.CLIMB);
      return true;
    }
    return false;
  }

  /**
   * Should the player be wall-sliding right now?
   * @returns {boolean}
   * @private
   */
  _shouldWallSlide() {
    if (!this.canWallInteract()) return false;
    if (this.body.grounded) return false;
    if (this.body.velocity.y < 0) return false; // only while descending
    const wall = this.body.wallDirection();
    if (wall === 0) return false;
    const input = this.ctx.input;
    // Require the player to hold toward the wall, so brushing past a wall while
    // falling does not silently stick them to it.
    return input ? input.moveDirection() === wall : false;
  }

  // ==========================================================================
  // States
  // ==========================================================================

  /** @private */
  _registerStates() {
    const m = this.machine;
    const input = () => this.ctx.input;

    // ---- IDLE ----
    m.add(PlayerState.IDLE, {
      enter: () => {
        this.idleTime = 0;
      },
      update: (dt) => {
        this.idleTime += dt;
        this._applyHorizontal(dt, C.groundAccel, C.groundFriction, C.runSpeed);
        if (this._tryJump()) return;
        if (this._checkCommonTransitions()) return;

        const inp = input();
        if (inp?.isDown(Action.FOCUS) && this.ink >= C.focusCost && this.health.current < this.health.max) {
          m.change(PlayerState.FOCUS);
          return;
        }
        // Drop through a one-way platform.
        if (inp && inp.verticalDirection() > 0 && inp.consume(Action.JUMP, C.jumpBuffer)) {
          this.body.dropThrough = true;
          m.change(PlayerState.FALL);
          return;
        }
        if (inp && inp.moveDirection() !== 0) m.change(PlayerState.RUN);
      },
      lateUpdate: () => {
        if (!this.body.grounded) {
          this._fallStartY = this.body.box.bottom;
          m.change(PlayerState.FALL);
        }
      },
    });

    // ---- RUN ----
    m.add(PlayerState.RUN, {
      update: (dt) => {
        this._applyHorizontal(dt, C.groundAccel, C.groundFriction, C.runSpeed);
        if (this._tryJump()) return;
        if (this._checkCommonTransitions()) return;

        const inp = input();
        if (inp && inp.moveDirection() === 0 && Math.abs(this.body.velocity.x) < 8) {
          m.change(PlayerState.IDLE);
        }
      },
      lateUpdate: () => {
        if (!this.body.grounded) {
          this._fallStartY = this.body.box.bottom;
          m.change(PlayerState.FALL);
        }
      },
    });

    // ---- JUMP (rising) ----
    m.add(PlayerState.JUMP, {
      update: (dt) => {
        this._applyHorizontal(dt, C.airAccel, C.airFriction, C.maxAirSpeed);
        this._applyGravity(dt);
        this._applyJumpCut();
        this._tryJump();
        if (this._checkCommonTransitions()) return;
        if (this._shouldWallSlide()) {
          m.change(PlayerState.WALL_SLIDE);
          return;
        }
        if (this.body.velocity.y >= 0) {
          this._fallStartY = this.body.box.bottom;
          m.change(PlayerState.FALL);
        }
      },
      lateUpdate: () => {
        if (this.body.hitCeiling) {
          this.visual.squash = 0.8;
          this._fallStartY = this.body.box.bottom;
          m.change(PlayerState.FALL);
        } else if (this.body.grounded) {
          m.change(PlayerState.LAND);
        }
      },
    });

    // ---- FALL ----
    m.add(PlayerState.FALL, {
      enter: () => {
        this._fallStartY = Math.min(this._fallStartY || this.body.box.bottom, this.body.box.bottom);
      },
      update: (dt) => {
        this._applyHorizontal(dt, C.airAccel, C.airFriction, C.maxAirSpeed);
        this._applyGravity(dt);

        // Slow descent while holding jump, once Driftleaf is known.
        if (this.can(Ability.DRIFTLEAF) && input()?.isDown(Action.JUMP) && this.body.velocity.y > 40) {
          this.body.velocity.y = Math.min(this.body.velocity.y, 96);
        }

        if (this._tryJump()) return;
        if (this._tryWallJump()) return;
        if (this._checkCommonTransitions()) return;
        if (this._shouldWallSlide()) m.change(PlayerState.WALL_SLIDE);
      },
      lateUpdate: () => {
        if (this.body.grounded) m.change(PlayerState.LAND);
      },
    });

    // ---- LAND ----
    // A distinct state (rather than jumping straight to idle) so landing has
    // weight: squash, dust, and a brief window where a hard landing reads.
    m.add(PlayerState.LAND, {
      enter: () => {
        const fallDistance = this.body.box.bottom - this._fallStartY;
        const hard = fallDistance > C.hardLandingDistance;
        this.visual.squash = hard ? 0.68 : 0.84;
        this.visual.stretch = hard ? 1.3 : 1.14;
        this.airJumpsUsed = 0;
        this.airDashUsed = false;
        this.bus?.emit(Events.PLAYER_LANDED, { player: this, hard, fallDistance });
        this.bus?.emit(Events.SFX, { id: hard ? 'landHard' : 'land' });
        this.bus?.emit(Events.SPAWN_PARTICLES, {
          kind: 'land',
          x: this.body.box.centerX,
          y: this.body.box.bottom,
          intensity: hard ? 1.6 : 0.8,
        });
        if (hard) this.bus?.emit(Events.SCREEN_SHAKE, { amount: 0.16 });
        this._fallStartY = this.body.box.bottom;
      },
      update: (dt) => {
        this._applyHorizontal(dt, C.groundAccel, C.groundFriction, C.runSpeed);
        if (this._tryJump()) return;
        if (this._checkCommonTransitions()) return;
        // Landing lag is a single frame of state, not a delay: the player is in
        // full control immediately. The state exists for presentation only.
        m.change(input()?.moveDirection() !== 0 ? PlayerState.RUN : PlayerState.IDLE);
      },
    });

    // ---- DASH ----
    m.add(PlayerState.DASH, {
      enter: () => {
        const inp = input();
        const dir = inp?.moveDirection() || this.facing;
        this.facing = dir;
        this.body.velocity.x = dir * C.dashSpeed;
        this.body.velocity.y = 0;
        this.body.gravityScale = C.dashGravityScale;
        this.dashCooldownTimer = C.dashCooldown;
        if (!this.body.grounded) this.airDashUsed = true;
        this.intangible = true;
        this.stats.dashes++;
        this.visual.stretch = 1.35;
        this.visual.squash = 0.78;
        this.bus?.emit(Events.PLAYER_DASHED, { player: this, direction: dir });
        this.bus?.emit(Events.SFX, { id: 'dash' });
        this.bus?.emit(Events.SPAWN_PARTICLES, {
          kind: 'dash',
          x: this.body.box.centerX,
          y: this.body.box.centerY,
          direction: dir,
        });
      },
      update: (dt) => {
        // Record after-images.
        this.visual.trail.push({ x: this.body.box.x, y: this.body.box.y, age: 0 });

        if (m.timeInState >= C.dashIFrames) this.intangible = false;

        if (m.timeInState >= C.dashDuration) {
          this.body.velocity.x = this.facing * C.dashSpeed * C.dashExitMomentum;
          m.change(this.body.grounded ? PlayerState.IDLE : PlayerState.FALL);
          return;
        }
        // Attacking out of a dash is allowed and is the core of the game's
        // offensive movement: it keeps the dash's momentum while adding a hit.
        const inp = input();
        if (this.attackCooldownTimer <= 0 && inp?.consume(Action.ATTACK)) {
          this.attackDir = this._readAttackDirection();
          m.change(PlayerState.ATTACK);
        }
      },
      exit: () => {
        this.body.gravityScale = 1;
        this.intangible = false;
      },
      // A dash cannot be interrupted by wall-slide or common transitions; it is
      // a committed movement verb. Only attack, damage and death may break it.
      canExit: (next) => next !== PlayerState.WALL_SLIDE,
    });

    // ---- WALL SLIDE ----
    m.add(PlayerState.WALL_SLIDE, {
      enter: () => {
        this.body.velocity.y = Math.min(this.body.velocity.y, C.wallSlideInitialSpeed);
        this.facing = -this.body.wallDirection();
        this.airJumpsUsed = 0;
        this.airDashUsed = false;
        // The slide owns vertical motion outright. Leaving gravity enabled and
        // merely steering velocity toward the slide speed does not work: the
        // controller runs before physics integrates, so gravity is applied
        // *after* the clamp every step and the player accelerates into a
        // free-fall that happens to be touching a wall.
        this.body.gravityScale = 0;
        this.bus?.emit(Events.SFX, { id: 'wallGrab' });
      },
      exit: () => {
        this.body.gravityScale = 1;
      },
      update: (dt) => {
        const wall = this.body.wallDirection() || this.wallCoyoteSide;

        // Actively press into the wall.
        //
        // Contact is only reported on steps where the body actually *moves*
        // into the surface. Once resolution has zeroed horizontal velocity, a
        // state that does not re-apply inward motion sees no contact on the
        // next step, drops to falling, accelerates back into the wall, and
        // re-enters the slide — a one-frame oscillation that reads as the
        // character vibrating against the wall.
        this.body.velocity.x = wall * 24;

        // Cling briefly before sliding, which makes precise wall work possible.
        if (m.timeInState > C.wallClingTime) {
          this.body.velocity.y = moveToward(this.body.velocity.y, C.wallSlideSpeed, 600 * dt);
        } else {
          this.body.velocity.y = moveToward(this.body.velocity.y, C.wallSlideInitialSpeed, 400 * dt);
        }

        this.bus?.emit(Events.SPAWN_PARTICLES, {
          kind: 'wallSlide',
          x: this.body.box.centerX + wall * (C.width / 2),
          y: this.body.box.centerY,
        });

        if (this._tryWallJump()) return;

        const inp = input();
        if (this.canDash() && inp?.consume(Action.DASH)) {
          m.change(PlayerState.DASH);
          return;
        }
        if (this.attackCooldownTimer <= 0 && inp?.consume(Action.ATTACK)) {
          this.attackDir = this._readAttackDirection();
          m.change(PlayerState.ATTACK);
          return;
        }
        // Letting go of the wall direction drops the player off it.
        if (inp && inp.moveDirection() !== wall) {
          m.change(PlayerState.FALL);
        }
      },
      lateUpdate: () => {
        if (this.body.grounded) {
          m.change(PlayerState.LAND);
        } else if (!this.body.touchingWall() && this.wallCoyoteTimer <= 0) {
          // The coyote window doubles as contact hysteresis, so passing a
          // one-tile gap in the wall does not drop the player off it.
          m.change(PlayerState.FALL);
        }
      },
    });

    // ---- ATTACK ----
    m.add(PlayerState.ATTACK, {
      enter: () => {
        this.timeSinceAttack = 0;
        this.stats.attacks++;
        this.attackCooldownTimer = C.attackCooldown;
        this._attackHitboxSpawned = false;
        this._attackConnected = false;
        this._attackPogoed = false;
        this.visual.attackProgress = 0;
        this.visual.attackDir = this.attackDir;
        this.bus?.emit(Events.ATTACK_STARTED, { player: this, direction: this.attackDir });
        this.bus?.emit(Events.SFX, { id: this.comboIndex % 2 === 0 ? 'slashA' : 'slashB' });

        // A grounded forward attack steps the player forward slightly.
        if (this.body.grounded && this.attackDir === AttackDirection.FORWARD) {
          this.body.velocity.x += this.facing * C.attackLunge;
        }
      },
      update: (dt) => {
        const spec = ATTACK_SPECS[this.attackDir];
        const startup = C.attackStartup * FRAME;
        const active = C.attackActive * FRAME;
        const total = startup + active + C.attackRecovery * FRAME;

        this.visual.attackProgress = clamp(m.timeInState / total, 0, 1);

        // Movement continues during an attack: stopping the player dead would
        // make combat feel like a series of pauses rather than a flow.
        if (this.body.grounded) {
          this._applyHorizontal(dt, C.groundAccel * 0.55, C.groundFriction * 0.8, C.runSpeed * 0.72);
        } else {
          this._applyHorizontal(dt, C.airAccel * 0.7, C.airFriction, C.maxAirSpeed);
          this._applyGravity(dt);
        }

        if (!this._attackHitboxSpawned && m.timeInState >= startup) {
          this._attackHitboxSpawned = true;
          this._spawnAttackHitbox(spec);
        }

        // Jumping cancels the recovery frames, which rewards good timing and
        // keeps aerial combat mobile.
        if (m.timeInState >= startup + active) {
          if (this._tryJump()) return;
          const inp = input();
          if (this.canDash() && inp?.consume(Action.DASH)) {
            m.change(PlayerState.DASH);
            return;
          }
        }

        if (m.timeInState >= total) {
          this.comboIndex++;
          if (this.body.grounded) {
            m.change(input()?.moveDirection() !== 0 ? PlayerState.RUN : PlayerState.IDLE);
          } else {
            m.change(this.body.velocity.y < 0 ? PlayerState.JUMP : PlayerState.FALL);
          }
        }
      },
      lateUpdate: () => {
        if (this.body.grounded && this.attackDir === AttackDirection.DOWN) {
          // A downward attack that reaches the ground converts to a forward one
          // rather than whiffing into the floor.
          this.attackDir = AttackDirection.FORWARD;
        }
      },
    });

    // ---- HURT ----
    m.add(PlayerState.HURT, {
      enter: (prev, params) => {
        const dir = params?.dirX ?? -this.facing;
        this.body.velocity.x = Math.sign(dir || -this.facing) * C.hurtKnockbackX;
        this.body.velocity.y = C.hurtKnockbackY;
        this.body.gravityScale = 1;
        if (params?.restoreToSafe) this._pendingSafeRestore = true;
      },
      update: (dt) => {
        this._applyGravity(dt);
        // No horizontal control during knockback: the hit must land as a loss
        // of control, or it carries no weight.
        if (m.timeInState >= C.hurtDuration) {
          if (this._pendingSafeRestore) {
            this._pendingSafeRestore = false;
            this.restoreToSafeGround();
          }
          m.change(this.body.grounded ? PlayerState.IDLE : PlayerState.FALL);
        }
      },
    });

    // ---- DEAD ----
    m.add(PlayerState.DEAD, {
      enter: () => {
        this.stats.deaths++;
        this.body.velocity.set(0, -180);
        this.intangible = true;
        this.hurtbox.enabled = false;
        this.bus?.emit(Events.PLAYER_DIED, { player: this });
        this.bus?.emit(Events.SCREEN_SHAKE, { amount: 0.8 });
        this.bus?.emit(Events.SFX, { id: 'death' });
      },
      update: (dt) => {
        this._applyGravity(dt);
        this.body.velocity.x = moveToward(this.body.velocity.x, 0, 300 * dt);
      },
      // Death is terminal until the game explicitly respawns the player.
      canExit: () => false,
    });

    // ---- FOCUS (channelled heal) ----
    m.add(PlayerState.FOCUS, {
      enter: () => {
        this.focusCharge = 0;
        this.body.velocity.x = 0;
        this.bus?.emit(Events.SFX, { id: 'focusStart' });
      },
      update: (dt) => {
        const inp = input();
        this.body.velocity.x = moveToward(this.body.velocity.x, 0, 900 * dt);

        // Any of these break the channel; healing is meant to be interruptible
        // and to cost the player their positioning.
        if (!inp?.isDown(Action.FOCUS) || !this.body.grounded) {
          m.change(this.body.grounded ? PlayerState.IDLE : PlayerState.FALL);
          return;
        }
        if (this._checkCommonTransitions()) return;
        if (this._tryJump()) return;

        this.focusCharge += dt * this.focusSpeedScale;
        this.bus?.emit(Events.SPAWN_PARTICLES, {
          kind: 'focus',
          x: this.body.box.centerX,
          y: this.body.box.centerY,
          progress: this.focusCharge / C.focusDuration,
        });

        if (this.focusCharge >= C.focusDuration) {
          if (this.spendInk(C.focusCost)) {
            const healed = this.health.heal(this.focusPotency);
            if (healed > 0) {
              this.bus?.emit(Events.PLAYER_HEALED, { player: this, amount: healed });
              this.bus?.emit(Events.SFX, { id: 'heal' });
              this.bus?.emit(Events.FLASH, { color: '#bfe6ff', amount: 0.2 });
            }
          }
          this.focusCharge = 0;
          if (this.ink < C.focusCost || this.health.current >= this.health.max) {
            m.change(PlayerState.IDLE);
          }
        }
      },
      exit: () => {
        this.focusCharge = 0;
      },
    });

    // ---- CLIMB ----
    m.add(PlayerState.CLIMB, {
      enter: () => {
        this.body.gravityScale = 0;
        this.body.velocity.zero();
      },
      update: (dt) => {
        const inp = input();
        const vy = inp ? inp.verticalDirection() : 0;
        this.body.velocity.y = vy < 0 ? -C.climbSpeed : vy > 0 ? C.climbDownSpeed : 0;
        this.body.velocity.x = moveToward(this.body.velocity.x, (inp?.moveDirection() ?? 0) * 40, 600 * dt);

        if (this._tryJump()) return;
        if (this.attackCooldownTimer <= 0 && inp?.consume(Action.ATTACK)) {
          this.attackDir = this._readAttackDirection();
          m.change(PlayerState.ATTACK);
        }
      },
      lateUpdate: () => {
        if (!this.onClimbable) {
          m.change(this.body.grounded ? PlayerState.IDLE : PlayerState.FALL);
        }
      },
      exit: () => {
        this.body.gravityScale = 1;
      },
    });

    // ---- SWIM ----
    m.add(PlayerState.SWIM, {
      enter: () => {
        this._strokeTimer = 0;
        this.body.maxFallSpeed = C.maxSwimSpeed;
      },
      update: (dt) => {
        const inp = input();
        const dir = inp ? inp.moveDirection() : 0;
        const v = this.body.velocity;

        if (dir !== 0) {
          this.facing = dir;
          v.x = moveToward(v.x, dir * C.swimSpeed, C.swimAccel * dt);
        } else {
          v.x = moveToward(v.x, 0, C.swimAccel * 0.6 * dt);
        }

        // Swimming is stroke-based rather than free flight: holding up gives
        // rhythmic pulses, which reads as swimming rather than as flying.
        this._strokeTimer -= dt;
        if (inp?.isDown(Action.JUMP) && this._strokeTimer <= 0) {
          v.y = C.swimStroke;
          this._strokeTimer = C.swimStrokeInterval;
          this.bus?.emit(Events.SFX, { id: 'swimStroke' });
          this.bus?.emit(Events.SPAWN_PARTICLES, {
            kind: 'bubbles',
            x: this.body.box.centerX,
            y: this.body.box.bottom,
          });
        }
        if (inp && inp.verticalDirection() > 0) {
          v.y = moveToward(v.y, C.maxSwimSpeed, C.swimAccel * dt);
        }

        v.y = clamp(v.y, -C.maxSwimSpeed * 1.4, C.maxSwimSpeed);

        if (this.attackCooldownTimer <= 0 && inp?.consume(Action.ATTACK)) {
          this.attackDir = this._readAttackDirection();
          m.change(PlayerState.ATTACK);
        }
      },
      lateUpdate: () => {
        if (!this.inFluid) {
          m.change(this.body.grounded ? PlayerState.IDLE : PlayerState.FALL);
        }
      },
      exit: () => {
        this.body.maxFallSpeed = C.maxFallSpeed;
      },
    });

    // ---- SIT (resting at a Wellspring) ----
    m.add(PlayerState.SIT, {
      enter: () => {
        this.body.velocity.zero();
        this.health.reset();
        this.ink = this.maxInk;
        this.bus?.emit(Events.SFX, { id: 'rest' });
      },
      update: () => {
        const inp = input();
        if (inp && (inp.consume(Action.JUMP) || Math.abs(inp.axisX) > 0.6 || inp.consume(Action.INTERACT))) {
          m.change(PlayerState.IDLE);
        }
      },
    });

    // ---- LOCKED (cutscenes, dialogue, menus) ----
    m.add(PlayerState.LOCKED, {
      enter: () => {
        this.body.velocity.x = 0;
      },
      update: (dt) => {
        this.body.velocity.x = moveToward(this.body.velocity.x, 0, 1200 * dt);
        if (!this.body.grounded) this._applyGravity(dt);
      },
    });

    // ---- TRANSITION (moving between rooms) ----
    m.add(PlayerState.TRANSITION, {
      enter: () => {
        this.intangible = true;
      },
      update: (dt) => {
        if (!this.body.grounded) this._applyGravity(dt);
      },
      exit: () => {
        this.intangible = false;
      },
    });
  }

  /**
   * Wall jump, honouring wall coyote time.
   * @returns {boolean}
   * @private
   */
  _tryWallJump() {
    if (!this.canWallInteract()) return false;
    const side = this.body.wallDirection() || (this.wallCoyoteTimer > 0 ? this.wallCoyoteSide : 0);
    if (side === 0) return false;
    const input = this.ctx.input;
    if (!input || !input.consume(Action.JUMP, C.jumpBuffer)) return false;

    this.body.velocity.x = -side * C.wallJumpVelocityX;
    this.body.velocity.y = C.wallJumpVelocityY;
    this.facing = -side;
    this.wallJumpLockoutTimer = C.wallJumpLockout;
    this.wallCoyoteTimer = 0;
    this.airJumpsUsed = 0;
    this.stats.jumps++;
    this.visual.stretch = 1.2;
    this.bus?.emit(Events.PLAYER_JUMPED, { player: this, wall: true });
    this.bus?.emit(Events.SFX, { id: 'wallJump' });
    this.bus?.emit(Events.SPAWN_PARTICLES, {
      kind: 'wallJump',
      x: this.body.box.centerX + side * (C.width / 2),
      y: this.body.box.centerY,
      direction: -side,
    });
    this.machine.change(PlayerState.JUMP);
    return true;
  }

  /**
   * @param {import('./attacks.js').AttackSpec} spec
   * @private
   */
  _spawnAttackHitbox(spec) {
    const combat = this.ctx.combat;
    if (!combat) return;

    const hitbox = combat.spawnHitbox(
      this,
      {
        offsetX: spec.offsetX,
        offsetY: spec.offsetY,
        width: spec.width,
        height: spec.height,
        damage: this.attackDamage * spec.damageMultiplier,
        team: Team.PLAYER,
        damageType: DamageType.PHYSICAL,
        knockback: spec.knockback,
        knockbackAngle: spec.knockbackAngle,
        hitstop: spec.hitstop,
        trauma: spec.trauma,
        poise: spec.poise,
        activeFrames: C.attackActive,
        pogo: spec.pogo,
        id: spec.id,
      },
      this.body.box.centerX,
      this.body.box.centerY,
      this.facing,
    );

    // Striking terrain produces a spark and a recoil, so the blade feels like
    // it occupies space rather than passing through the world.
    if (combat.hitboxTouchesTerrain(hitbox)) {
      hitbox.hitTerrain = true;
      this._onAttackHitTerrain(spec);
    }
  }

  /**
   * @param {import('./attacks.js').AttackSpec} spec
   * @private
   */
  _onAttackHitTerrain(spec) {
    this.bus?.emit(Events.SFX, { id: 'slashTerrain' });
    this.bus?.emit(Events.SPAWN_PARTICLES, {
      kind: 'sparks',
      x: this.body.box.centerX + spec.offsetX * this.facing,
      y: this.body.box.centerY + spec.offsetY,
      direction: -this.facing,
    });
    if (spec.pogo && !this.body.grounded) {
      this.applyPogo();
    } else if (this.body.grounded && spec.direction === AttackDirection.FORWARD) {
      this.body.velocity.x = -this.facing * C.attackRecoilSpeed;
    }
  }

  /**
   * Bounce the player upward off whatever their downward strike connected with.
   * Called by the combat system when a pogo hitbox lands, and by terrain hits.
   */
  applyPogo() {
    if (this._attackPogoed) return;
    this._attackPogoed = true;
    this.body.velocity.y = C.pogoVelocity;
    this.body.velocity.x *= C.pogoHorizontalRetain;
    this.airJumpsUsed = 0;
    this.airDashUsed = false;
    this.coyoteTimer = 0;
    this.visual.stretch = 1.25;
    this.bus?.emit(Events.SFX, { id: 'pogo' });
    this.bus?.emit(Events.SPAWN_PARTICLES, {
      kind: 'pogo',
      x: this.body.box.centerX,
      y: this.body.box.bottom,
    });
  }

  /**
   * Called by the combat system when one of the player's attacks connects.
   * Kept as a method rather than an event listener so the ordering relative to
   * damage application is explicit.
   * @param {number} damage
   * @param {import('../combat/hitbox.js').Hitbox} hitbox
   */
  onAttackConnected(damage, hitbox) {
    this._attackConnected = true;
    this.stats.damageDealt += damage;
    this.gainInk(this.inkPerHit);
    if (hitbox.pogo && !this.body.grounded) this.applyPogo();
  }

  /** @returns {boolean} true when the player is in a state that accepts input */
  get hasControl() {
    return !this.machine.isAny(
      PlayerState.HURT,
      PlayerState.DEAD,
      PlayerState.LOCKED,
      PlayerState.TRANSITION,
      PlayerState.SIT,
    );
  }

  /** Put the player under scripted control (dialogue, cutscene). */
  lockControl() {
    if (!this.machine.is(PlayerState.DEAD)) this.machine.force(PlayerState.LOCKED);
  }

  /** Return control to the player. */
  releaseControl() {
    if (this.machine.is(PlayerState.LOCKED)) {
      this.machine.force(this.body.grounded ? PlayerState.IDLE : PlayerState.FALL);
    }
  }

  /**
   * Serialise the parts of the player that belong in a save file.
   * Position is not included — that is the world's business.
   * @returns {object}
   */
  toJSON() {
    return {
      maxHealth: this.health.max,
      health: this.health.current,
      ink: this.ink,
      maxInk: this.maxInk,
      glyphs: this.glyphs,
      abilities: this.abilities.toJSON(),
      nibTier: this.nibTier,
      damageBonus: this.damageBonus,
      inkPerHit: this.inkPerHit,
      inkGainScale: this.inkGainScale,
      focusSpeedScale: this.focusSpeedScale,
      focusPotency: this.focusPotency,
      maxJumps: this.maxJumps,
      facing: this.facing,
      stats: { ...this.stats },
    };
  }

  /**
   * @param {any} data
   */
  load(data) {
    if (!data) return;
    this.health.max = data.maxHealth ?? 5;
    this.health.current = clamp(data.health ?? this.health.max, 0, this.health.max);
    this.health.dead = false;
    this.maxInk = data.maxInk ?? 99;
    this.ink = clamp(data.ink ?? 0, 0, this.maxInk);
    this.glyphs = data.glyphs ?? 0;
    this.abilities.load(data.abilities);
    this.nibTier = data.nibTier ?? 0;
    this.damageBonus = data.damageBonus ?? 0;
    this.inkPerHit = data.inkPerHit ?? 11;
    this.inkGainScale = data.inkGainScale ?? 1;
    this.focusSpeedScale = data.focusSpeedScale ?? 1;
    this.focusPotency = data.focusPotency ?? 1;
    this.maxJumps = data.maxJumps ?? (this.abilities.owns(Ability.PAPERWING) ? 2 : 1);
    this.facing = data.facing ?? 1;
    if (data.stats) Object.assign(this.stats, data.stats);
  }
}
