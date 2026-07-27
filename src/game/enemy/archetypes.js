/**
 * @file The enemy AI archetype library.
 *
 * Each archetype is a small state machine describing one *way of being
 * dangerous*. Content then instantiates them with different stats, ranges and
 * art to produce the world's full roster.
 *
 * ## Why these archetypes and not others
 * The set is chosen so that each one demands a different **player response**,
 * which is the only justification for an enemy existing:
 *
 * | Archetype   | Player must...                                    |
 * |-------------|---------------------------------------------------|
 * | walker      | time a swing; the baseline against which others read |
 * | charger     | sidestep or jump, then punish the recovery        |
 * | flyer       | use the up-slash, or wait for it to dip           |
 * | turret      | close distance through fire, or break line of sight |
 * | lobber      | move; standing still is what kills you            |
 * | jumper      | control space rather than trade hits               |
 * | burrower    | read tells and stop attacking the ground          |
 * | shielded    | attack from a specific side, or break the guard    |
 * | swarm       | prioritise, because individually they are trivial |
 * | ambusher    | look before dropping into a room                  |
 * | spinner     | wait; there is no safe frontal window             |
 * | tether      | kill the anchor, not the thing hitting you        |
 * | mirror      | stop mashing; it copies aggression                |
 * | splitter    | commit to finishing, or be overrun                |
 *
 * Fourteen distinct demands is plenty; more archetypes would mostly be
 * re-skins of these, which is exactly what the data layer is for.
 */

import { registerArchetype, EnemyState } from './enemy.js';
import { moveToward, clamp } from '../../engine/math/math-utils.js';
import { hasGroundBelow } from '../../engine/physics/tilemap-collider.js';
import { Events } from '../../engine/core/events.js';

// ---------------------------------------------------------------------------
// WALKER — patrols a platform, walks at the player when it notices them.
// ---------------------------------------------------------------------------
registerArchetype({
  id: 'walker',
  description: 'Ground patroller. Turns at walls and ledges; chases on sight.',
  build(enemy, m, p) {
    const chaseSpeed = p.chaseSpeed ?? enemy.speed * 1.7;

    m.add(EnemyState.IDLE, {
      update: (dt) => {
        enemy.body.velocity.x = moveToward(enemy.body.velocity.x, 0, 400 * dt);
        if (m.timeInState > (p.idleTime ?? 0.6)) m.change(EnemyState.PATROL);
        if (enemy.alerted) m.change(EnemyState.CHASE);
      },
    });

    m.add(EnemyState.PATROL, {
      update: (dt) => {
        enemy.walkForward(dt);
        if (enemy.alerted) m.change(EnemyState.CHASE);
        // Occasional pauses stop a room of walkers looking mechanical.
        if (p.pauses !== false && m.timeInState > 3.2) m.change(EnemyState.IDLE);
      },
    });

    m.add(EnemyState.CHASE, {
      update: (dt) => {
        if (!enemy.alerted) {
          m.change(EnemyState.PATROL);
          return;
        }
        enemy.facePlayer();
        // Chasing still respects ledges unless the definition says otherwise,
        // so a pursuing enemy does not suicide into the pit you jumped over.
        enemy.walkForward(dt, chaseSpeed);
      },
    });
  },
});

