/**
 * @file Reusable boss attack patterns.
 *
 * Patterns are produced by **factories** rather than written out per boss, for
 * the same reason enemies use archetypes: twenty-five bosses each with five
 * hand-written patterns would be 125 near-duplicate implementations of "wind up,
 * hit a box, recover".
 *
 * What makes each boss distinct is the *combination* — which patterns, at which
 * ranges, with which timings, in which phase order. That is genuinely
 * expressive: a boss with a slow slam and a fast dash plays nothing like one
 * with a fast slam and a slow dash, even from the same two factories.
 *
 * ## The fairness contract
 * Every factory takes a `telegraph` and a `recovery` and passes them straight
 * through, because `defineBoss` validates them at load time. A pattern with no
 * recovery window, or with a wind-up too short to react to, fails the build
 * rather than shipping.
 */

import { Events } from '../../engine/core/events.js';
import { clamp } from '../../engine/math/math-utils.js';

/**
 * A telegraphed ground slam that emits a shockwave along the floor.
 * The archetypal "get away from it" attack.
 * @param {object} [o]
 * @returns {import('../boss/boss.js').BossPattern}
 */
export function slam(o = {}) {
  const width = o.width ?? 76;
  const height = o.height ?? 30;
  return {
    id: o.id ?? 'slam',
    name: o.name ?? 'Slam',
    telegraph: o.telegraph ?? 0.65,
    duration: o.duration ?? 0.3,
    recovery: o.recovery ?? 0.85,
    weight: o.weight ?? 1,
    maxRange: o.maxRange ?? 92,
    cooldown: o.cooldown ?? 1.5,
    requiresGround: true,
    onTelegraph: (boss) => {
      boss.body.velocity.y = -(o.hop ?? 150);
      boss.bus?.emit(Events.SFX, { id: 'bossWindupHeavy' });
    },
    onStart: (boss) => {
      boss.body.velocity.y = o.slamSpeed ?? 700;
      boss.strikeAt({
        x: boss.body.box.centerX,
        y: boss.body.box.bottom,
        width,
        height,
        damage: o.damage,
        trauma: 0.4,
        hitstop: 6,
        knockback: 260,
      });
      boss.bus?.emit(Events.SCREEN_SHAKE, { amount: 0.5 });
      boss.bus?.emit(Events.SFX, { id: 'bossSlam' });
      boss.bus?.emit(Events.SPAWN_PARTICLES, {
        kind: 'slam', x: boss.body.box.centerX, y: boss.body.box.bottom,
      });
      // Shockwaves travel outward, so distance alone is not safety — the
      // player must jump, which is a different verb from "back away".
      if (o.shockwave !== false) {
        for (const dir of [-1, 1]) {
          boss.bus?.queue('projectile:spawn', {
            owner: boss,
            team: 'enemy',
            x: boss.body.box.centerX + dir * 20,
            y: boss.body.box.bottom - 6,
            vx: dir * (o.waveSpeed ?? 190),
            vy: 0,
            damage: o.waveDamage ?? 1,
            size: 6,
            life: 2.2,
            color: o.color ?? '#ffd070',
            gravity: 0,
            grounded: true,
          });
        }
      }
    },
  };
}

/**
 * A long horizontal dash across the arena.
 * @param {object} [o]
 * @returns {import('../boss/boss.js').BossPattern}
 */
export function dashAcross(o = {}) {
  const speed = o.speed ?? 340;
  return {
    id: o.id ?? 'dash',
    name: o.name ?? 'Dash',
    telegraph: o.telegraph ?? 0.5,
    duration: o.duration ?? 0.7,
    recovery: o.recovery ?? 0.8,
    weight: o.weight ?? 1,
    minRange: o.minRange ?? 40,
    cooldown: o.cooldown ?? 1.4,
    onTelegraph: (boss) => {
      boss.facePlayer();
      boss.blackboard.dashDir = boss.facing;
      boss.body.velocity.x = -boss.facing * 40;
      boss.bus?.emit(Events.SFX, { id: 'bossWindup' });
    },
    onStart: (boss) => {
      boss.bus?.emit(Events.SFX, { id: 'bossDash' });
    },
    onActive: (boss) => {
      boss.body.velocity.x = boss.blackboard.dashDir * speed;
      boss.bus?.emit(Events.SPAWN_PARTICLES, {
        kind: 'bossTrail', x: boss.body.box.centerX, y: boss.body.box.centerY,
        color: o.color,
      });
    },
    onEnd: (boss) => {
      boss.body.velocity.x *= 0.2;
    },
  };
}

