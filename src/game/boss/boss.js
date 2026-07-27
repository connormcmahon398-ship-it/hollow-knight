/**
 * @file Boss framework: phases, pattern scheduling and arena management.
 *
 * ## Why bosses are not just tough enemies
 * An enemy answers "how do I handle this thing". A boss answers "how do I
 * handle this *fight*", which needs three things enemies do not have:
 *
 * 1. **Phases.** Health thresholds that change the moveset, so the fight has an
 *    arc rather than a plateau. Each phase transition is also a moment of
 *    respite and spectacle, which is what makes a long fight readable.
 * 2. **A pattern scheduler.** Bosses pick attacks from a weighted pool with
 *    constraints (cooldowns, range gates, no-repeat rules) rather than running
 *    a fixed state machine. This is what stops a fight becoming memorised
 *    choreography while keeping it fair.
 * 3. **Arena control.** Locked doors, a health bar, music, and a defined space.
 *
 * ## Fairness rules baked into the scheduler
 * These exist because "challenging but fair" is a mechanical property, not a
 * vibe:
 *
 * - **No unavoidable damage.** Every pattern declares a `telegraph` duration;
 *   the scheduler refuses to start one shorter than the phase's minimum.
 * - **No repeats without rest.** A pattern cannot be selected twice in a row
 *   unless it is the only legal option, so the player is never caught in a loop
 *   they cannot escape.
 * - **Guaranteed recovery windows.** Every pattern ends in a `recover` state
 *   whose length is the player's opportunity to attack and to heal. Removing
 *   these makes a boss unbeatable rather than hard.
 * - **Range gating.** Patterns declare the ranges at which they make sense, so
 *   a boss never uses a close-range slam while the player is across the arena.
 */

import { Enemy, EnemyState } from '../enemy/enemy.js';
import { StateMachine } from '../../engine/core/state-machine.js';
import { Events } from '../../engine/core/events.js';
import { clamp, moveToward } from '../../engine/math/math-utils.js';
import { Team } from '../combat/hitbox.js';

/**
 * @typedef {Object} BossPattern
 * @property {string} id
 * @property {string} name Shown by the debug overlay and the boss-rush readout.
 * @property {number} telegraph Seconds of visible wind-up before anything hits.
 * @property {number} duration Seconds the pattern's active portion lasts.
 * @property {number} recovery Seconds of vulnerability afterwards.
 * @property {number} [weight] Selection weight within the phase.
 * @property {number} [minRange] Only chosen when the player is at least this far.
 * @property {number} [maxRange] Only chosen when the player is at most this far.
 * @property {number} [cooldown] Seconds before this pattern may repeat.
 * @property {boolean} [requiresGround] Only when the boss is grounded.
 * @property {(boss: Boss) => void} [onTelegraph]
 * @property {(boss: Boss, dt: number, t: number) => void} [onActive] `t` is 0..1 through the active window.
 * @property {(boss: Boss) => void} [onStart] Fired once when the active window opens.
 * @property {(boss: Boss) => void} [onEnd]
 */

/**
 * @typedef {Object} BossPhase
 * @property {string} id
 * @property {string} name
 * @property {number} healthThreshold Fraction of max health at which this phase begins.
 * @property {BossPattern[]} patterns
 * @property {number} [minTelegraph] Fairness floor for this phase, seconds.
 * @property {number} [aggression] Multiplier on how quickly patterns are chosen.
 * @property {string} [music] Track id.
 * @property {(boss: Boss) => void} [onEnter]
 * @property {(boss: Boss, dt: number) => void} [onUpdate]
 */

/**
 * @typedef {Object} BossDef
 * @property {string} id
 * @property {string} name
 * @property {string} title Displayed under the name on the health bar.
 * @property {string} biome
 * @property {number} health
 * @property {number} damage Contact damage.
 * @property {number} width @property {number} height
 * @property {BossPhase[]} phases
 * @property {boolean} [optional] Not required to finish the game.
 * @property {boolean} [secret] Hidden; not shown in the bestiary until found.
 * @property {string} [rewardAbility] Ability id granted on defeat.
 * @property {string} [rewardItem]
 * @property {number} [glyphs]
 * @property {string} [lore]
 * @property {any} [visual]
 * @property {boolean} [flying]
 * @property {number} [poise]
 * @property {Record<string, number>} [resistances]
 */