// ---------------------------------------------------------------------------
// CHARGER — telegraphs, then rushes in a straight line and must recover.
// ---------------------------------------------------------------------------
registerArchetype({
  id: 'charger',
  description: 'Winds up visibly, charges fast and overshoots, leaving an opening.',
  build(enemy, m, p) {
    const chargeSpeed = p.chargeSpeed ?? 240;
    const windup = p.windup ?? 0.55;
    const chargeTime = p.chargeTime ?? 0.85;

    m.add(EnemyState.IDLE, {
      update: (dt) => {
        enemy.body.velocity.x = moveToward(enemy.body.velocity.x, 0, 500 * dt);
        if (enemy.alerted) m.change(EnemyState.PATROL);
      },
    });

    m.add(EnemyState.PATROL, {
      update: (dt) => {
        enemy.walkForward(dt);
        if (enemy.canSeePlayer
          && Math.abs(enemy.toPlayerY ?? 0) < (p.verticalTolerance ?? 24)
          && enemy.attackCooldown <= 0) {
          m.change(EnemyState.WINDUP);
        }
      },
    });

    m.add(EnemyState.WINDUP, {
      enter: () => {
        enemy.facePlayer();
        enemy.body.velocity.x = 0;
        // Back-step during the wind-up: a physical tell the player can read
        // without a UI element.
        enemy.blackboard.chargeDir = enemy.facing;
        enemy.bus?.emit(Events.SFX, { id: 'chargeWindup' });
      },
      update: (dt) => {
        enemy.body.velocity.x = moveToward(enemy.body.velocity.x, -enemy.facing * 24, 300 * dt);
        enemy.visual.wobble = Math.sin(m.timeInState * 40) * 0.6;
        if (m.timeInState >= windup) m.change(EnemyState.ATTACK);
      },
      exit: () => {
        enemy.visual.wobble = 0;
      },
    });

    m.add(EnemyState.ATTACK, {
      enter: () => {
        enemy.body.velocity.x = enemy.blackboard.chargeDir * chargeSpeed;
        enemy.bus?.emit(Events.SFX, { id: 'charge' });
      },
      update: (dt) => {
        const dir = enemy.blackboard.chargeDir;
        enemy.body.velocity.x = moveToward(enemy.body.velocity.x, dir * chargeSpeed, 1400 * dt);
        // A charge stops at a wall, and the impact is the punish window.
        if ((dir > 0 && enemy.body.hitWallRight) || (dir < 0 && enemy.body.hitWallLeft)) {
          enemy.bus?.emit(Events.SCREEN_SHAKE, { amount: 0.16 });
          m.change(EnemyState.RECOVER);
          return;
        }
        if (m.timeInState >= chargeTime) m.change(EnemyState.RECOVER);
      },
    });

    m.add(EnemyState.RECOVER, {
      enter: () => {
        enemy.attackCooldown = p.cooldown ?? 1.4;
      },
      update: (dt) => {
        enemy.body.velocity.x = moveToward(enemy.body.velocity.x, 0, 420 * dt);
        if (m.timeInState >= (p.recovery ?? 0.7)) m.change(EnemyState.PATROL);
      },
    });

    m.add(EnemyState.CHASE, { update: () => m.change(EnemyState.PATROL) });
  },
});

// ---------------------------------------------------------------------------
// FLYER — drifts on a sine path, swoops when close.
// ---------------------------------------------------------------------------
registerArchetype({
  id: 'flyer',
  description: 'Airborne drifter that bobs on a wave and dives at the player.',
  build(enemy, m, p) {
    const amplitude = p.amplitude ?? 18;
    const frequency = p.frequency ?? 1.6;
    const diveSpeed = p.diveSpeed ?? 175;

    m.add(EnemyState.IDLE, {
      enter: () => {
        enemy.blackboard.baseY = enemy.body.box.centerY;
      },
      update: (dt) => {
        // Hover on a sine wave around the anchor height.
        const targetY = enemy.blackboard.baseY + Math.sin(enemy.visual.phase * frequency) * amplitude;
        enemy.body.velocity.y = moveToward(enemy.body.velocity.y, (targetY - enemy.body.box.centerY) * 4, 400 * dt);
        enemy.body.velocity.x = moveToward(enemy.body.velocity.x, enemy.facing * enemy.speed * 0.4, 180 * dt);
        if (enemy.body.hitWallLeft) enemy.facing = 1;
        if (enemy.body.hitWallRight) enemy.facing = -1;
        if (enemy.alerted) m.change(EnemyState.CHASE);
      },
    });

    m.add(EnemyState.CHASE, {
      update: (dt) => {
        const player = enemy.ctx.player;
        if (!player || !enemy.alerted) {
          m.change(EnemyState.IDLE);
          return;
        }
        // Approach to a standoff height above the player, so the dive has room.
        enemy.flyToward(
          player.body.box.centerX,
          player.body.box.centerY - (p.standoff ?? 30),
          dt,
          enemy.speed,
        );
        if (enemy.distanceToPlayer < (p.diveRange ?? 60) && enemy.attackCooldown <= 0) {
          m.change(EnemyState.WINDUP);
        }
      },
    });

    m.add(EnemyState.WINDUP, {
      enter: () => {
        enemy.body.velocity.set(0, 0);
        enemy.facePlayer();
      },
      update: (dt) => {
        enemy.body.velocity.y = moveToward(enemy.body.velocity.y, -40, 300 * dt);
        enemy.visual.wobble = Math.sin(m.timeInState * 34) * 0.5;
        if (m.timeInState >= (p.windup ?? 0.4)) {
          const angle = enemy.angleToPlayer();
          enemy.blackboard.diveX = Math.cos(angle) * diveSpeed;
          enemy.blackboard.diveY = Math.sin(angle) * diveSpeed;
          m.change(EnemyState.ATTACK);
        }
      },
      exit: () => { enemy.visual.wobble = 0; },
    });

    m.add(EnemyState.ATTACK, {
      enter: () => {
        enemy.body.velocity.set(enemy.blackboard.diveX, enemy.blackboard.diveY);
        enemy.attackCooldown = p.cooldown ?? 1.6;
      },
      update: () => {
        if (m.timeInState >= (p.diveTime ?? 0.5)
          || enemy.body.touchingWall()
          || enemy.body.grounded
          || enemy.body.hitCeiling) {
          m.change(EnemyState.RECOVER);
        }
      },
    });

    m.add(EnemyState.RECOVER, {
      update: (dt) => {
        enemy.body.velocity.x = moveToward(enemy.body.velocity.x, 0, 300 * dt);
        enemy.body.velocity.y = moveToward(enemy.body.velocity.y, -30, 260 * dt);
        if (m.timeInState >= (p.recovery ?? 0.6)) {
          enemy.blackboard.baseY = enemy.body.box.centerY;
          m.change(EnemyState.CHASE);
        }
      },
    });
  },
});