/**
 * A radial burst of projectiles. The classic "find the gap" attack.
 * @param {object} [o]
 * @returns {import('../boss/boss.js').BossPattern}
 */
export function ringBurst(o = {}) {
  const rings = o.rings ?? 1;
  const count = o.count ?? 10;
  return {
    id: o.id ?? 'ring',
    name: o.name ?? 'Ring Burst',
    telegraph: o.telegraph ?? 0.7,
    duration: o.duration ?? Math.max(0.2, rings * (o.interval ?? 0.28)),
    recovery: o.recovery ?? 0.9,
    weight: o.weight ?? 1,
    cooldown: o.cooldown ?? 2.4,
    onTelegraph: (boss) => {
      boss.body.velocity.x = 0;
      boss.bus?.emit(Events.SFX, { id: 'bossCharge' });
    },
    onStart: (boss) => {
      boss.blackboard.ringsFired = 0;
      boss.blackboard.ringTimer = 0;
    },
    onActive: (boss, dt) => {
      const bb = boss.blackboard;
      bb.ringTimer -= dt;
      if (bb.ringTimer > 0 || bb.ringsFired >= rings) return;
      bb.ringTimer = o.interval ?? 0.28;
      // Rotate each successive ring so the safe gaps move, forcing the player
      // to keep repositioning rather than parking in one hole.
      const offset = bb.ringsFired * (o.rotation ?? Math.PI / count);
      boss.fireRing({
        count,
        speed: o.speed ?? 140,
        startAngle: offset + (o.aimed ? boss.angleToPlayer() : 0),
        arc: o.arc,
        damage: o.damage,
        size: o.size ?? 4,
        color: o.color,
      });
      bb.ringsFired++;
      boss.bus?.emit(Events.SFX, { id: 'bossShoot' });
    },
  };
}

/**
 * A tracking volley fired in a tight spread at the player.
 * @param {object} [o]
 * @returns {import('../boss/boss.js').BossPattern}
 */
export function aimedVolley(o = {}) {
  const shots = o.shots ?? 3;
  return {
    id: o.id ?? 'volley',
    name: o.name ?? 'Volley',
    telegraph: o.telegraph ?? 0.55,
    duration: o.duration ?? shots * (o.interval ?? 0.16),
    recovery: o.recovery ?? 0.7,
    weight: o.weight ?? 1,
    minRange: o.minRange ?? 50,
    cooldown: o.cooldown ?? 1.8,
    onTelegraph: (boss) => {
      boss.facePlayer();
      boss.bus?.emit(Events.SFX, { id: 'bossAim' });
    },
    onStart: (boss) => {
      boss.blackboard.shotsFired = 0;
      boss.blackboard.shotTimer = 0;
    },
    onActive: (boss, dt) => {
      const bb = boss.blackboard;
      bb.shotTimer -= dt;
      if (bb.shotTimer > 0 || bb.shotsFired >= shots) return;
      bb.shotTimer = o.interval ?? 0.16;
      // Re-aim per shot so standing still is punished, but the spread means a
      // moving player is never tracked perfectly.
      const spread = (o.spread ?? 0.14) * (bb.shotsFired - (shots - 1) / 2);
      boss.fireProjectile({
        angle: boss.angleToPlayer() + spread,
        speed: o.speed ?? 210,
        damage: o.damage ?? boss.bossDef.damage,
        size: o.size ?? 4,
        color: o.color,
        gravity: o.gravity ?? 0,
      });
      bb.shotsFired++;
    },
  };
}

/**
 * Projectiles rain from above across the arena width.
 * @param {object} [o]
 * @returns {import('../boss/boss.js').BossPattern}
 */
