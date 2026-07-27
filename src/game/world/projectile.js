/**
 * @file Projectiles.
 *
 * ## Why projectiles are not physics bodies
 * A projectile does not need slope handling, one-way platforms, ground snapping
 * or crush detection — it needs "did I hit a wall, and did I hit something
 * alive". Running them through the full `Body` pipeline would cost roughly ten
 * times as much per instance for behaviour that is actively wrong (a bullet
 * should not stand on a ledge).
 *
 * They are therefore a flat pooled array with a point-vs-tile check and a
 * hitbox spawned each step. During a late-game boss phase there can be 150 of
 * them on screen, and this is what keeps that affordable.
 */

import { Pool } from '../../engine/core/pool.js';
import { Team } from '../combat/hitbox.js';
import { isSolid, TILE_SIZE } from '../../engine/physics/tiles.js';
import { Events } from '../../engine/core/events.js';

export class Projectile {
  constructor() {
    this.reset();
  }

  reset() {
    this.x = 0;
    this.y = 0;
    this.vx = 0;
    this.vy = 0;
    this.gravity = 0;
    this.damage = 1;
    this.size = 3;
    this.life = 3;
    this.maxLife = 3;
    this.color = '#ffffff';
    this.team = Team.ENEMY;
    /** @type {any} */
    this.owner = null;
    this.alive = false;
    this.homing = false;
    this.homingStrength = 2.2;
    /** Travels along the floor instead of through the air (shockwaves). */
    this.grounded = false;
    /** Bounces off terrain instead of expiring. */
    this.bounces = 0;
    /** Rotation for the painter. */
    this.rotation = 0;
    this.spin = 0;
    /** Trail positions for the painter. @type {number[]} */
    this.trail = [];
    return this;
  }

  /** Release any retained references. Projectiles hold none, so this is a no-op
   *  that exists so the world can tear down every entity uniformly. */
  dispose() {
    this.owner = null;
    this.trail.length = 0;
  }
}

/**
 * Manages the projectile pool, integration, collision and rendering.
 */
export class ProjectileSystem {
  /**
   * @param {Partial<import('../context.js').GameContext>} ctx
   */
  constructor(ctx) {
    this.ctx = ctx;
    this.bus = ctx.bus;
    /** @type {Projectile[]} */
    this.active = [];
    this.pool = new Pool(
      () => new Projectile(),
      (p) => p.reset(),
      64,
    );
    /** Hard cap; beyond this, new spawns are dropped rather than queued. */
    this.maxActive = 320;

    /** @type {(() => void)[]} */
    this._unsubscribers = [];
    if (this.bus) {
      this._unsubscribers.push(this.bus.on('projectile:spawn', (spec) => this.spawn(spec)));
    }
  }

  dispose() {
    for (const off of this._unsubscribers) off();
    this._unsubscribers.length = 0;
    this.clear();
  }

  /**
   * @param {object} spec
   */
  spawn(spec) {
    if (this.active.length >= this.maxActive) return null;
    const p = this.pool.acquire();
    p.x = spec.x;
    p.y = spec.y;
    p.vx = spec.vx ?? 0;
    p.vy = spec.vy ?? 0;
    p.gravity = spec.gravity ?? 0;
    p.damage = spec.damage ?? 1;
    p.size = spec.size ?? 3;
    p.life = spec.life ?? 3;
    p.maxLife = p.life;
    p.color = spec.color ?? '#ffd070';
    p.team = spec.team ?? Team.ENEMY;
    p.owner = spec.owner ?? null;
    p.homing = spec.homing ?? false;
    p.grounded = spec.grounded ?? false;
    p.bounces = spec.bounces ?? 0;
    p.spin = spec.spin ?? 0;
    p.rotation = Math.atan2(p.vy, p.vx);
    p.trail.length = 0;
    p.alive = true;
    this.active.push(p);
    return p;
  }