// ---------------------------------------------------------------------------
// TURRET — stationary, fires along a line when it can see the player.
// ---------------------------------------------------------------------------
registerArchetype({
  id: 'turret',
  description: 'Immobile shooter. Punishes standing still at range.',
  build(enemy, m, p) {
    enemy.body.isStatic = p.mobile !== true;

    m.add(EnemyState.IDLE, {
      update: () => {
        enemy.body.velocity.x = 0;
        if (enemy.canSeePlayer && enemy.attackCooldown <= 0) m.change(EnemyState.WINDUP);
      },
    });

    m.add(EnemyState.WINDUP, {
      enter: () => {
        enemy.facePlayer();
        enemy.bus?.emit(Events.SFX, { id: 'turretCharge' });
      },
      update: () => {
        enemy.visual.wobble = Math.sin(m.timeInState * 30) * 0.4;
        if (m.timeInState >= (p.windup ?? 0.45)) m.change(EnemyState.ATTACK);
      },
      exit: () => { enemy.visual.wobble = 0; },
    });

    m.add(EnemyState.ATTACK, {
      enter: () => {
        const burst = p.burst ?? 1;
        const spread = p.spread ?? 0;
        const base = p.aimed === false ? (enemy.facing > 0 ? 0 : Math.PI) : enemy.angleToPlayer();
        for (let i = 0; i < burst; i++) {
          const offset = burst === 1 ? 0 : (i / (burst - 1) - 0.5) * spread;
          enemy.fireProjectile({
            angle: base + offset,
            speed: p.projectileSpeed ?? 130,
            damage: p.projectileDamage ?? enemy.def.damage,
            size: p.projectileSize ?? 3,
            color: enemy.def.visual?.accent,
            gravity: p.projectileGravity ?? 0,
          });
        }
        enemy.attackCooldown = p.cooldown ?? 1.9;
      },
      update: () => {
        if (m.timeInState >= (p.recovery ?? 0.35)) m.change(EnemyState.IDLE);
      },
    });

    m.add(EnemyState.PATROL, { update: () => m.change(EnemyState.IDLE) });
    m.add(EnemyState.CHASE, { update: () => m.change(EnemyState.IDLE) });
  },
});

// ---------------------------------------------------------------------------
// LOBBER — arcing projectiles that deny ground rather than hit directly.
// ---------------------------------------------------------------------------
registerArchetype({
  id: 'lobber',
  description: 'Throws arcing shots at the player\'s position; punishes standing still.',
  build(enemy, m, p) {
    m.add(EnemyState.IDLE, {
      update: (dt) => {
        enemy.body.velocity.x = moveToward(enemy.body.velocity.x, 0, 400 * dt);
        if (enemy.alerted) m.change(EnemyState.PATROL);
      },
    });

    m.add(EnemyState.PATROL, {
      update: (dt) => {
        enemy.walkForward(dt, enemy.speed * 0.7);
        if (enemy.canSeePlayer && enemy.attackCooldown <= 0
          && enemy.distanceToPlayer > (p.minRange ?? 40)) {
          m.change(EnemyState.WINDUP);
        }
      },
    });

    m.add(EnemyState.WINDUP, {
      enter: () => {
        enemy.facePlayer();
        enemy.body.velocity.x = 0;
      },
      update: () => {
        if (m.timeInState >= (p.windup ?? 0.5)) m.change(EnemyState.ATTACK);
      },
    });

    m.add(EnemyState.ATTACK, {
      enter: () => {
        // Solve a ballistic arc to the player's current position. Leading the
        // target would be unfair at this range; landing where they *are*
        // rewards movement, which is the point of the archetype.
        const player = enemy.ctx.player;
        const g = p.projectileGravity ?? 520;
        if (player) {
          const dx = player.body.box.centerX - enemy.body.box.centerX;
          const dy = player.body.box.centerY - enemy.body.box.centerY;
          const t = clamp(Math.abs(dx) / (p.horizontalSpeed ?? 110), 0.35, 2.2);
          const vx = dx / t;
          const vy = (dy - 0.5 * g * t * t) / t;
          enemy.fireProjectile({
            angle: Math.atan2(vy, vx),
            speed: Math.hypot(vx, vy),
            damage: p.projectileDamage ?? enemy.def.damage,
            size: p.projectileSize ?? 4,
            color: enemy.def.visual?.accent,
            gravity: g,
            life: 4,
          });
        }
        enemy.attackCooldown = p.cooldown ?? 2.4;
      },
      update: () => {
        if (m.timeInState >= (p.recovery ?? 0.45)) m.change(EnemyState.PATROL);
      },
    });

    m.add(EnemyState.CHASE, { update: () => m.change(EnemyState.PATROL) });
  },
});

