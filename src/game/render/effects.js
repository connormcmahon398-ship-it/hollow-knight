/**
 * @file Named particle effects.
 *
 * Gameplay emits `{kind: 'land', x, y}` and this table decides what that looks
 * like. Keeping the mapping here means combat and movement code contains no
 * particle parameters, and the whole game's visual vocabulary can be retuned in
 * one file.
 */

import { ParticleShape } from '../../engine/fx/particles.js';
import { withAlpha } from '../../engine/render/palette.js';

/**
 * @param {import('../../engine/fx/particles.js').ParticleSystem} ps
 * @param {any} e event payload; requires x, y and kind
 * @param {import('../../engine/render/palette.js').Palette} palette
 */
export function spawnEffect(ps, e, palette) {
  const fn = EFFECTS[e.kind];
  if (fn) fn(ps, e, palette);
}

/** @type {Record<string, (ps: any, e: any, p: any) => void>} */
const EFFECTS = {
  land: (ps, e, p) => ps.emit({
    x: e.x, y: e.y, count: Math.round(4 + (e.intensity ?? 1) * 6),
    speed: 40 * (e.intensity ?? 1), angle: -Math.PI / 2, angleSpread: Math.PI * 0.9,
    life: 0.3, lifeSpread: 0.2, size: 1.6, sizeSpread: 0.8, gravity: 260, drag: 2,
    color: p.ramp[6], colorEnd: withAlpha(p.ramp[3], 0), shape: ParticleShape.DOT, areaW: 10,
  }),

  dash: (ps, e, p) => ps.emit({
    x: e.x, y: e.y, count: 12,
    vx: -(e.direction ?? 1) * 90, spread: 34,
    life: 0.26, lifeSpread: 0.14, size: 1.8, sizeSpread: 1, drag: 3,
    color: '#bfe0ff', colorEnd: withAlpha('#2f5f8f', 0), shape: ParticleShape.LINE, additive: true,
  }),

  doubleJump: (ps, e, p) => ps.emit({
    x: e.x, y: e.y, count: 14,
    speed: 70, angle: Math.PI / 2, angleSpread: Math.PI * 1.4,
    life: 0.36, lifeSpread: 0.14, size: 1.5, sizeSpread: 0.7, gravity: 90, drag: 2.6,
    color: '#dff0ff', colorEnd: withAlpha('#7fa8d0', 0), shape: ParticleShape.GLYPH, additive: true, spin: 6,
  }),

  wallSlide: (ps, e, p) => ps.emit({
    x: e.x, y: e.y, count: 1,
    speed: 24, angle: Math.PI / 2, angleSpread: 0.9,
    life: 0.3, size: 1.1, gravity: 120, drag: 2,
    color: p.ramp[7], colorEnd: withAlpha(p.ramp[4], 0), shape: ParticleShape.DOT,
  }),

  wallJump: (ps, e, p) => ps.emit({
    x: e.x, y: e.y, count: 9,
    speed: 90, angle: (e.direction ?? 1) > 0 ? 0 : Math.PI, angleSpread: 1.6,
    life: 0.3, lifeSpread: 0.12, size: 1.6, sizeSpread: 0.7, drag: 3,
    color: '#cfe4ff', colorEnd: withAlpha('#4f7f9f', 0), shape: ParticleShape.LINE, additive: true,
  }),

  pogo: (ps, e, p) => ps.emit({
    x: e.x, y: e.y, count: 12,
    speed: 110, angle: Math.PI / 2, angleSpread: Math.PI * 0.8,
    life: 0.3, lifeSpread: 0.12, size: 2, sizeSpread: 0.9, gravity: 200, drag: 2.4,
    color: '#eaf4ff', colorEnd: withAlpha('#5f8faf', 0), shape: ParticleShape.SPARK, additive: true,
  }),

  sparks: (ps, e, p) => ps.emit({
    x: e.x, y: e.y, count: 10,
    speed: 150, angle: (e.direction ?? 1) > 0 ? 0 : Math.PI, angleSpread: 1.9,
    life: 0.24, lifeSpread: 0.14, size: 1.3, sizeSpread: 0.7, gravity: 420, drag: 1.6,
    color: '#fff0c0', colorEnd: withAlpha('#c07020', 0), shape: ParticleShape.SPARK, additive: true,
  }),

  impact: (ps, e, p) => {
    ps.emit({
      x: e.x, y: e.y, count: 12,
      speed: 170, life: 0.24, lifeSpread: 0.12, size: 1.8, sizeSpread: 1,
      gravity: 300, drag: 3,
      color: '#ffffff', colorEnd: withAlpha('#ff9060', 0),
      shape: ParticleShape.SPARK, additive: true,
    });
    ps.emit({
      x: e.x, y: e.y, count: 1, life: 0.22, size: 5,
      color: '#ffffff', colorEnd: withAlpha('#ffffff', 0),
      shape: ParticleShape.RING, additive: true,
    });
  },

  enemyDeath: (ps, e, p) => {
    ps.emit({
      x: e.x, y: e.y, count: 22,
      speed: 130, life: 0.5, lifeSpread: 0.3, size: 2.2, sizeSpread: 1.2,
      gravity: 240, drag: 2.2,
      color: e.color ?? p.accent, colorEnd: withAlpha(p.ramp[2], 0),
      shape: ParticleShape.GLYPH, spin: 8,
    });
    ps.emit({
      x: e.x, y: e.y, count: 8,
      speed: 60, life: 0.7, lifeSpread: 0.4, size: 5, sizeSpread: 2, drag: 1.4,
      color: '#1b2733', colorEnd: withAlpha('#1b2733', 0), shape: ParticleShape.SMOKE,
    });
  },

  focus: (ps, e, p) => {
    // Ink drawn inward, which reads as gathering rather than emitting.
    const a = Math.random() * Math.PI * 2;
    const r = 22 - (e.progress ?? 0) * 14;
    ps.emit({
      x: e.x + Math.cos(a) * r, y: e.y + Math.sin(a) * r, count: 1,
      vx: -Math.cos(a) * 40, vy: -Math.sin(a) * 40,
      life: 0.4, size: 1.4, drag: 0.5,
      color: '#8fd0ff', colorEnd: withAlpha('#ffffff', 0),
      shape: ParticleShape.DOT, additive: true,
    });
  },

  bubbles: (ps, e, p) => ps.emit({
    x: e.x, y: e.y, count: 5,
    speed: 30, angle: -Math.PI / 2, angleSpread: 1.2,
    life: 0.8, lifeSpread: 0.5, size: 1.4, sizeSpread: 0.8, gravity: -60, drag: 1.2,
    color: withAlpha('#ffffff', 0.6), shape: ParticleShape.DOT,
  }),

  slam: (ps, e, p) => {
    ps.emit({
      x: e.x, y: e.y, count: 26,
      speed: 190, angle: -Math.PI / 2, angleSpread: Math.PI,
      life: 0.5, lifeSpread: 0.3, size: 2.4, sizeSpread: 1.4, gravity: 460, drag: 2,
      color: p.ramp[7], colorEnd: withAlpha(p.ramp[3], 0), shape: ParticleShape.DOT, areaW: 24,
    });
    ps.emit({
      x: e.x, y: e.y, count: 1, life: 0.34, size: 8,
      color: p.accent, colorEnd: withAlpha(p.accent, 0),
      shape: ParticleShape.RING, additive: true,
    });
  },

  spikeErupt: (ps, e, p) => ps.emit({
    x: e.x, y: e.y, count: 10,
    speed: 150, angle: -Math.PI / 2, angleSpread: 1.1,
    life: 0.4, lifeSpread: 0.2, size: 2, sizeSpread: 1, gravity: 400, drag: 1.8,
    color: p.ramp[6], colorEnd: withAlpha(p.ramp[2], 0), shape: ParticleShape.DOT,
  }),

  bossTrail: (ps, e, p) => ps.emit({
    x: e.x, y: e.y, count: 2,
    spread: 16, life: 0.3, lifeSpread: 0.16, size: 2.6, sizeSpread: 1.2, drag: 2,
    color: e.color ?? p.accent, colorEnd: withAlpha(p.ramp[2], 0),
    shape: ParticleShape.SMOKE,
  }),

  projectileHit: (ps, e, p) => ps.emit({
    x: e.x, y: e.y, count: 7,
    speed: 110, life: 0.22, lifeSpread: 0.1, size: 1.5, sizeSpread: 0.7, drag: 3,
    color: e.color ?? '#ffd070', colorEnd: withAlpha('#ffffff', 0),
    shape: ParticleShape.SPARK, additive: true,
  }),

  summon: (ps, e, p) => ps.emit({
    x: e.x, y: e.y, count: 20,
    speed: 90, life: 0.55, lifeSpread: 0.3, size: 2, sizeSpread: 1, drag: 1.6,
    color: p.accentAlt, colorEnd: withAlpha(p.accent, 0),
    shape: ParticleShape.GLYPH, spin: 5, additive: true,
  }),

  blinkOut: (ps, e, p) => ps.emit({
    x: e.x, y: e.y, count: 16,
    speed: 130, life: 0.3, lifeSpread: 0.12, size: 1.8, sizeSpread: 0.8, drag: 2.6,
    color: '#c0a0ff', colorEnd: withAlpha('#402060', 0),
    shape: ParticleShape.LINE, additive: true,
  }),

  blinkIn: (ps, e, p) => ps.emit({
    x: e.x, y: e.y, count: 16,
    speed: 40, life: 0.28, size: 1.8, sizeSpread: 0.8, drag: 4,
    color: '#e0c0ff', colorEnd: withAlpha('#ffffff', 0),
    shape: ParticleShape.SPARK, additive: true,
  }),

  burrow: (ps, e, p) => ps.emit({
    x: e.x, y: e.y, count: 12,
    speed: 80, angle: -Math.PI / 2, angleSpread: 1.6,
    life: 0.4, lifeSpread: 0.2, size: 2, sizeSpread: 1, gravity: 320, drag: 2,
    color: p.ramp[5], colorEnd: withAlpha(p.ramp[2], 0), shape: ParticleShape.DOT,
  }),

  pickup: (ps, e, p) => ps.emit({
    x: e.x, y: e.y, count: 16,
    speed: 70, life: 0.5, lifeSpread: 0.25, size: 1.6, sizeSpread: 0.8,
    gravity: -30, drag: 2,
    color: '#ffe8a0', colorEnd: withAlpha('#ffe8a0', 0),
    shape: ParticleShape.SPARK, additive: true,
  }),

  transcribe: (ps, e, p) => ps.emit({
    x: e.x, y: e.y, count: 18,
    speed: 46, angle: -Math.PI / 2, angleSpread: 1.8,
    life: 0.9, lifeSpread: 0.4, size: 1.8, sizeSpread: 0.8, gravity: -24, drag: 1.2,
    color: '#dfeaff', colorEnd: withAlpha('#8fa8d0', 0),
    shape: ParticleShape.GLYPH, spin: 3, additive: true,
  }),

  unlock: (ps, e, p) => ps.emit({
    x: e.x, y: e.y, count: 40,
    speed: 140, life: 1.1, lifeSpread: 0.6, size: 2.2, sizeSpread: 1.2, drag: 1.6,
    color: '#ffe8b0', colorEnd: withAlpha('#ff9040', 0),
    shape: ParticleShape.GLYPH, spin: 6, additive: true,
  }),
};

export { EFFECTS };
