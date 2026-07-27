/**
 * @file Draws interactable props: Wellsprings, Gatestones, inscriptions, items.
 *
 * Props are the game's punctuation. They must read instantly as *interactable*
 * from across a room, which here means: a consistent silhouette language plus a
 * light source. Anything that glows can be used; anything that does not is
 * scenery.
 */

import { withAlpha, mix, lighten } from '../../engine/render/palette.js';

/**
 * @param {import('../../engine/render/renderer.js').Renderer} r
 * @param {any} item
 * @param {number} time
 * @param {import('../../engine/render/palette.js').Palette} palette
 */
export function drawInteractable(r, item, time, palette) {
  const x = item.x;
  const y = item.y;
  const g = r.g;
  const pulse = 0.6 + 0.4 * Math.sin(time * 2.2 + x * 0.05);

  switch (item.kind) {
    case 'checkpoint': {
      // A Wellspring: a basin on a plinth, with ink rising from it.
      g.fillStyle = palette.ramp[3];
      g.fillRect(x - 9, y - 6, 18, 6);
      g.fillStyle = palette.ramp[5];
      g.fillRect(x - 6, y - 16, 12, 10);
      g.fillStyle = mix('#2f6f9f', '#8fd0ff', pulse * 0.5);
      g.beginPath();
      g.ellipse(x, y - 16, 7, 2.6, 0, 0, Math.PI * 2);
      g.fill();
      // Rising motes.
      g.fillStyle = withAlpha('#8fd0ff', 0.7);
      for (let i = 0; i < 3; i++) {
        const t = (time * 0.5 + i * 0.33) % 1;
        g.globalAlpha = (1 - t) * 0.8;
        g.beginPath();
        g.arc(x + Math.sin(time * 2 + i * 2) * 3, y - 18 - t * 18, 1.1, 0, Math.PI * 2);
        g.fill();
      }
      g.globalAlpha = 1;
      r.addLight(x, y - 18, 90, '#8fd0ff', 0.85);
      r.glow(x, y - 17, 16, withAlpha('#8fd0ff', 0.4), 0.6);
      break;
    }

    case 'gate': {
      // A Gatestone: a standing stone with a carved ring.
      g.fillStyle = palette.ramp[4];
      g.beginPath();
      g.moveTo(x - 7, y);
      g.lineTo(x - 5, y - 26);
      g.lineTo(x + 5, y - 26);
      g.lineTo(x + 7, y);
      g.closePath();
      g.fill();
      g.strokeStyle = mix(palette.accent, '#ffffff', pulse * 0.4);
      g.lineWidth = 1.4;
      g.beginPath();
      g.arc(x, y - 15, 4.5, 0, Math.PI * 2);
      g.stroke();
      r.addLight(x, y - 15, 80, palette.accent, 0.6 * pulse);
      break;
    }

    case 'inscription': {
      // A wall inscription: a slab with glyph strokes.
      g.fillStyle = withAlpha(palette.ramp[2], 0.9);
      g.fillRect(x - 8, y - 22, 16, 20);
      g.strokeStyle = withAlpha(palette.accent, 0.55 + pulse * 0.35);
      g.lineWidth = 1;
      for (let i = 0; i < 4; i++) {
        const ly = y - 19 + i * 4;
        g.beginPath();
        g.moveTo(x - 5, ly);
        g.lineTo(x - 5 + 4 + ((i * 7) % 6), ly);
        g.stroke();
      }
      if (!item.used) r.addLight(x, y - 12, 54, palette.accent, 0.45 * pulse);
      break;
    }

    case 'item': {
      if (item.used) return;
      const bob = Math.sin(time * 2.4) * 2;
      g.fillStyle = palette.accent;
      g.save();
      g.translate(x, y - 12 + bob);
      g.rotate(time * 0.8);
      g.beginPath();
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2;
        const rad = i % 2 === 0 ? 5 : 2.4;
        const px = Math.cos(a) * rad;
        const py = Math.sin(a) * rad;
        if (i === 0) g.moveTo(px, py);
        else g.lineTo(px, py);
      }
      g.closePath();
      g.fill();
      g.restore();
      r.glow(x, y - 12 + bob, 14, withAlpha(palette.accent, 0.5), 0.7);
      r.addLight(x, y - 12, 70, palette.accent, 0.6);
      break;
    }

    case 'npc': {
      // NPCs are drawn as small hooded figures; their identity comes from
      // dialogue and position rather than from distinct art at this scale.
      g.fillStyle = palette.ramp[2];
      g.beginPath();
      g.moveTo(x - 6, y);
      g.quadraticCurveTo(x - 7, y - 14, x - 3, y - 20);
      g.quadraticCurveTo(x, y - 24, x + 3, y - 20);
      g.quadraticCurveTo(x + 7, y - 14, x + 6, y);
      g.closePath();
      g.fill();
      g.fillStyle = palette.accent;
      const blink = Math.sin(time * 1.3 + x) > 0.97 ? 0.2 : 1;
      g.beginPath();
      g.ellipse(x - 1.6, y - 17, 1, 1 * blink, 0, 0, Math.PI * 2);
      g.ellipse(x + 1.6, y - 17, 1, 1 * blink, 0, 0, Math.PI * 2);
      g.fill();
      r.addLight(x, y - 14, 60, palette.accent, 0.35);
      break;
    }

    case 'shop': {
      g.fillStyle = palette.ramp[3];
      g.fillRect(x - 12, y - 10, 24, 10);
      g.fillStyle = palette.accentAlt;
      g.fillRect(x - 12, y - 13, 24, 3);
      g.fillStyle = palette.accent;
      g.beginPath();
      g.arc(x, y - 20, 3, 0, Math.PI * 2);
      g.fill();
      r.addLight(x, y - 16, 80, palette.accent, 0.5);
      break;
    }

    case 'anchor': {
      g.strokeStyle = withAlpha(palette.accentAlt, 0.8);
      g.lineWidth = 1.6;
      g.beginPath();
      g.arc(x, y - 10, 4, 0, Math.PI * 2);
      g.stroke();
      r.addLight(x, y - 10, 40, palette.accentAlt, 0.3);
      break;
    }

    case 'secret': {
      if (item.used) return;
      // Secrets are invisible until revealed; drawn only faintly so a player
      // with Palimpsest can spot them.
      g.globalAlpha = 0.12 + pulse * 0.08;
      g.strokeStyle = palette.accent;
      g.lineWidth = 1;
      g.strokeRect(x - 7, y - 15, 14, 14);
      g.globalAlpha = 1;
      break;
    }

    default: {
      g.fillStyle = withAlpha(palette.ramp[3], 0.9);
      g.fillRect(x - 5, y - 10, 10, 10);
      break;
    }
  }
}