// ---------------------------------------------------------------------------
// JUMPER — hops toward the player in arcs; controls vertical space.
// ---------------------------------------------------------------------------
registerArchetype({
  id: 'jumper',
  description: 'Leaps in arcs. Cannot be safely approached on the ground.',
  build(enemy, m, p) {
    m.add(EnemyState.IDLE, {
      update: (dt) => {
        enemy.body.velocity.x = moveToward(enemy.body.velocity.x, 0, 500 * dt);
        if (m.timeInState > (p.restTime ?? 0.9) && enemy.body.grounded) {
          m.change(enemy.alerted ? EnemyState.WINDUP : EnemyState.PATROL);
        }
      },
    });

    m.add(EnemyState.PATROL, {
      update: () => {
        if (enemy.alerted) m.change(EnemyState.WINDUP);
        else if (m.timeInState > 1.4) m.change(EnemyState.WINDUP);
      },
    });

    m.add(EnemyState.WINDUP, {
      enter: () => {
        if (enemy.alerted) enemy.facePlayer();
        enemy.visual.squash = 0.7;
      },
      update: () => {
        if (m.timeInState >= (p.windup ?? 0.3)) m.change(EnemyState.ATTACK);
      },
    });

    m.add(EnemyState.ATTACK, {
      enter: () => {
        enemy.body.velocity.y = -(p.jumpPower ?? 300);
        enemy.body.velocity.x = enemy.facing * (p.jumpDistance ?? 120);
        enemy.visual.squash = 1.25;
        enemy.bus?.emit(Events.SFX, { id: 'hop' });
      },
      update: () => {
        // Airborne; wait for a landing.
      },
      lateUpdate: () => {
        if (enemy.body.grounded && m.timeInState > 0.1) {
          enemy.visual.squash = 0.75;
          m.change(EnemyState.IDLE);
        }
      },
    });

    m.add(EnemyState.CHASE, { update: () => m.change(EnemyState.WINDUP) });
  },
});

// ---------------------------------------------------------------------------
// BURROWER — hides underground, surfaces to strike.
// ---------------------------------------------------------------------------
registerArchetype({
  id: 'burrower',
  description: 'Submerged until the player is close; invulnerable while buried.',
  build(enemy, m, p) {
    const buriedOffset = p.buriedOffset ?? 14;

    m.add(EnemyState.IDLE, {
      enter: () => {
        // Invulnerable and harmless while buried: the player must wait.
        enemy.hurtbox.enabled = false;
        enemy.blackboard.surfaceY = enemy.body.box.y;
        enemy.body.box.y = enemy.blackboard.surfaceY + buriedOffset;
        enemy.body.isStatic = true;
      },
      update: () => {
        if (enemy.distanceToPlayer < (p.surfaceRange ?? 56)) m.change(EnemyState.WINDUP);
      },
      exit: () => {
        enemy.hurtbox.enabled = true;
        enemy.body.isStatic = false;
      },
    });

    m.add(EnemyState.WINDUP, {
      enter: () => {
        enemy.bus?.emit(Events.SPAWN_PARTICLES, {
          kind: 'burrow',
          x: enemy.body.box.centerX,
          y: enemy.body.box.bottom,
        });
        enemy.bus?.emit(Events.SFX, { id: 'burrow' });
      },
      update: (dt) => {
        // Rise out of the ground.
        const target = enemy.blackboard.surfaceY;
        enemy.body.box.y = moveToward(enemy.body.box.y, target, 90 * dt);
        if (Math.abs(enemy.body.box.y - target) < 0.5) m.change(EnemyState.ATTACK);
      },
    });

    m.add(EnemyState.ATTACK, {
      enter: () => {
        enemy.facePlayer();
        enemy.swing({
          offsetX: enemy.facing * 12,
          offsetY: 0,
          width: 26,
          height: 22,
          frames: 8,
        });
      },
      update: () => {
        if (m.timeInState >= (p.exposeTime ?? 1.5)) m.change(EnemyState.RETREAT);
      },
    });

    m.add(EnemyState.RETREAT, {
      update: (dt) => {
        enemy.body.box.y = moveToward(enemy.body.box.y, enemy.blackboard.surfaceY + buriedOffset, 70 * dt);
        if (m.timeInState > 0.9) m.change(EnemyState.IDLE);
      },
    });

    m.add(EnemyState.PATROL, { update: () => m.change(EnemyState.IDLE) });
    m.add(EnemyState.CHASE, { update: () => m.change(EnemyState.IDLE) });
  },
});

