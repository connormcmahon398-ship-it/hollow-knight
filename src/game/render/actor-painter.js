/**
 * @file Draws the player, enemies and bosses.
 *
 * ## Procedural characters
 * Every creature is drawn from primitives at runtime, driven by the `visual`
 * record on its definition. A creature's `form` selects a drawing routine and
 * the remaining fields parameterise it, so eighty-odd creatures come from a
 * dozen routines plus data — the same economy as the AI archetypes, applied to
 * art.
 *
 * ## Animation without frames
 * There are no sprite sheets, so animation is *procedural*: limbs are placed by
 * trigonometric functions of a phase clock, and squash-and-stretch is applied
 * as a transform driven by the controller's `visual` state. This gets a
 * surprising amount of life from very little code, and — unlike a frame
 * animation — it responds continuously to velocity, so the character's motion
 * always matches what the physics is actually doing.
 *
 * The player is drawn separately and in more detail, because that is the shape
 * the player looks at for the entire game.
 */

import { withAlpha, mix, lighten, darken } from '../../engine/render/palette.js';
import { clamp } from '../../engine/math/math-utils.js';
import { PlayerState } from '../player/player.js';
import { AttackDirection } from '../player/attacks.js';

/**
 * Draw the player character: Nib, a small ink-and-brass automaton.
 *
 * @param {import('../../engine/render/renderer.js').Renderer} r
 * @param {import('../player/player.js').Player} player
 * @param {number} alpha interpolation factor between simulation steps
 * @param {number} time
 */
export function drawPlayer(r, player, alpha, time) {
  const body = player.body;
  const x = Math.round(body.renderX(alpha) + body.box.w / 2);
  const y = Math.round(body.renderY(alpha) + body.box.h);
  const v = player.visual;
  const facing = player.facing;
  const state = player.machine.currentName;

  // Dash after-images, drawn first so the live body sits on top.
  for (const t of v.trail) {
    const a = 1 - t.age / 0.26;
    r.withAlpha(a * 0.4, () => {
      drawNibBody(
        r, t.x + body.box.w / 2, t.y + body.box.h, facing,
        1, 1, 0, '#5f7fa8', '#8fd0ff', time, state, 0,
      );
    });
  }

  // Invulnerability blink. Blinking rather than fading, because a solid-then-
  // absent flicker reads unambiguously as "you cannot be hit right now".
  if (player.iframeTimer > 0 && Math.floor(time * 18) % 2 === 0 && !player.health.dead) {
    return;
  }

  const inkColor = player.health.current <= 1 ? '#c04060' : '#1b2733';
  const brass = '#c9a86a';

  drawNibBody(r, x, y, facing, v.squash, v.stretch, v.lean, inkColor, brass, time, state, v.sway);

  // The nib itself, and the slash arc while attacking.
  if (state === PlayerState.ATTACK) {
    drawSlash(r, x, y, facing, v.attackDir, v.attackProgress, brass);
  }

  // Focus channelling: a gathering ring of ink.
  if (state === PlayerState.FOCUS) {
    const p = clamp(player.focusCharge / 0.85, 0, 1);
    r.withAlpha(0.6, () => {
      r.circle(x, y - 10, 16 * (1 - p) + 5, withAlpha('#8fd0ff', 0.25));
    });
    r.glow(x, y - 10, 22 * p + 6, '#8fd0ff', 0.7 * p);
  }

  // Damage flash.
  if (v.flash > 0) {
    r.withAlpha(v.flash * 0.8, () => {
      r.ellipse(x, y - 10, 9, 12, '#ffffff');
    });
  }

  // The character is the light source in dark regions.
  r.addLight(x, y - 10, 96, '#7fa8d0', 0.75);
}

/**
 * The body: a rounded ink form with a brass frame and a trailing ribbon.
 * @param {import('../../engine/render/renderer.js').Renderer} r
 * @param {number} x @param {number} y feet position
 * @param {number} facing
 * @param {number} squash @param {number} stretch @param {number} lean
 * @param {string} ink @param {string} brass
 * @param {number} time @param {string} state @param {number} sway
 */