export function skyfall(o = {}) {
  return {
    id: o.id ?? 'skyfall',
    name: o.name ?? 'Skyfall',
    telegraph: o.telegraph ?? 0.8,
    duration: o.duration ?? 1.8,
    recovery: o.recovery ?? 1,
    weight: o.weight ?? 1,
    cooldown: o.cooldown ?? 4,
    onTelegraph: (boss) => {
      boss.body.velocity.x = 0;
      boss.bus?.emit(Events.SFX, { id: 'bossSkyfall' });
      boss.bus?.emit(Events.SCREEN_SHAKE, { amount: 0.2 });
    },
    onStart: (boss) => {
      boss.blackboard.fallTimer = 0;
    },
    onActive: (boss, dt) => {
      const bb = boss.blackboard;
      bb.fallTimer -= dt;
      if (bb.fallTimer > 0) return;
      bb.fallTimer = o.interval ?? 0.16;
      const room = boss.ctx.room;
      const spanLeft = room ? room.bounds.x + 16 : boss.body.box.centerX - 140;
      const spanRight = room ? room.bounds.right - 16 : boss.body.box.centerX + 140;
      const rng = boss.ctx.rng;
      const x = rng ? rng.range(spanLeft, spanRight) : (spanLeft + spanRight) / 2;
      boss.bus?.queue('projectile:spawn', {
        owner: boss,
        team: 'enemy',
        x,
        y: (room ? room.bounds.y : boss.body.box.y - 160) + 8,
        vx: 0,
        vy: o.fallSpeed ?? 210,
        damage: o.damage ?? 1,
        size: o.size ?? 4,
        life: 4,
        color: o.color,
        gravity: o.gravity ?? 180,
      });
    },
  };
}

/**
 * Spawn minions. Used sparingly — adds change a fight from a duel into a
 * management problem, which is interesting once and tedious four times.
 * @param {object} [o]
 * @returns {import('../boss/boss.js').BossPattern}
 */
export function summon(o = {}) {
  return {
    id: o.id ?? 'summon',
    name: o.name ?? 'Summon',
    telegraph: o.telegraph ?? 0.9,
    duration: o.duration ?? 0.4,
    recovery: o.recovery ?? 1.2,
    weight: o.weight ?? 0.6,
    cooldown: o.cooldown ?? 8,
    onTelegraph: (boss) => {
      boss.body.velocity.x = 0;
      boss.bus?.emit(Events.SFX, { id: 'bossSummon' });
    },
    onStart: (boss) => {
      boss.bus?.queue('enemy:spawnRequest', {
        id: o.enemy ?? 'pagemite',
        count: o.count ?? 3,
        x: boss.body.box.centerX,
        y: boss.body.box.centerY - 20,
        scatter: o.scatter ?? 70,
      });
      boss.bus?.emit(Events.SPAWN_PARTICLES, {
        kind: 'summon', x: boss.body.box.centerX, y: boss.body.box.centerY,
      });
    },
  };
}

/**
 * A leap toward the player's position, landing with an impact.
 * @param {object} [o]
 * @returns {import('../boss/boss.js').BossPattern}
 */
export function leapSmash(o = {}) {
  return {
    id: o.id ?? 'leap',
    name: o.name ?? 'Leap',
    telegraph: o.telegraph ?? 0.55,
    duration: o.duration ?? 0.95,
    recovery: o.recovery ?? 0.85,
    weight: o.weight ?? 1,
    minRange: o.minRange ?? 45,
    cooldown: o.cooldown ?? 2.2,
    requiresGround: true,
    onTelegraph: (boss) => {
      boss.facePlayer();
      boss.visual.squash = 0.7;
      boss.bus?.emit(Events.SFX, { id: 'bossWindup' });
    },
    onStart: (boss) => {
      const player = boss.ctx.player;
      const dx = player ? player.body.box.centerX - boss.body.box.centerX : boss.facing * 100;
      // Solve for the horizontal velocity that lands on the player's position
      // after the flight time, so the leap is readable as "it is going there".
      const flight = o.flightTime ?? 0.62;
      boss.body.velocity.x = clamp(dx / flight, -400, 400);
      boss.body.velocity.y = -(o.jumpPower ?? 470);
      boss.visual.squash = 1.25;
      boss.bus?.emit(Events.SFX, { id: 'bossLeap' });
      boss.blackboard.landed = false;
    },
    onActive: (boss) => {
      if (!boss.blackboard.landed && boss.body.grounded && boss.body.velocity.y >= 0) {
        boss.blackboard.landed = true;
        boss.strikeAt({
          x: boss.body.box.centerX,
          y: boss.body.box.bottom,
          width: o.impactWidth ?? 66,
          height: 26,
          damage: o.damage,
          trauma: 0.4,
          knockback: 240,
        });
        boss.bus?.emit(Events.SCREEN_SHAKE, { amount: 0.45 });
        boss.bus?.emit(Events.SPAWN_PARTICLES, {
          kind: 'slam', x: boss.body.box.centerX, y: boss.body.box.bottom,
        });
      }
    },
  };
}