// ---------------------------------------------------------------------------
// SHIELDED — armoured on one side; must be flanked or broken.
// ---------------------------------------------------------------------------
registerArchetype({
  id: 'shielded',
  description: 'Deflects attacks from the front. Attack the back, or break the guard.',
  build(enemy, m, p) {
    // Front-facing deflection is implemented by toggling the main hurtbox's
    // `deflects` flag from the player's relative position each step, rather
    // than by adding a second collider for the shield. A second collider would
    // have to be kept in sync with the body's position, facing and animation
    // every frame, and any desync shows up as hits that pass through a shield
    // that is visibly there. One flag cannot desync.
    m.add(EnemyState.IDLE, {
      update: (dt) => {
        enemy.body.velocity.x = moveToward(enemy.body.velocity.x, 0, 400 * dt);
        if (enemy.alerted) m.change(EnemyState.CHASE);
      },
    });

    m.add(EnemyState.PATROL, {
      update: (dt) => {
        enemy.walkForward(dt, enemy.speed * 0.75);
        if (enemy.alerted) m.change(EnemyState.CHASE);
      },
    });

    m.add(EnemyState.CHASE, {
      update: (dt) => {
        if (!enemy.alerted) {
          m.change(EnemyState.PATROL);
          return;
        }
        enemy.facePlayer();
        enemy.walkForward(dt, enemy.speed, true);

        // Guard up only while facing the player.
        const player = enemy.ctx.player;
        if (player) {
          const playerSide = Math.sign(player.body.box.centerX - enemy.body.box.centerX);
          enemy.hurtbox.deflects = playerSide === enemy.facing && !enemy.blackboard.guardBroken;
        }

        if (enemy.distanceToPlayer < enemy.attackRange && enemy.attackCooldown <= 0) {
          m.change(EnemyState.ATTACK);
        }
      },
      exit: () => {
        enemy.hurtbox.deflects = false;
      },
    });

    m.add(EnemyState.ATTACK, {
      enter: () => {
        // The guard drops during the enemy's own attack: the reliable window.
        enemy.hurtbox.deflects = false;
        enemy.body.velocity.x = 0;
        enemy.attackCooldown = p.cooldown ?? 1.8;
      },
      update: () => {
        if (m.timeInState === 0) return;
        if (!enemy.blackboard.swung && m.timeInState >= (p.windup ?? 0.4)) {
          enemy.blackboard.swung = true;
          enemy.swing({ offsetX: enemy.facing * 16, offsetY: 0, width: 28, height: 24 });
        }
        if (m.timeInState >= (p.windup ?? 0.4) + (p.recovery ?? 0.6)) {
          enemy.blackboard.swung = false;
          m.change(EnemyState.CHASE);
        }
      },
    });
  },
});