export class Boss extends Enemy {
  /**
   * @param {BossDef} def
   * @param {Partial<import('../context.js').GameContext>} ctx
   */
  constructor(def, ctx) {
    // A boss is built on the enemy chassis with a null archetype; its own
    // machine replaces the archetype's states entirely.
    super(
      {
        id: def.id,
        name: def.name,
        archetype: 'bossShell',
        biome: def.biome,
        health: def.health,
        damage: def.damage,
        width: def.width,
        height: def.height,
        flying: def.flying,
        poise: def.poise ?? 0,
        resistances: def.resistances,
        glyphs: def.glyphs ?? 0,
        visual: def.visual,
      },
      ctx,
    );

    this.bossDef = def;
    this.title = def.title;
    this.isBoss = true;

    /** @type {BossPhase} */
    this.phase = def.phases[0];
    this.phaseIndex = 0;

    /** @type {BossPattern|null} */
    this.pattern = null;
    /** Id of the previous pattern, to enforce the no-repeat rule. */
    this.lastPatternId = '';
    /** @type {Map<string, number>} Per-pattern cooldown timers. */
    this.patternCooldowns = new Map();
    /** Seconds until the next pattern is chosen. */
    this.decisionTimer = 0;

    /** Set once the encounter has formally begun (arena sealed, bar shown). */
    this.encounterActive = false;
    /** Set when the boss has been beaten, before the death animation ends. */
    this.defeated = false;

    /**
     * Damage taken during the current phase, used to keep pacing honest: a
     * player who is winning quickly should still see the phase's identity
     * before it ends.
     */
    this.damageThisPhase = 0;

    this.phaseMachine = new StateMachine({ debugName: `Boss:${def.id}` });
    this._buildBossStates();
  }

  /** @private */
  _buildBossStates() {
    const m = this.machine;

    // Replace the archetype shell's states with boss-specific ones.
    m.add('bossIdle', {
      enter: () => {
        this.body.velocity.x = 0;
      },
      update: (dt) => {
        if (!this.encounterActive) return;
        this.facePlayer();
        this._repositionDuringIdle(dt);
        this.decisionTimer -= dt * (this.phase.aggression ?? 1);
        if (this.decisionTimer <= 0) {
          const next = this.selectPattern();
          if (next) {
            this.pattern = next;
            m.change('bossTelegraph');
          } else {
            // No legal pattern (the player is out of every range band).
            // Reposition rather than standing still, which would look broken.
            this.decisionTimer = 0.3;
          }
        }
      },
    });

    m.add('bossTelegraph', {
      enter: () => {
        this.facePlayer();
        this.pattern?.onTelegraph?.(this);
        this.bus?.emit(Events.SFX, { id: 'bossTelegraph' });
      },
      update: (dt) => {
        const p = this.pattern;
        if (!p) {
          m.change('bossIdle');
          return;
        }
        // Visible agitation during the wind-up: the whole point of a telegraph
        // is that the player can see it without a UI element.
        this.visual.wobble = Math.sin(m.timeInState * 30) * 0.6;
        this.body.velocity.x = moveToward(this.body.velocity.x, 0, 600 * dt);
        if (m.timeInState >= p.telegraph) m.change('bossActive');
      },
      exit: () => {
        this.visual.wobble = 0;
      },
    });

    m.add('bossActive', {
      enter: () => {
        this.pattern?.onStart?.(this);
      },
      update: (dt) => {
        const p = this.pattern;
        if (!p) {
          m.change('bossIdle');
          return;
        }
        const t = clamp(m.timeInState / Math.max(p.duration, 1e-4), 0, 1);
        p.onActive?.(this, dt, t);
        if (m.timeInState >= p.duration) m.change('bossRecover');
      },
      exit: () => {
        this.pattern?.onEnd?.(this);
      },
    });

    m.add('bossRecover', {
      enter: () => {
        const p = this.pattern;
        if (p) {
          this.lastPatternId = p.id;
          this.patternCooldowns.set(p.id, p.cooldown ?? 0);
        }
      },
      update: (dt) => {
        const p = this.pattern;
        this.body.velocity.x = moveToward(this.body.velocity.x, 0, 400 * dt);
        // Recovery is the player's window. It is never skipped, even if the
        // boss is "ready" — a boss with no downtime is not hard, it is broken.
        if (m.timeInState >= (p?.recovery ?? 0.6)) {
          this.decisionTimer = 0.25;
          m.change('bossIdle');
        }
      },
    });

    m.add('bossPhaseChange', {
      enter: () => {
        this.body.velocity.set(0, 0);
        this.health.grantIFrames(2.2);
        this.bus?.emit(Events.BOSS_PHASE_CHANGED, {
          boss: this,
          phase: this.phase,
          index: this.phaseIndex,
        });
        this.bus?.emit(Events.SCREEN_SHAKE, { amount: 0.7 });
        this.bus?.emit(Events.FLASH, { color: '#ffffff', amount: 0.4 });
        this.bus?.emit(Events.SFX, { id: 'bossPhase' });
        this.phase.onEnter?.(this);
      },
      update: (dt) => {
        this.body.velocity.x = moveToward(this.body.velocity.x, 0, 800 * dt);
        this.visual.wobble = Math.sin(m.timeInState * 22) * (1 - m.timeInState / 2);
        if (m.timeInState >= 2) {
          this.decisionTimer = 0.4;
          m.change('bossIdle');
        }
      },
      exit: () => { this.visual.wobble = 0; },
      // A phase transition is a scripted beat and must not be interrupted.
      canExit: (next) => next === EnemyState.DEAD,
    });

    m.add('bossDormant', {
      update: () => {
        this.body.velocity.x = 0;
      },
    });

    m.force('bossDormant');
  }