  /**
   * @param {number} dt
   */
  update(dt) {
    const map = this.ctx.map;
    const combat = this.ctx.combat;
    const player = this.ctx.player;

    for (let i = this.active.length - 1; i >= 0; i--) {
      const p = this.active[i];

      p.life -= dt;
      if (p.life <= 0) {
        this._retire(i, false);
        continue;
      }

      if (p.homing && player) {
        // Gentle steering only. Strong homing removes the player's ability to
        // dodge, which turns a projectile from a threat into a tax.
        const dx = player.body.box.centerX - p.x;
        const dy = player.body.box.centerY - p.y;
        const len = Math.hypot(dx, dy) || 1;
        const speed = Math.hypot(p.vx, p.vy) || 1;
        p.vx += (dx / len) * speed * p.homingStrength * dt;
        p.vy += (dy / len) * speed * p.homingStrength * dt;
        // Renormalise so homing does not accelerate the projectile.
        const newSpeed = Math.hypot(p.vx, p.vy) || 1;
        p.vx = (p.vx / newSpeed) * speed;
        p.vy = (p.vy / newSpeed) * speed;
      }

      if (p.gravity) p.vy += p.gravity * dt;

      // Shockwaves hug the floor: they follow the surface height rather than
      // arcing, so they read as travelling *along* the ground.
      if (p.grounded && map) {
        const groundY = map.groundBelow(p.x, p.y - TILE_SIZE, 4);
        if (Number.isFinite(groundY)) p.y = groundY - p.size;
      }

      const steps = Math.max(1, Math.ceil((Math.abs(p.vx) + Math.abs(p.vy)) * dt / (TILE_SIZE * 0.5)));
      let hitTerrain = false;
      for (let s = 0; s < steps && !hitTerrain; s++) {
        p.x += (p.vx * dt) / steps;
        p.y += (p.vy * dt) / steps;
        if (map && isSolid(map.getAtPixel(p.x, p.y))) hitTerrain = true;
      }

      if (p.spin) p.rotation += p.spin * dt;
      else p.rotation = Math.atan2(p.vy, p.vx);

      // A short position history drives the painter's motion trail.
      p.trail.push(p.x, p.y);
      if (p.trail.length > 10) p.trail.splice(0, 2);

      if (hitTerrain) {
        if (p.bounces > 0) {
          p.bounces--;
          // Cheap reflection: reverse whichever axis is more likely to be the
          // contact normal. Exact normals are not worth a raycast here.
          if (map && isSolid(map.getAtPixel(p.x + Math.sign(p.vx) * 4, p.y))) p.vx = -p.vx;
          else p.vy = -p.vy;
        } else {
          this._retire(i, true);
          continue;
        }
      }

      // Out-of-room projectiles are retired even if terrain did not stop them.
      const room = this.ctx.room;
      if (room && !room.bounds.containsPoint(p.x, p.y)) {
        this._retire(i, false);
        continue;
      }

      if (combat) {
        combat.spawnHitboxAt(
          p.owner ?? p,
          {
            offsetX: 0,
            offsetY: 0,
            width: p.size * 2,
            height: p.size * 2,
            damage: p.damage,
            team: p.team,
            knockback: 120,
            activeFrames: 1,
            id: 'projectile',
          },
          p.x - p.size,
          p.y - p.size,
        );
      }
    }
  }

  /**
   * @param {number} index
   * @param {boolean} onTerrain
   * @private
   */
  _retire(index, onTerrain) {
    const p = this.active[index];
    if (onTerrain) {
      this.bus?.emit(Events.SPAWN_PARTICLES, {
        kind: 'projectileHit', x: p.x, y: p.y, color: p.color,
      });
    }
    p.alive = false;
    this.active.splice(index, 1);
    this.pool.release(p);
  }

  clear() {
    for (const p of this.active) {
      p.alive = false;
      this.pool.release(p);
    }
    this.active.length = 0;
  }

  /**
   * @param {import('../../engine/render/renderer.js').Renderer} renderer
   */
  render(renderer) {
    const g = renderer.g;
    for (const p of this.active) {
      // Trail first, so the head draws over it.
      if (p.trail.length >= 4) {
        g.strokeStyle = p.color;
        g.globalAlpha = 0.28;
        g.lineWidth = Math.max(1, p.size * 0.8);
        g.beginPath();
        g.moveTo(p.trail[0], p.trail[1]);
        for (let i = 2; i < p.trail.length; i += 2) g.lineTo(p.trail[i], p.trail[i + 1]);
        g.stroke();
        g.globalAlpha = 1;
      }
      renderer.glow(p.x, p.y, p.size * 3.2, p.color, 0.5);
      renderer.circle(p.x, p.y, p.size, p.color);
      renderer.circle(p.x - p.size * 0.25, p.y - p.size * 0.25, p.size * 0.42, '#ffffff');
    }
    g.globalAlpha = 1;
  }
}