// ---------------------------------------------------------------------------
// SWARM — weak, fast, numerous. Individually trivial, collectively a problem.
// ---------------------------------------------------------------------------
registerArchetype({
  id: 'swarm',
  description: 'Fast, fragile flyer that orbits before darting in.',
  build(enemy, m, p) {
    m.add(EnemyState.IDLE, {
      enter: () => {
        enemy.blackboard.orbit = (enemy.ctx.rng?.next() ?? Math.random()) * Math.PI * 2;
      },
      update: (dt) => {
        enemy.blackboard.orbit += dt * (p.orbitSpeed ?? 2.4);
        const r = p.orbitRadius ?? 20;
        enemy.flyToward(
          enemy.homeX + Math.cos(enemy.blackboard.orbit) * r,
          enemy.homeY + Math.sin(enemy.blackboard.orbit) * r * 0.6,
          dt,
          enemy.speed * 0.6,
        );
        if (enemy.alerted) m.change(EnemyState.CHASE);
      },
    });

    m.add(EnemyState.CHASE, {
      update: (dt) => {
        const player = enemy.ctx.player;
        if (!player || !enemy.alerted) {
          m.change(EnemyState.IDLE);
          return;
        }
        enemy.blackboard.orbit += dt * (p.orbitSpeed ?? 3.4);
        // Orbit the player rather than beelining, so a cluster spreads out
        // instead of stacking into one unreadable blob.
        const r = p.chaseOrbit ?? 26;
        enemy.flyToward(
          player.body.box.centerX + Math.cos(enemy.blackboard.orbit) * r,
          player.body.box.centerY + Math.sin(enemy.blackboard.orbit) * r,
          dt,
          enemy.speed,
          420,
        );
      },
    });

    m.add(EnemyState.PATROL, { update: () => m.change(EnemyState.IDLE) });
  },
});

// ---------------------------------------------------------------------------
// AMBUSHER — clings to a ceiling and drops when the player passes beneath.
// ---------------------------------------------------------------------------
registerArchetype({
  id: 'ambusher',
  description: 'Waits on the ceiling, drops on whatever walks underneath.',
  build(enemy, m, p) {
    m.add(EnemyState.IDLE, {
      enter: () => {
        enemy.body.gravityScale = 0;
        enemy.body.velocity.set(0, 0);
      },
      update: () => {
        const player = enemy.ctx.player;
        if (!player) return;
        const dx = Math.abs(player.body.box.centerX - enemy.body.box.centerX);
        const below = player.body.box.centerY > enemy.body.box.centerY;
        if (dx < (p.triggerWidth ?? 22) && below
          && player.body.box.centerY - enemy.body.box.centerY < (p.triggerDepth ?? 120)) {
          m.change(EnemyState.WINDUP);
        }
      },
    });

    m.add(EnemyState.WINDUP, {
      update: () => {
        enemy.visual.wobble = Math.sin(m.timeInState * 44) * 0.7;
        if (m.timeInState >= (p.windup ?? 0.28)) m.change(EnemyState.ATTACK);
      },
      exit: () => { enemy.visual.wobble = 0; },
    });

    m.add(EnemyState.ATTACK, {
      enter: () => {
        enemy.body.gravityScale = p.dropGravity ?? 1.5;
        enemy.bus?.emit(Events.SFX, { id: 'drop' });
      },
      lateUpdate: () => {
        if (enemy.body.grounded) {
          enemy.visual.squash = 0.6;
          enemy.bus?.emit(Events.SCREEN_SHAKE, { amount: 0.1 });
          m.change(p.walksAfterLanding === false ? EnemyState.RECOVER : EnemyState.CHASE);
        }
      },
    });

    m.add(EnemyState.CHASE, {
      enter: () => { enemy.body.gravityScale = 1; },
      update: (dt) => {
        enemy.facePlayer();
        enemy.walkForward(dt, enemy.speed);
      },
    });

    m.add(EnemyState.RECOVER, {
      enter: () => { enemy.body.gravityScale = 1; },
      update: (dt) => {
        enemy.body.velocity.x = moveToward(enemy.body.velocity.x, 0, 300 * dt);
      },
    });

    m.add(EnemyState.PATROL, { update: () => m.change(EnemyState.IDLE) });
  },
});

// ---------------------------------------------------------------------------
// SPINNER — patrols with a permanently active whirling attack.
// ---------------------------------------------------------------------------
registerArchetype({
  id: 'spinner',
  description: 'Constantly spinning; no safe frontal approach, only timing.',
  build(enemy, m, p) {
    m.add(EnemyState.IDLE, { update: () => m.change(EnemyState.PATROL) });

    m.add(EnemyState.PATROL, {
      update: (dt) => {
        enemy.walkForward(dt, enemy.alerted ? enemy.speed * 1.5 : enemy.speed);
        enemy.visual.wobble = enemy.visual.phase * (p.spinRate ?? 9);
        // Periodically stall, which is the only window to attack safely.
        if (m.timeInState > (p.spinTime ?? 2.6)) m.change(EnemyState.RECOVER);
      },
    });

    m.add(EnemyState.RECOVER, {
      enter: () => {
        // Vulnerable: the spin stops and the hurtbox is exposed.
        enemy.blackboard.exposed = true;
      },
      update: (dt) => {
        enemy.body.velocity.x = moveToward(enemy.body.velocity.x, 0, 500 * dt);
        if (m.timeInState > (p.restTime ?? 1.1)) m.change(EnemyState.PATROL);
      },
      exit: () => {
        enemy.blackboard.exposed = false;
      },
    });

    m.add(EnemyState.CHASE, { update: () => m.change(EnemyState.PATROL) });
  },
});