  /**
   * Begin the encounter: seal the arena, show the bar, start the music.
   */
  beginEncounter() {
    if (this.encounterActive || this.defeated) return;
    this.encounterActive = true;
    this.decisionTimer = 0.8;
    this.machine.force('bossIdle');
    this.bus?.emit(Events.BOSS_ENCOUNTER_STARTED, { boss: this, def: this.bossDef });
  }

  /**
   * Choose the next pattern, applying every fairness constraint.
   * @returns {BossPattern|null}
   */
  selectPattern() {
    const candidates = [];
    const weights = [];
    const minTelegraph = this.phase.minTelegraph ?? 0.28;

    for (const p of this.phase.patterns) {
      // Fairness floor: a pattern whose wind-up is too short to react to is a
      // content bug, and the scheduler refuses it rather than shipping it.
      if (p.telegraph < minTelegraph) continue;
      if ((this.patternCooldowns.get(p.id) ?? 0) > 0) continue;
      if (p.minRange !== undefined && this.distanceToPlayer < p.minRange) continue;
      if (p.maxRange !== undefined && this.distanceToPlayer > p.maxRange) continue;
      if (p.requiresGround && !this.body.grounded) continue;
      candidates.push(p);
      weights.push(p.weight ?? 1);
    }

    if (candidates.length === 0) return null;

    // No-repeat rule, unless it is the only legal option.
    if (candidates.length > 1) {
      for (let i = candidates.length - 1; i >= 0; i--) {
        if (candidates[i].id === this.lastPatternId) {
          candidates.splice(i, 1);
          weights.splice(i, 1);
        }
      }
    }
    if (candidates.length === 0) return null;

    const rng = this.ctx.rng;
    return rng ? rng.pickWeighted(candidates, weights) : candidates[0];
  }

  /**
   * Idle repositioning, so the boss is not a statue between patterns.
   * @param {number} dt
   * @private
   */
  _repositionDuringIdle(dt) {
    const player = this.ctx.player;
    if (!player) return;
    const preferred = this.bossDef.visual?.preferredRange ?? 70;
    const delta = this.distanceToPlayer - preferred;
    const dir = Math.sign(player.body.box.centerX - this.body.box.centerX);
    const speed = Math.abs(delta) > 12 ? this.speed * clamp(Math.abs(delta) / 60, 0.2, 1) : 0;
    this.body.velocity.x = moveToward(this.body.velocity.x, dir * Math.sign(delta) * speed, 420 * dt);
  }

  /**
   * @param {number} dt
   */
  update(dt) {
    // Tick per-pattern cooldowns.
    for (const [id, t] of this.patternCooldowns) {
      if (t > 0) this.patternCooldowns.set(id, Math.max(0, t - dt));
    }

    if (this.encounterActive && !this.health.dead) {
      this._checkPhaseTransition();
      this.phase.onUpdate?.(this, dt);
    }

    super.update(dt);
  }

  /** @private */
  _checkPhaseTransition() {
    const frac = this.health.fraction;
    const phases = this.bossDef.phases;
    // Find the deepest phase whose threshold the boss has fallen below.
    let target = this.phaseIndex;
    for (let i = phases.length - 1; i > this.phaseIndex; i--) {
      if (frac <= phases[i].healthThreshold) {
        target = i;
        break;
      }
    }
    if (target !== this.phaseIndex) {
      this.phaseIndex = target;
      this.phase = phases[target];
      this.damageThisPhase = 0;
      this.pattern = null;
      this.lastPatternId = '';
      this.patternCooldowns.clear();
      this.machine.force('bossPhaseChange');
    }
  }

  /** @override @private */
  _onDeath() {
    this.defeated = true;
    this.encounterActive = false;
    this.bus?.emit(Events.BOSS_DEFEATED, { boss: this, def: this.bossDef });
    this.bus?.emit(Events.SCREEN_SHAKE, { amount: 1 });
    this.bus?.emit(Events.FLASH, { color: '#ffffff', amount: 0.7 });
    super._onDeath();
  }