/**
 * A sweeping melee arc with a long, readable wind-up.
 * @param {object} [o]
 * @returns {import('../boss/boss.js').BossPattern}
 */
export function sweep(o = {}) {
  return {
    id: o.id ?? 'sweep',
    name: o.name ?? 'Sweep',
    telegraph: o.telegraph ?? 0.5,
    duration: o.duration ?? 0.35,
    recovery: o.recovery ?? 0.7,
    weight: o.weight ?? 1.2,
    maxRange: o.maxRange ?? 80,
    cooldown: o.cooldown ?? 1.1,
    onTelegraph: (boss) => {
      boss.facePlayer();
      boss.body.velocity.x = 0;
      boss.bus?.emit(Events.SFX, { id: 'bossWindup' });
    },
    onStart: (boss) => {
      boss.strikeAt({
        x: boss.body.box.centerX + boss.facing * (o.reach ?? 34),
        y: boss.body.box.centerY,
        width: o.width ?? 58,
        height: o.height ?? 34,
        damage: o.damage,
        knockback: 210,
        hitstop: 5,
      });
      boss.bus?.emit(Events.SFX, { id: 'bossSweep' });
    },
  };
}

/**
 * A stationary spinning attack that must simply be waited out.
 * @param {object} [o]
 * @returns {import('../boss/boss.js').BossPattern}
 */
export function whirl(o = {}) {
  return {
    id: o.id ?? 'whirl',
    name: o.name ?? 'Whirl',
    telegraph: o.telegraph ?? 0.6,
    duration: o.duration ?? 1.4,
    recovery: o.recovery ?? 1.1,
    weight: o.weight ?? 0.9,
    cooldown: o.cooldown ?? 3.2,
    onTelegraph: (boss) => {
      boss.bus?.emit(Events.SFX, { id: 'bossWindup' });
    },
    onActive: (boss, dt, t) => {
      boss.visual.wobble = t * 40;
      // Drift toward the player so the attack cannot simply be outrun on foot.
      const player = boss.ctx.player;
      if (player) {
        const dir = Math.sign(player.body.box.centerX - boss.body.box.centerX);
        boss.body.velocity.x = dir * (o.driftSpeed ?? 90);
      }
      boss.strikeAt({
        x: boss.body.box.centerX,
        y: boss.body.box.centerY,
        width: (o.radius ?? 40) * 2,
        height: (o.radius ?? 40) * 1.6,
        damage: o.damage,
        frames: 2,
        knockback: 190,
        trauma: 0.05,
      });
    },
    onEnd: (boss) => {
      boss.visual.wobble = 0;
      boss.body.velocity.x = 0;
    },
  };
}

/**
 * Teleport near the player, then strike. Reserved for late-game bosses,
 * because it removes the option of retreating.
 * @param {object} [o]
 * @returns {import('../boss/boss.js').BossPattern}
 */
export function blinkStrike(o = {}) {
  return {
    id: o.id ?? 'blink',
    name: o.name ?? 'Blink Strike',
    telegraph: o.telegraph ?? 0.45,
    duration: o.duration ?? 0.5,
    recovery: o.recovery ?? 0.9,
    weight: o.weight ?? 1,
    cooldown: o.cooldown ?? 3,
    onTelegraph: (boss) => {
      boss.bus?.emit(Events.SPAWN_PARTICLES, {
        kind: 'blinkOut', x: boss.body.box.centerX, y: boss.body.box.centerY,
      });
      boss.bus?.emit(Events.SFX, { id: 'bossBlink' });
    },
    onStart: (boss) => {
      const player = boss.ctx.player;
      if (player) {
        // Appear on the side the player is *facing away from* — punishing, but
        // the appearance itself is telegraphed and the strike still winds up.
        const side = -player.facing;
        boss.body.teleport(
          player.body.box.centerX + side * (o.offset ?? 46) - boss.body.box.w / 2,
          player.body.box.bottom - boss.body.box.h,
        );
        boss.facePlayer();
      }
      boss.bus?.emit(Events.SPAWN_PARTICLES, {
        kind: 'blinkIn', x: boss.body.box.centerX, y: boss.body.box.centerY,
      });
    },
    onActive: (boss, dt, t) => {
      if (t > 0.5 && !boss.blackboard.blinkHit) {
        boss.blackboard.blinkHit = true;
        boss.strikeAt({
          x: boss.body.box.centerX + boss.facing * 26,
          y: boss.body.box.centerY,
          width: 46,
          height: 32,
          damage: o.damage,
          knockback: 230,
        });
      }
    },
    onEnd: (boss) => {
      boss.blackboard.blinkHit = false;
    },
  };
}