// ---------------------------------------------------------------------------
// TETHER — anchored to a point, swings on a line. Kill the anchor.
// ---------------------------------------------------------------------------
registerArchetype({
  id: 'tether',
  description: 'Swings from a fixed anchor on a fixed radius.',
  build(enemy, m, p) {
    m.add(EnemyState.IDLE, {
      enter: () => {
        enemy.body.gravityScale = 0;
        enemy.blackboard.angle = p.startAngle ?? Math.PI / 2;
        enemy.blackboard.angularVel = p.angularSpeed ?? 1.5;
      },
      update: (dt) => {
        const bb = enemy.blackboard;
        // A pendulum: angular acceleration proportional to sin of the angle.
        const radius = p.radius ?? 46;
        bb.angularVel += -Math.sin(bb.angle - Math.PI / 2) * (p.gravity ?? 5) * dt;
        bb.angularVel *= 0.999;
        bb.angle += bb.angularVel * dt;
        const tx = enemy.homeX + Math.cos(bb.angle) * radius;
        const ty = enemy.homeY + Math.sin(bb.angle) * radius;
        enemy.body.box.centerX = tx;
        enemy.body.box.centerY = ty;
        enemy.body.velocity.set(0, 0);
      },
    });

    m.add(EnemyState.PATROL, { update: () => m.change(EnemyState.IDLE) });
    m.add(EnemyState.CHASE, { update: () => m.change(EnemyState.IDLE) });
  },
});

// ---------------------------------------------------------------------------
// MIRROR — mimics the player's aggression; punishes mashing.
// ---------------------------------------------------------------------------
registerArchetype({
  id: 'mirror',
  description: 'Attacks in response to the player attacking. Reward patience.',
  build(enemy, m, p) {
    m.add(EnemyState.IDLE, {
      update: (dt) => {
        enemy.body.velocity.x = moveToward(enemy.body.velocity.x, 0, 400 * dt);
        if (enemy.alerted) m.change(EnemyState.CHASE);
      },
    });

    m.add(EnemyState.CHASE, {
      update: (dt) => {
        const player = enemy.ctx.player;
        if (!player) return;
        enemy.facePlayer();
        // Hold a standoff distance rather than closing: it is *reacting*, not
        // pressuring.
        const desired = p.standoff ?? 44;
        const delta = enemy.distanceToPlayer - desired;
        enemy.body.velocity.x = moveToward(
          enemy.body.velocity.x,
          Math.sign(delta) * enemy.facing * enemy.speed * clamp(Math.abs(delta) / 30, 0, 1),
          500 * dt,
        );

        // Counterattack when the player commits to a swing nearby.
        const playerAttacking = player.machine.is('attack');
        if (playerAttacking && enemy.distanceToPlayer < (p.counterRange ?? 60)
          && enemy.attackCooldown <= 0) {
          m.change(EnemyState.ATTACK);
        }
      },
    });

    m.add(EnemyState.ATTACK, {
      enter: () => {
        enemy.attackCooldown = p.cooldown ?? 1.1;
        enemy.facePlayer();
      },
      update: (dt) => {
        enemy.body.velocity.x = moveToward(enemy.body.velocity.x, enemy.facing * 180, 900 * dt);
        if (!enemy.blackboard.swung && m.timeInState >= (p.windup ?? 0.18)) {
          enemy.blackboard.swung = true;
          enemy.swing({ offsetX: enemy.facing * 16, offsetY: 0, width: 30, height: 22, knockback: 190 });
        }
        if (m.timeInState >= (p.windup ?? 0.18) + (p.recovery ?? 0.45)) {
          enemy.blackboard.swung = false;
          m.change(EnemyState.CHASE);
        }
      },
    });

    m.add(EnemyState.PATROL, { update: () => m.change(EnemyState.IDLE) });
  },
});