  /**
   * Spawn a hitbox in arena coordinates. Bosses frequently attack places rather
   * than directions, so this is more useful than the enemy `swing` helper.
   * @param {object} spec
   * @param {number} spec.x @param {number} spec.y centre
   * @param {number} spec.width @param {number} spec.height
   * @param {number} [spec.damage]
   * @param {number} [spec.frames]
   * @param {number} [spec.knockback]
   * @param {number} [spec.hitstop]
   * @param {number} [spec.trauma]
   */
  strikeAt(spec) {
    this.ctx.combat?.spawnHitboxAt(
      this,
      {
        offsetX: 0,
        offsetY: 0,
        width: spec.width,
        height: spec.height,
        damage: spec.damage ?? this.bossDef.damage,
        team: Team.ENEMY,
        knockback: spec.knockback ?? 200,
        hitstop: spec.hitstop ?? 4,
        trauma: spec.trauma ?? 0.12,
        activeFrames: spec.frames ?? 6,
        id: 'bossStrike',
      },
      spec.x - spec.width / 2,
      spec.y - spec.height / 2,
    );
  }

  /**
   * Fire a ring of projectiles — the workhorse of bullet patterns.
   * @param {object} spec
   * @param {number} spec.count
   * @param {number} spec.speed
   * @param {number} [spec.startAngle]
   * @param {number} [spec.arc] radians covered; defaults to a full circle
   * @param {number} [spec.damage]
   * @param {number} [spec.size]
   * @param {string} [spec.color]
   * @param {number} [spec.gravity]
   */
  fireRing(spec) {
    const arc = spec.arc ?? Math.PI * 2;
    const start = spec.startAngle ?? 0;
    const full = Math.abs(arc - Math.PI * 2) < 1e-6;
    for (let i = 0; i < spec.count; i++) {
      // A full ring divides by count; an arc divides by count-1 so both
      // endpoints are included.
      const denom = full ? spec.count : Math.max(1, spec.count - 1);
      const angle = start + (i / denom) * arc;
      this.fireProjectile({
        angle,
        speed: spec.speed,
        damage: spec.damage ?? this.bossDef.damage,
        size: spec.size ?? 4,
        color: spec.color ?? this.bossDef.visual?.accent,
        gravity: spec.gravity ?? 0,
        life: 5,
      });
    }
  }

  /** @returns {number} 0..1 health for the boss bar */
  get healthFraction() {
    return this.health.fraction;
  }

  /** @returns {string} name of the pattern in progress, for the debug overlay */
  get currentPatternName() {
    return this.pattern?.name ?? '—';
  }
}

// The boss chassis needs a registered archetype name, but supplies no states of
// its own; `Boss` installs everything after `super()` returns.
import { registerArchetype } from '../enemy/enemy.js';
registerArchetype({
  id: 'bossShell',
  description: 'Placeholder archetype; Boss installs its own phase states.',
  build(enemy, m) {
    // A boss must still answer to the shared IDLE/PATROL/CHASE contract in case
    // generic code (e.g. the stagger handler) transitions into one.
    m.add(EnemyState.IDLE, { update: () => {} });
    m.add(EnemyState.PATROL, { update: () => m.change(EnemyState.IDLE) });
    m.add(EnemyState.CHASE, { update: () => m.change(EnemyState.IDLE) });
  },
});

/** @type {Map<string, BossDef>} */
export const BOSS_DEFS = new Map();

/**
 * @param {BossDef} def
 * @returns {BossDef}
 */
export function defineBoss(def) {
  if (BOSS_DEFS.has(def.id)) throw new Error(`Duplicate boss id "${def.id}"`);
  if (!def.phases || def.phases.length === 0) {
    throw new Error(`Boss "${def.id}" has no phases`);
  }
  // Validate the fairness contract at load time rather than in the fight.
  for (const phase of def.phases) {
    if (phase.patterns.length === 0) {
      throw new Error(`Boss "${def.id}" phase "${phase.id}" has no patterns`);
    }
    const floor = phase.minTelegraph ?? 0.28;
    const usable = phase.patterns.filter((p) => p.telegraph >= floor);
    if (usable.length === 0) {
      throw new Error(
        `Boss "${def.id}" phase "${phase.id}": every pattern is below the ${floor}s telegraph floor, so the phase can never act`,
      );
    }
    for (const p of phase.patterns) {
      if (p.recovery <= 0) {
        throw new Error(
          `Boss "${def.id}" pattern "${p.id}" has no recovery window; the player would never get a turn`,
        );
      }
    }
  }
  BOSS_DEFS.set(def.id, def);
  return def;
}

/**
 * @param {string} id
 * @param {Partial<import('../context.js').GameContext>} ctx
 * @returns {Boss}
 */
export function createBoss(id, ctx) {
  const def = BOSS_DEFS.get(id);
  if (!def) throw new Error(`Unknown boss id "${id}"`);
  return new Boss(def, ctx);
}

/** @returns {BossDef[]} */
export function allBossDefs() {
  return [...BOSS_DEFS.values()];
}