/**
 * A wide horizontal beam that must be jumped or ducked under.
 * @param {object} [o]
 * @returns {import('../boss/boss.js').BossPattern}
 */
export function beam(o = {}) {
  return {
    id: o.id ?? 'beam',
    name: o.name ?? 'Beam',
    telegraph: o.telegraph ?? 0.85,
    duration: o.duration ?? 0.9,
    recovery: o.recovery ?? 1,
    weight: o.weight ?? 0.9,
    cooldown: o.cooldown ?? 3.6,
    onTelegraph: (boss) => {
      boss.facePlayer();
      boss.body.velocity.x = 0;
      // Lock the height at wind-up so the player can commit to jumping.
      const player = boss.ctx.player;
      boss.blackboard.beamY = player ? player.body.box.centerY : boss.body.box.centerY;
      boss.bus?.emit(Events.SFX, { id: 'bossBeamCharge' });
    },
    onStart: (boss) => {
      boss.bus?.emit(Events.SFX, { id: 'bossBeam' });
      boss.bus?.emit(Events.SCREEN_SHAKE, { amount: 0.3 });
    },
    onActive: (boss) => {
      const y = boss.blackboard.beamY;
      const len = o.length ?? 240;
      boss.strikeAt({
        x: boss.body.box.centerX + boss.facing * (len / 2),
        y,
        width: len,
        height: o.thickness ?? 14,
        damage: o.damage,
        frames: 2,
        knockback: 180,
      });
    },
  };
}

/**
 * Spikes erupt from the floor at the player's position after a delay.
 * @param {object} [o]
 * @returns {import('../boss/boss.js').BossPattern}
 */
export function groundSpikes(o = {}) {
  return {
    id: o.id ?? 'spikes',
    name: o.name ?? 'Eruption',
    telegraph: o.telegraph ?? 0.7,
    duration: o.duration ?? 1.1,
    recovery: o.recovery ?? 0.9,
    weight: o.weight ?? 1,
    cooldown: o.cooldown ?? 3,
    onTelegraph: (boss) => {
      boss.body.velocity.x = 0;
      boss.bus?.emit(Events.SFX, { id: 'bossRumble' });
    },
    onStart: (boss) => {
      boss.blackboard.spikeTimer = 0;
      boss.blackboard.spikeCount = 0;
      boss.blackboard.spikeX = boss.body.box.centerX;
      boss.blackboard.spikeDir = boss.ctx.player
        ? Math.sign(boss.ctx.player.body.box.centerX - boss.body.box.centerX) || 1
        : 1;
    },
    onActive: (boss, dt) => {
      const bb = boss.blackboard;
      bb.spikeTimer -= dt;
      if (bb.spikeTimer > 0 || bb.spikeCount >= (o.count ?? 6)) return;
      bb.spikeTimer = o.interval ?? 0.13;
      bb.spikeX += bb.spikeDir * (o.spacing ?? 30);
      bb.spikeCount++;
      // The advancing line is the readable part: the player can see where the
      // next one lands and outrun or jump it.
      boss.strikeAt({
        x: bb.spikeX,
        y: boss.body.box.bottom - 12,
        width: 18,
        height: 30,
        damage: o.damage,
        frames: 10,
        knockback: 180,
      });
      boss.bus?.emit(Events.SPAWN_PARTICLES, {
        kind: 'spikeErupt', x: bb.spikeX, y: boss.body.box.bottom,
      });
    },
  };
}

/**
 * A brief guarded stance that deflects attacks and counters.
 * @param {object} [o]
 * @returns {import('../boss/boss.js').BossPattern}
 */