// ---------------------------------------------------------------------------
// SPLITTER — divides into smaller copies when killed.
// ---------------------------------------------------------------------------
registerArchetype({
  id: 'splitter',
  description: 'Splits into smaller versions on death; commit or be overrun.',
  build(enemy, m, p) {
    // Split behaviour is handled in the definition's onDeath hook so it can
    // name the child enemy type; the archetype only supplies the movement.
    m.add(EnemyState.IDLE, {
      update: (dt) => {
        enemy.body.velocity.x = moveToward(enemy.body.velocity.x, 0, 300 * dt);
        if (m.timeInState > 0.5) m.change(EnemyState.PATROL);
      },
    });

    m.add(EnemyState.PATROL, {
      update: (dt) => {
        enemy.walkForward(dt, enemy.speed, p.respectLedges !== false);
        if (enemy.alerted) m.change(EnemyState.CHASE);
      },
    });

    m.add(EnemyState.CHASE, {
      update: (dt) => {
        if (!enemy.alerted) {
          m.change(EnemyState.PATROL);
          return;
        }
        enemy.facePlayer();
        enemy.walkForward(dt, enemy.speed * 1.5, p.respectLedges !== false);
        // A little hop keeps them from clumping into a single line.
        if (enemy.body.grounded && m.timeInState % 1.2 < 0.02) {
          enemy.body.velocity.y = -180;
        }
      },
    });
  },
});

// ---------------------------------------------------------------------------
// DRIFTER — passive hazard that follows a fixed path; environmental, not hostile.
// ---------------------------------------------------------------------------
registerArchetype({
  id: 'drifter',
  description: 'Follows a fixed path regardless of the player. A moving hazard.',
  build(enemy, m, p) {
    m.add(EnemyState.IDLE, {
      enter: () => {
        enemy.body.gravityScale = 0;
        enemy.blackboard.t = 0;
      },
      update: (dt) => {
        const bb = enemy.blackboard;
        bb.t += dt * (p.speed ?? 0.6);
        const ax = p.amplitudeX ?? 60;
        const ay = p.amplitudeY ?? 0;
        // Lissajous path: a compact way to express a variety of loops from data.
        const nx = p.freqX ?? 1;
        const ny = p.freqY ?? 2;
        enemy.body.box.centerX = enemy.homeX + Math.sin(bb.t * nx) * ax;
        enemy.body.box.centerY = enemy.homeY + Math.sin(bb.t * ny + (p.phase ?? 0)) * ay;
        enemy.body.velocity.set(0, 0);
      },
    });

    m.add(EnemyState.PATROL, { update: () => m.change(EnemyState.IDLE) });
    m.add(EnemyState.CHASE, { update: () => m.change(EnemyState.IDLE) });
  },
});

// ---------------------------------------------------------------------------
// STALKER — keeps its distance until the player turns away, then closes.
// ---------------------------------------------------------------------------
registerArchetype({
  id: 'stalker',
  description: 'Advances only when not being looked at. Rewards vigilance.',
  build(enemy, m, p) {
    m.add(EnemyState.IDLE, {
      update: (dt) => {
        enemy.body.velocity.x = moveToward(enemy.body.velocity.x, 0, 500 * dt);
        if (enemy.alerted) m.change(EnemyState.CHASE);
      },
    });

    m.add(EnemyState.CHASE, {
      update: (dt) => {
        const player = enemy.ctx.player;
        if (!player) return;
        enemy.facePlayer();
        // Is the player facing this enemy?
        const toEnemy = Math.sign(enemy.body.box.centerX - player.body.box.centerX);
        const watched = player.facing === toEnemy;
        if (watched) {
          enemy.body.velocity.x = moveToward(enemy.body.velocity.x, 0, 900 * dt);
          enemy.visual.wobble = 0;
        } else {
          enemy.walkForward(dt, enemy.speed * (p.stalkSpeed ?? 2.2));
          enemy.visual.wobble = Math.sin(enemy.visual.phase * 12) * 0.3;
        }
        if (enemy.distanceToPlayer < enemy.attackRange && enemy.attackCooldown <= 0) {
          m.change(EnemyState.ATTACK);
        }
      },
    });

    m.add(EnemyState.ATTACK, {
      enter: () => {
        enemy.attackCooldown = p.cooldown ?? 1.5;
        enemy.swing({ offsetX: enemy.facing * 14, offsetY: 0, width: 26, height: 24 });
      },
      update: () => {
        if (m.timeInState > (p.recovery ?? 0.5)) m.change(EnemyState.CHASE);
      },
    });

    m.add(EnemyState.PATROL, { update: () => m.change(EnemyState.IDLE) });
  },
});

/** Names of every registered archetype, for validation and the bestiary. */
export const ARCHETYPE_IDS = [
  'walker', 'charger', 'flyer', 'turret', 'lobber', 'jumper', 'burrower',
  'shielded', 'swarm', 'ambusher', 'spinner', 'tether', 'mirror', 'splitter',
  'drifter', 'stalker',
];