function drawNibBody(r, x, y, facing, squash, stretch, lean, ink, brass, time, state, sway) {
  const h = 20 * stretch;
  const w = 11 * squash;
  const g = r.g;

  g.save();
  g.translate(x, y);
  g.rotate(lean * facing * 0.5);

  // Trailing ribbon (the Quill's mark-cloth), drawn behind the body.
  const swayAmt = clamp(sway, -6, 6);
  g.strokeStyle = withAlpha(mix(ink, '#3f5f8f', 0.5), 0.85);
  g.lineWidth = 3;
  g.lineCap = 'round';
  g.beginPath();
  g.moveTo(-facing * 2, -h * 0.62);
  g.quadraticCurveTo(
    -facing * 7 + swayAmt, -h * 0.4 + Math.sin(time * 4) * 1.5,
    -facing * 10 + swayAmt * 1.6, -h * 0.08 + Math.sin(time * 3.3) * 2,
  );
  g.stroke();
  g.lineCap = 'butt';

  // Body: a tapered capsule, wider at the base.
  g.fillStyle = ink;
  g.beginPath();
  g.moveTo(-w * 0.5, 0);
  g.quadraticCurveTo(-w * 0.62, -h * 0.55, -w * 0.28, -h * 0.86);
  g.quadraticCurveTo(0, -h * 1.02, w * 0.28, -h * 0.86);
  g.quadraticCurveTo(w * 0.62, -h * 0.55, w * 0.5, 0);
  g.closePath();
  g.fill();

  // Brass frame: two ribs and a collar.
  g.strokeStyle = brass;
  g.lineWidth = 1;
  g.beginPath();
  g.moveTo(-w * 0.44, -h * 0.22);
  g.lineTo(w * 0.44, -h * 0.22);
  g.moveTo(-w * 0.5, -h * 0.46);
  g.lineTo(w * 0.5, -h * 0.46);
  g.stroke();

  // Head plate and the single lens-eye.
  g.fillStyle = darken(ink, 0.03);
  g.beginPath();
  g.ellipse(facing * 0.6, -h * 0.82, w * 0.42, h * 0.2, 0, 0, Math.PI * 2);
  g.fill();

  const blink = Math.sin(time * 0.9) > 0.985 ? 0.15 : 1;
  g.fillStyle = '#8fd0ff';
  g.beginPath();
  g.ellipse(facing * 2.1, -h * 0.82, 2.1, 2.1 * blink, 0, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#ffffff';
  g.beginPath();
  g.arc(facing * 2.6, -h * 0.86, 0.7, 0, Math.PI * 2);
  g.fill();

  // Legs: a two-bar walk cycle driven by state and time.
  const walking = state === PlayerState.RUN;
  const airborne = state === PlayerState.JUMP || state === PlayerState.FALL
    || state === PlayerState.DASH || state === PlayerState.WALL_SLIDE;
  g.strokeStyle = brass;
  g.lineWidth = 1.4;
  g.lineCap = 'round';
  for (let i = 0; i < 2; i++) {
    const side = i === 0 ? -1 : 1;
    let footX;
    let footY;
    if (walking) {
      const phase = time * 13 + i * Math.PI;
      footX = Math.sin(phase) * 3.6 * facing;
      footY = Math.max(0, Math.cos(phase)) * -2.4;
    } else if (airborne) {
      footX = side * 1.4 - facing * 1.6;
      footY = -1.6;
    } else {
      footX = side * 2;
      footY = 0;
    }
    g.beginPath();
    g.moveTo(side * w * 0.24, -h * 0.14);
    g.lineTo(footX, footY);
    g.stroke();
  }
  g.lineCap = 'butt';

  g.restore();
}

/**
 * The slash arc. Drawn as a swept crescent whose sweep follows the attack's
 * progress, so the visual and the active frames line up.
 * @param {import('../../engine/render/renderer.js').Renderer} r
 * @param {number} x @param {number} y
 * @param {number} facing
 * @param {string} dir
 * @param {number} progress 0..1
 * @param {string} color
 */
function drawSlash(r, x, y, facing, dir, progress, color) {
  // The arc is only visible around the active window, not for the whole state.
  const vis = Math.sin(clamp(progress, 0, 1) * Math.PI);
  if (vis <= 0.02) return;

  const g = r.g;
  const cx = x;
  const cy = y - 10;

  let baseAngle;
  let radius = 26;
  if (dir === AttackDirection.UP) {
    baseAngle = -Math.PI / 2;
  } else if (dir === AttackDirection.DOWN) {
    baseAngle = Math.PI / 2;
    radius = 24;
  } else {
    baseAngle = facing > 0 ? 0 : Math.PI;
  }

  const sweep = 1.5;
  const start = baseAngle - sweep / 2 + sweep * progress * 0.5;

  g.save();
  g.globalAlpha = vis;
  g.strokeStyle = '#eaf4ff';
  g.lineWidth = 3.2 * vis;
  g.lineCap = 'round';
  g.beginPath();
  g.arc(cx, cy, radius, start, start + sweep * 0.8);
  g.stroke();

  g.strokeStyle = withAlpha(color, 0.7);
  g.lineWidth = 1.4 * vis;
  g.beginPath();
  g.arc(cx, cy, radius - 4, start + 0.1, start + sweep * 0.7);
  g.stroke();
  g.lineCap = 'butt';
  g.restore();

  r.glow(
    cx + Math.cos(baseAngle) * radius,
    cy + Math.sin(baseAngle) * radius,
    16 * vis, '#bfe0ff', 0.5 * vis,
  );
}

/**
 * Draw any enemy or boss from its visual record.
 * @param {import('../../engine/render/renderer.js').Renderer} r
 * @param {import('../enemy/enemy.js').Enemy} enemy
 * @param {number} alpha
 * @param {number} time
 * @param {import('../../engine/render/palette.js').Palette} palette
 */
export function drawEnemy(r, enemy, alpha, time, palette) {
  const body = enemy.body;
  const x = body.renderX(alpha) + body.box.w / 2;
  const y = body.renderY(alpha) + body.box.h;
  const vis = enemy.def.visual ?? {};
  const color = vis.color ?? palette.ramp[4];
  const accent = vis.accent ?? palette.accent;
  const w = body.box.w;
  const h = body.box.h;
  const facing = enemy.facing;
  const phase = enemy.visual.phase;

  const g = r.g;
  g.save();
  g.translate(x, y);

  // Death: collapse and fade.
  if (enemy.machine.is('dead')) {
    const p = clamp(enemy.visual.deathProgress, 0, 1);
    g.globalAlpha = 1 - p;
    g.scale(1 + p * 0.4, Math.max(0.05, 1 - p));
    g.translate(0, p * 4);
  }

  // Wind-up wobble and hit squash.
  if (enemy.visual.wobble) g.rotate(Math.sin(enemy.visual.wobble) * 0.16);
  g.scale(enemy.visual.squash, 2 - enemy.visual.squash);

  const form = vis.form ?? 'blob';
  drawForm(g, r, form, w, h, color, accent, facing, phase, vis, enemy);

  // Hit flash: a white silhouette over the body.
  if (enemy.visual.flash > 0) {
    g.globalAlpha = enemy.visual.flash * 0.85;
    g.fillStyle = '#ffffff';
    g.beginPath();
    g.ellipse(0, -h / 2, w * 0.55, h * 0.55, 0, 0, Math.PI * 2);
    g.fill();
    g.globalAlpha = 1;
  }

  g.restore();

  if (vis.glow) {
    r.addLight(x, y - h / 2, 40 + (vis.glow ?? 0) * 40, accent, 0.5 * vis.glow);
    r.glow(x, y - h / 2, 12 + vis.glow * 10, withAlpha(accent, 0.5), 0.4);
  }

  // Boss health-bar anchor and alert indicator.
  if (enemy.alerted && !enemy.isBoss && !enemy.isDead) {
    r.withAlpha(0.5 + 0.5 * Math.sin(time * 8), () => {
      r.circle(x, y - h - 6, 1.5, accent);
    });
  }
}

/**
 * The form library. Each case is one creature silhouette.
 * @param {CanvasRenderingContext2D} g
 * @param {import('../../engine/render/renderer.js').Renderer} r
 * @param {string} form
 * @param {number} w @param {number} h
 * @param {string} color @param {string} accent
 * @param {number} facing @param {number} phase
 * @param {any} vis
 * @param {import('../enemy/enemy.js').Enemy} enemy
 */
function drawForm(g, r, form, w, h, color, accent, facing, phase, vis, enemy) {
  const bob = Math.sin(phase * 2.4) * 1.2;
  g.fillStyle = color;

  switch (form) {
    case 'crust':
    case 'boulder':
      g.beginPath();
      g.moveTo(-w / 2, 0);
      for (let i = 0; i <= 6; i++) {
        const t = i / 6;
        const jag = (i % 2 === 0 ? 0.86 : 1) * h;
        g.lineTo(-w / 2 + w * t, -jag);
      }
      g.lineTo(w / 2, 0);
      g.closePath();
      g.fill();
      strokeAccent(g, accent, 0.6);
      break;

    case 'crab':
      g.beginPath();
      g.ellipse(0, -h * 0.55, w * 0.5, h * 0.5, 0, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = accent;
      g.lineWidth = 1.2;
      for (let i = 0; i < (vis.legs ?? 6); i++) {
        const side = i % 2 === 0 ? -1 : 1;
        const idx = Math.floor(i / 2);
        const px = side * (w * 0.4);
        const py = -h * 0.3 - idx * 3;
        g.beginPath();
        g.moveTo(px, py);
        g.lineTo(px + side * 4, py + 3 + Math.sin(phase * 6 + i) * 1.2);
        g.stroke();
      }
      break;

    case 'hopper':
      g.beginPath();
      g.ellipse(0, -h * 0.5, w * 0.48, h * 0.5, 0, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = accent;
      g.lineWidth = 1.4;
      for (const side of [-1, 1]) {
        g.beginPath();
        g.moveTo(side * w * 0.3, -h * 0.2);
        g.lineTo(side * w * 0.5, 0);
        g.stroke();
      }
      break;

    case 'mote':
    case 'spark':
    case 'wisp':
    case 'glyph':
      g.beginPath();
      g.arc(0, -h / 2 + bob, w * 0.44, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = accent;
      g.beginPath();
      g.arc(0, -h / 2 + bob, w * 0.22, 0, Math.PI * 2);
      g.fill();
      break;

    case 'mite':
    case 'chime':
    case 'shade':
      g.beginPath();
      g.moveTo(0, -h + bob);
      g.lineTo(w / 2, -h / 2 + bob);
      g.lineTo(0, bob);
      g.lineTo(-w / 2, -h / 2 + bob);
      g.closePath();
      g.fill();
      break;

    case 'jelly':
      g.globalAlpha *= vis.translucent ? 0.62 : 1;
      g.beginPath();
      g.ellipse(0, -h * 0.6 + bob, w * 0.5, h * 0.45, 0, Math.PI, 0);
      g.fill();
      g.strokeStyle = accent;
      g.lineWidth = 1;
      for (let i = 0; i < 4; i++) {
        const tx = -w * 0.3 + (i * w) / 4.5;
        g.beginPath();
        g.moveTo(tx, -h * 0.6 + bob);
        g.quadraticCurveTo(tx + Math.sin(phase * 3 + i) * 3, -h * 0.25 + bob, tx, bob);
        g.stroke();
      }
      g.globalAlpha = 1;
      break;

    case 'moth':
    case 'bird':
    case 'kite': {
      const flap = Math.sin(phase * (form === 'bird' ? 9 : 6));
      g.fillStyle = withAlpha(accent, 0.55);
      const wings = vis.wings ?? 2;
      for (let i = 0; i < wings; i++) {
        const side = i % 2 === 0 ? -1 : 1;
        const tier = Math.floor(i / 2);
        g.beginPath();
        g.moveTo(0, -h * 0.55);
        g.quadraticCurveTo(
          side * w * 0.9, -h * (0.9 + tier * 0.15) + flap * 4,
          side * w * 0.5, -h * 0.2,
        );
        g.closePath();
        g.fill();
      }
      g.fillStyle = color;
      g.beginPath();
      g.ellipse(0, -h * 0.5, w * 0.26, h * 0.44, 0, 0, Math.PI * 2);
      g.fill();
      break;
    }

    case 'eel': {
      const segs = vis.segments ?? 5;
      g.strokeStyle = color;
      g.lineWidth = h * 0.75;
      g.lineCap = 'round';
      g.beginPath();
      for (let i = 0; i <= segs; i++) {
        const t = i / segs;
        const sx = -facing * (t * w) + facing * w * 0.5;
        const sy = -h / 2 + Math.sin(phase * 6 - t * 3) * 3;
        if (i === 0) g.moveTo(sx, sy);
        else g.lineTo(sx, sy);
      }
      g.stroke();
      g.lineCap = 'butt';
      g.fillStyle = accent;
      g.beginPath();
      g.arc(facing * w * 0.5, -h / 2, 1.6, 0, Math.PI * 2);
      g.fill();
      break;
    }

    case 'worm':
    case 'grub': {
      const segs = vis.segments ?? 4;
      for (let i = segs; i >= 0; i--) {
        const t = i / segs;
        g.fillStyle = i === 0 ? lighten(color, 0.06) : color;
        g.beginPath();
        g.ellipse(
          -facing * t * w * 0.35,
          -h * 0.5 + Math.sin(phase * 4 + i) * 1.2,
          w * (0.46 - t * 0.1), h * (0.46 - t * 0.08), 0, 0, Math.PI * 2,
        );
        g.fill();
      }
      break;
    }

    case 'maw': {
      g.beginPath();
      g.ellipse(0, -h * 0.5, w * 0.5, h * 0.5, 0, 0, Math.PI * 2);
      g.fill();
      const open = 0.5 + 0.5 * Math.sin(phase * 2.2);
      g.fillStyle = '#100c10';
      g.beginPath();
      g.ellipse(facing * w * 0.12, -h * 0.45, w * 0.3, h * 0.3 * open, 0, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = accent;
      const teeth = vis.teeth ?? 6;
      for (let i = 0; i < teeth; i++) {
        const a = (i / teeth) * Math.PI * 2;
        g.beginPath();
        g.moveTo(Math.cos(a) * w * 0.28, -h * 0.45 + Math.sin(a) * h * 0.28);
        g.lineTo(Math.cos(a) * w * 0.18, -h * 0.45 + Math.sin(a) * h * 0.18);
        g.lineTo(Math.cos(a + 0.3) * w * 0.28, -h * 0.45 + Math.sin(a + 0.3) * h * 0.28);
        g.closePath();
        g.fill();
      }
      break;
    }

    case 'humanoid': {
      g.beginPath();
      g.moveTo(-w * 0.4, 0);
      g.quadraticCurveTo(-w * 0.5, -h * 0.6, -w * 0.2, -h * 0.82);
      g.quadraticCurveTo(0, -h * 0.95, w * 0.2, -h * 0.82);
      g.quadraticCurveTo(w * 0.5, -h * 0.6, w * 0.4, 0);
      g.closePath();
      g.fill();
      if (vis.robe || vis.cloak) {
        g.fillStyle = withAlpha(darken(color, 0.04), 0.9);
        g.beginPath();
        g.moveTo(-w * 0.5, 0);
        g.lineTo(-w * 0.3, -h * 0.6);
        g.lineTo(w * 0.3, -h * 0.6);
        g.lineTo(w * 0.5, 0);
        g.closePath();
        g.fill();
      }
      g.fillStyle = accent;
      const eyes = vis.eyes ?? 2;
      for (let i = 0; i < eyes; i++) {
        const ex = facing * 1.5 + (i - (eyes - 1) / 2) * 3.2;
        g.beginPath();
        g.arc(ex, -h * 0.78, 1.1, 0, Math.PI * 2);
        g.fill();
      }
      break;
    }

    case 'automaton':
    case 'warden':
    case 'sentinel':
    case 'keeper':
    case 'tiller':
    case 'ringer':
    case 'lancer':
    case 'lamp':
    case 'choir': {
      g.fillRect(-w * 0.42, -h, w * 0.84, h);
      g.fillStyle = darken(color, 0.04);
      g.fillRect(-w * 0.42, -h * 0.42, w * 0.84, h * 0.12);
      if (vis.shield) {
        g.fillStyle = mix(accent, color, 0.4);
        const sx = facing * w * 0.42;
        g.fillRect(sx - facing * 2, -h * 0.92, facing * 3.5, h * 0.8);
      }
      if (vis.lance) {
        g.strokeStyle = accent;
        g.lineWidth = 1.6;
        g.beginPath();
        g.moveTo(facing * w * 0.3, -h * 0.55);
        g.lineTo(facing * w * 1.1, -h * 0.62);
        g.stroke();
      }
      g.fillStyle = accent;
      const eyeCount = vis.eyes ?? 2;
      for (let i = 0; i < eyeCount; i++) {
        const ex = facing * 1.2 + (i - (eyeCount - 1) / 2) * 3.4;
        g.beginPath();
        g.arc(ex, -h * 0.8, 1.2, 0, Math.PI * 2);
        g.fill();
      }
      break;
    }

    case 'bull':
    case 'hound': {
      g.beginPath();
      g.ellipse(0, -h * 0.5, w * 0.5, h * 0.42, 0, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = darken(color, 0.03);
      g.beginPath();
      g.ellipse(facing * w * 0.42, -h * 0.6, w * 0.22, h * 0.3, 0, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = accent;
      g.lineWidth = 1.3;
      const legs = vis.legs ?? 4;
      for (let i = 0; i < legs; i++) {
        const lx = -w * 0.3 + (i * w * 0.6) / Math.max(1, legs - 1);
        const swing = Math.sin(phase * 10 + i * 1.6) * 2.2;
        g.beginPath();
        g.moveTo(lx, -h * 0.22);
        g.lineTo(lx + swing, 0);
        g.stroke();
      }
      if (vis.horns) {
        g.strokeStyle = accent;
        g.lineWidth = 1.6;
        for (let i = 0; i < vis.horns; i++) {
          const side = i % 2 === 0 ? -1 : 1;
          g.beginPath();
          g.moveTo(facing * w * 0.4, -h * 0.8);
          g.lineTo(facing * w * 0.62, -h * (0.95 + side * 0.06));
          g.stroke();
        }
      }
      break;
    }

    case 'spider':
    case 'strider':
    case 'leech':
    case 'lurker':
    case 'creeper': {
      g.beginPath();
      g.ellipse(0, -h * 0.5, w * 0.4, h * 0.4, 0, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = accent;
      g.lineWidth = 1;
      const legs = vis.legs ?? vis.reeds ?? 6;
      for (let i = 0; i < legs; i++) {
        const side = i % 2 === 0 ? -1 : 1;
        const idx = Math.floor(i / 2);
        const a = -0.5 - idx * 0.5;
        const wob = Math.sin(phase * 5 + i) * 1.5;
        g.beginPath();
        g.moveTo(side * w * 0.25, -h * 0.5);
        g.lineTo(side * (w * 0.6 + wob), -h * 0.5 + Math.sin(a) * h * 0.5);
        g.lineTo(side * (w * 0.75 + wob), -h * 0.1);
        g.stroke();
      }
      g.fillStyle = accent;
      const eyeN = Math.min(vis.eyes ?? 4, 8);
      for (let i = 0; i < eyeN; i++) {
        const ex = (i % 4 - 1.5) * 2.2;
        const ey = -h * 0.6 - Math.floor(i / 4) * 2.4;
        g.beginPath();
        g.arc(ex, ey, 0.7, 0, Math.PI * 2);
        g.fill();
      }
      break;
    }

    case 'crystal':
    case 'prism': {
      const facets = vis.facets ?? 5;
      g.beginPath();
      for (let i = 0; i < facets; i++) {
        const a = (i / facets) * Math.PI * 2 - Math.PI / 2;
        const rad = (i % 2 === 0 ? 0.52 : 0.38);
        const px = Math.cos(a) * w * rad;
        const py = -h * 0.5 + Math.sin(a) * h * rad;
        if (i === 0) g.moveTo(px, py);
        else g.lineTo(px, py);
      }
      g.closePath();
      g.fill();
      g.strokeStyle = accent;
      g.lineWidth = 1;
      g.stroke();
      g.fillStyle = withAlpha(accent, 0.45);
      g.beginPath();
      g.arc(-w * 0.1, -h * 0.6, w * 0.14, 0, Math.PI * 2);
      g.fill();
      break;
    }

    case 'flower': {
      const petals = vis.petals ?? 5;
      g.fillStyle = accent;
      for (let i = 0; i < petals; i++) {
        const a = (i / petals) * Math.PI * 2 + phase * 0.4;
        g.beginPath();
        g.ellipse(
          Math.cos(a) * w * 0.28, -h * 0.55 + Math.sin(a) * h * 0.28,
          w * 0.2, h * 0.2, a, 0, Math.PI * 2,
        );
        g.fill();
      }
      g.fillStyle = color;
      g.beginPath();
      g.arc(0, -h * 0.55, w * 0.22, 0, Math.PI * 2);
      g.fill();
      break;
    }

    case 'gear':
    case 'spindle':
    case 'spring': {
      const teeth = vis.teeth ?? vis.blades ?? vis.coils ?? 10;
      g.save();
      g.rotate(phase * (enemy.machine.is('patrol') ? 4 : 1.2));
      g.beginPath();
      for (let i = 0; i < teeth * 2; i++) {
        const a = (i / (teeth * 2)) * Math.PI * 2;
        const rad = (i % 2 === 0 ? 0.5 : 0.36) * Math.min(w, h);
        const px = Math.cos(a) * rad;
        const py = Math.sin(a) * rad;
        if (i === 0) g.moveTo(px, py);
        else g.lineTo(px, py);
      }
      g.closePath();
      g.translate(0, 0);
      g.fill();
      g.restore();
      g.fillStyle = accent;
      g.beginPath();
      g.arc(0, -h * 0.5, w * 0.14, 0, Math.PI * 2);
      g.fill();
      break;
    }

    case 'bar':
      g.fillRect(-w / 2, -h, w, h);
      g.fillStyle = accent;
      g.fillRect(-w / 2, -h * 0.6, w, 1.5);
      break;

    case 'turret':
      g.fillRect(-w * 0.4, -h * 0.7, w * 0.8, h * 0.7);
      g.fillStyle = accent;
      g.fillRect(facing * w * 0.2, -h * 0.55, facing * w * 0.5, 3);
      break;

    case 'bulb':
    case 'pendulum':
      // Draw the tether line back to the anchor.
      g.strokeStyle = withAlpha(accent, 0.5);
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(0, -h * 0.5);
      g.lineTo(
        (enemy.homeX - enemy.body.box.centerX),
        (enemy.homeY - enemy.body.box.centerY) - h * 0.5,
      );
      g.stroke();
      g.fillStyle = color;
      g.beginPath();
      g.ellipse(0, -h * 0.5, w * 0.45, h * 0.45, 0, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = accent;
      g.beginPath();
      g.arc(0, -h * 0.5, w * 0.16, 0, Math.PI * 2);
      g.fill();
      break;

    case 'gasket':
      g.beginPath();
      g.arc(0, -h * 0.5, w * 0.46, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = accent;
      g.beginPath();
      g.arc(0, -h * 0.5, w * 0.2, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = color;
      g.beginPath();
      g.arc(0, -h * 0.5, w * 0.12, 0, Math.PI * 2);
      g.fill();
      break;

    case 'kettle':
      g.beginPath();
      g.ellipse(0, -h * 0.5, w * 0.45, h * 0.45, 0, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = accent;
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(facing * w * 0.35, -h * 0.6);
      g.lineTo(facing * w * 0.65, -h * 0.75);
      g.stroke();
      break;

    case 'weir':
      // Bosses that are structures: a slab with strain cracks and lit vents.
      g.fillRect(-w / 2, -h, w, h);
      g.strokeStyle = withAlpha(accent, 0.8);
      g.lineWidth = 1.4;
      for (let i = 0; i < 4; i++) {
        const cx = -w / 2 + ((i + 1) * w) / 5;
        g.beginPath();
        g.moveTo(cx, -h);
        g.lineTo(cx + Math.sin(i * 2.1) * 5, -h * 0.55);
        g.lineTo(cx + Math.sin(i * 3.3) * 7, 0);
        g.stroke();
      }
      g.fillStyle = accent;
      for (let i = 0; i < 3; i++) {
        g.globalAlpha = 0.4 + 0.4 * Math.sin(phase * 3 + i);
        g.fillRect(-w * 0.3 + i * w * 0.3, -h * 0.7, 4, 8);
      }
      g.globalAlpha = 1;
      break;

    case 'blob':
    default: {
      g.beginPath();
      const lobes = 7;
      for (let i = 0; i <= lobes; i++) {
        const a = (i / lobes) * Math.PI * 2;
        const wob = 1 + Math.sin(phase * 3 + i * 1.7) * 0.08;
        const px = Math.cos(a) * w * 0.5 * wob;
        const py = -h * 0.5 + Math.sin(a) * h * 0.5 * wob;
        if (i === 0) g.moveTo(px, py);
        else g.lineTo(px, py);
      }
      g.closePath();
      g.fill();
      g.fillStyle = accent;
      const eyeCount = vis.eyes ?? 2;
      for (let i = 0; i < eyeCount; i++) {
        const ex = (i - (eyeCount - 1) / 2) * 3.6 + facing * 1.2;
        g.beginPath();
        g.arc(ex, -h * 0.55, 1.1, 0, Math.PI * 2);
        g.fill();
      }
      break;
    }
  }
}

/**
 * @param {CanvasRenderingContext2D} g
 * @param {string} color @param {number} alpha
 */
function strokeAccent(g, color, alpha) {
  g.strokeStyle = withAlpha(color, alpha);
  g.lineWidth = 1;
  g.stroke();
}