export function guardCounter(o = {}) {
  return {
    id: o.id ?? 'guard',
    name: o.name ?? 'Guard',
    telegraph: o.telegraph ?? 0.35,
    duration: o.duration ?? 1,
    recovery: o.recovery ?? 0.75,
    weight: o.weight ?? 0.7,
    cooldown: o.cooldown ?? 5,
    onTelegraph: (boss) => {
      boss.facePlayer();
      boss.bus?.emit(Events.SFX, { id: 'bossGuard' });
    },
    onStart: (boss) => {
      boss.hurtbox.deflects = true;
      boss.blackboard.countered = false;
    },
    onActive: (boss) => {
      boss.body.velocity.x = 0;
    },
    onEnd: (boss) => {
      boss.hurtbox.deflects = false;
      // Always counter on exit, so guarding is a real threat rather than just
      // a wasted turn for the player.
      boss.strikeAt({
        x: boss.body.box.centerX + boss.facing * 30,
        y: boss.body.box.centerY,
        width: 52,
        height: 32,
        damage: o.damage,
        knockback: 280,
        trauma: 0.2,
      });
    },
  };
}

/**
 * A dive from above, for flying bosses.
 * @param {object} [o]
 * @returns {import('../boss/boss.js').BossPattern}
 */
export function dive(o = {}) {
  return {
    id: o.id ?? 'dive',
    name: o.name ?? 'Dive',
    telegraph: o.telegraph ?? 0.5,
    duration: o.duration ?? 0.7,
    recovery: o.recovery ?? 0.9,
    weight: o.weight ?? 1.1,
    cooldown: o.cooldown ?? 1.8,
    onTelegraph: (boss) => {
      boss.facePlayer();
      boss.body.velocity.set(0, -50);
      boss.bus?.emit(Events.SFX, { id: 'bossWindup' });
    },
    onStart: (boss) => {
      const a = boss.angleToPlayer();
      boss.body.velocity.set(Math.cos(a) * (o.speed ?? 330), Math.sin(a) * (o.speed ?? 330));
      boss.bus?.emit(Events.SFX, { id: 'bossDive' });
    },
    onActive: (boss) => {
      boss.bus?.emit(Events.SPAWN_PARTICLES, {
        kind: 'bossTrail', x: boss.body.box.centerX, y: boss.body.box.centerY, color: o.color,
      });
    },
    onEnd: (boss) => {
      boss.body.velocity.scaleInPlace(0.25);
    },
  };
}

/**
 * A spiral of projectiles from a rotating emitter.
 * @param {object} [o]
 * @returns {import('../boss/boss.js').BossPattern}
 */
export function spiral(o = {}) {
  return {
    id: o.id ?? 'spiral',
    name: o.name ?? 'Spiral',
    telegraph: o.telegraph ?? 0.65,
    duration: o.duration ?? 2.2,
    recovery: o.recovery ?? 1,
    weight: o.weight ?? 0.9,
    cooldown: o.cooldown ?? 4,
    onTelegraph: (boss) => {
      boss.body.velocity.x = 0;
      boss.bus?.emit(Events.SFX, { id: 'bossCharge' });
    },
    onStart: (boss) => {
      boss.blackboard.spiralAngle = boss.angleToPlayer();
      boss.blackboard.spiralTimer = 0;
    },
    onActive: (boss, dt) => {
      const bb = boss.blackboard;
      bb.spiralTimer -= dt;
      if (bb.spiralTimer > 0) return;
      bb.spiralTimer = o.interval ?? 0.09;
      bb.spiralAngle += o.step ?? 0.42;
      const arms = o.arms ?? 2;
      for (let i = 0; i < arms; i++) {
        boss.fireProjectile({
          angle: bb.spiralAngle + (i / arms) * Math.PI * 2,
          speed: o.speed ?? 120,
          damage: o.damage ?? 1,
          size: o.size ?? 3,
          color: o.color,
          life: 4,
        });
      }
    },
  };
}

/**
 * Retreat to a wall and become briefly invulnerable while recovering.
 * Used by bosses with a "regroup" beat between phases.
 * @param {object} [o]
 * @returns {import('../boss/boss.js').BossPattern}
 */
export function regroup(o = {}) {
  return {
    id: o.id ?? 'regroup',
    name: o.name ?? 'Regroup',
    telegraph: o.telegraph ?? 0.4,
    duration: o.duration ?? 0.9,
    recovery: o.recovery ?? 0.6,
    weight: o.weight ?? 0.5,
    cooldown: o.cooldown ?? 10,
    onStart: (boss) => {
      boss.facePlayer();
      boss.body.velocity.x = -boss.facing * (o.speed ?? 220);
      boss.bus?.emit(Events.SFX, { id: 'bossRegroup' });
    },
    onActive: (boss, dt) => {
      boss.body.velocity.x *= 0.96;
    },
  };
}
