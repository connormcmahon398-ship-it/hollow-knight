/**
 * @file The heads-up display.
 *
 * ## Design rule: the HUD is for what changes
 * Everything permanently true (your abilities, your equipment) lives in menus.
 * The HUD shows only state that changes moment to moment and that you must react
 * to: health, ink, currency, and the boss you are currently fighting.
 *
 * It is drawn in screen space after post-processing, so it stays crisp and
 * unvignetted while the world behind it is graded.
 *
 * ## Readability under pressure
 * Health is discrete pips rather than a bar, because in a five-hit game the
 * exact count matters and a bar makes you estimate. Ink is a bar because its
 * absolute value matters less than "have I got enough for a heal", which a
 * threshold marker answers at a glance.
 */

import { withAlpha, mix } from '../../engine/render/palette.js';
import { clamp } from '../../engine/math/math-utils.js';
import { MovementConfig } from '../player/movement-config.js';
import { FONT_STACK } from '../../engine/render/renderer.js';

export class HUD {
  constructor() {
    this.time = 0;
    /** Smoothed ink value, so the bar animates rather than jumping. */
    this._displayInk = 0;
    /** Toast messages queued for display. @type {{text: string, sub: string, life: number, max: number}[]} */
    this.toasts = [];
    /** Region title card. @type {{name: string, subtitle: string, life: number}|null} */
    this.titleCard = null;
    /** Boss bar state, eased so a phase change reads as a drop rather than a cut. */
    this._bossDisplay = 1;
    this._bossChip = 1;
  }

  /**
   * @param {string} text
   * @param {string} [sub]
   * @param {number} [duration]
   */
  toast(text, sub = '', duration = 3.2) {
    this.toasts.push({ text, sub, life: duration, max: duration });
    if (this.toasts.length > 4) this.toasts.shift();
  }

  /**
   * @param {string} name @param {string} subtitle
   */
  showTitleCard(name, subtitle) {
    this.titleCard = { name, subtitle, life: 4.2 };
  }

  /**
   * @param {number} dt
   * @param {import('../player/player.js').Player} player
   * @param {any} boss
   */
  update(dt, player, boss) {
    this.time += dt;
    this._displayInk += (player.ink - this._displayInk) * Math.min(1, dt * 9);

    for (let i = this.toasts.length - 1; i >= 0; i--) {
      this.toasts[i].life -= dt;
      if (this.toasts[i].life <= 0) this.toasts.splice(i, 1);
    }
    if (this.titleCard) {
      this.titleCard.life -= dt;
      if (this.titleCard.life <= 0) this.titleCard = null;
    }

    if (boss && boss.encounterActive) {
      const target = boss.healthFraction;
      // Two bars: the front one tracks immediately, the "chip" bar lags, so a
      // burst of damage is legible as a chunk taken rather than a jump.
      this._bossDisplay = target;
      this._bossChip += (target - this._bossChip) * Math.min(1, dt * 2.4);
    } else {
      this._bossChip = 1;
      this._bossDisplay = 1;
    }
  }

  /**
   * @param {import('../../engine/render/renderer.js').Renderer} r
   * @param {import('../player/player.js').Player} player
   * @param {any} boss
   * @param {any} world
   */
  render(r, player, boss, world) {
    const p = r.palette;
    this._drawHealth(r, player, p);
    this._drawInk(r, player, p);
    this._drawGlyphs(r, player, p);
    if (boss && boss.encounterActive) this._drawBossBar(r, boss, p);
    this._drawToasts(r, p);
    this._drawTitleCard(r, p);
    this._drawInteractPrompt(r, world, p);
  }

  /**
   * @param {import('../../engine/render/renderer.js').Renderer} r
   * @param {import('../player/player.js').Player} player
   * @param {any} p
   * @private
   */
  _drawHealth(r, player, p) {
    const x = 10;
    const y = 9;
    const size = 8;
    const gap = 3;
    const g = r.g;

    for (let i = 0; i < player.health.max; i++) {
      const filled = i < player.health.current;
      const cx = x + i * (size + gap) + size / 2;
      const cy = y + size / 2;

      // Filaments: brass rings that snap when spent. Empty ones stay visible so
      // the player always knows their maximum.
      g.strokeStyle = filled ? '#e8d4a0' : withAlpha('#e8d4a0', 0.22);
      g.lineWidth = 1.4;
      g.beginPath();
      g.arc(cx, cy, size / 2, 0, Math.PI * 2);
      g.stroke();

      if (filled) {
        // The last filament pulses, which is the clearest possible warning.
        const pulse = player.health.current === 1
          ? 0.55 + 0.45 * Math.sin(this.time * 7)
          : 1;
        g.globalAlpha = pulse;
        g.fillStyle = player.health.current === 1 ? '#ff8080' : '#f0e0b8';
        g.beginPath();
        g.arc(cx, cy, size / 2 - 2, 0, Math.PI * 2);
        g.fill();
        g.globalAlpha = 1;
      } else {
        // A broken filament: two short strokes where the ring parted.
        g.strokeStyle = withAlpha('#e8d4a0', 0.3);
        g.lineWidth = 1;
        g.beginPath();
        g.moveTo(cx - 2, cy - 2);
        g.lineTo(cx + 2, cy + 2);
        g.stroke();
      }
    }

    // Recent-damage flash behind the pips.
    if (player.hurtFlashTimer > 0) {
      g.globalAlpha = player.hurtFlashTimer * 0.5;
      g.fillStyle = '#ff5566';
      g.fillRect(x - 3, y - 3, player.health.max * (size + gap) + 4, size + 6);
      g.globalAlpha = 1;
    }
  }

  /**
   * @param {import('../../engine/render/renderer.js').Renderer} r
   * @param {import('../player/player.js').Player} player
   * @param {any} p
   * @private
   */
  _drawInk(r, player, p) {
    const x = 10;
    const y = 22;
    const w = 46;
    const h = 5;
    const g = r.g;

    g.fillStyle = withAlpha('#000000', 0.45);
    g.fillRect(x - 1, y - 1, w + 2, h + 2);

    const frac = clamp(this._displayInk / player.maxInk, 0, 1);
    const grad = g.createLinearGradient(x, y, x + w, y);
    grad.addColorStop(0, '#2f6f9f');
    grad.addColorStop(1, '#8fd0ff');
    g.fillStyle = grad;
    g.fillRect(x, y, w * frac, h);

    // Threshold ticks at each heal's worth of ink: the only reading of this bar
    // that matters mid-fight is "how many heals do I have".
    const perHeal = MovementConfig.focusCost / player.maxInk;
    g.fillStyle = withAlpha('#ffffff', 0.5);
    for (let t = perHeal; t < 1; t += perHeal) {
      g.fillRect(x + w * t, y, 1, h);
    }

    g.strokeStyle = withAlpha('#8fd0ff', 0.5);
    g.lineWidth = 1;
    g.strokeRect(x - 0.5, y - 0.5, w + 1, h + 1);
  }

  /**
   * @param {import('../../engine/render/renderer.js').Renderer} r
   * @param {import('../player/player.js').Player} player
   * @param {any} p
   * @private
   */
  _drawGlyphs(r, player, p) {
    r.text(`${player.glyphs}`, r.width - 10, 10, {
      color: '#e8d4a0',
      size: 8,
      align: 'right',
      shadow: '#000000',
      font: FONT_STACK,
    });
    // A small mark standing in for the currency's icon.
    const gx = r.width - 10 - r.measureText(`${player.glyphs}`, 8) - 8;
    r.g.strokeStyle = '#e8d4a0';
    r.g.lineWidth = 1.2;
    r.g.beginPath();
    r.g.moveTo(gx, 17);
    r.g.lineTo(gx + 5, 11);
    r.g.lineTo(gx + 2, 17);
    r.g.stroke();
  }

  /**
   * @param {import('../../engine/render/renderer.js').Renderer} r
   * @param {any} boss
   * @param {any} p
   * @private
   */
  _drawBossBar(r, boss, p) {
    const w = Math.min(230, r.width - 60);
    const x = (r.width - w) / 2;
    const y = r.height - 26;
    const h = 6;
    const g = r.g;

    r.text(boss.name.toUpperCase(), r.width / 2, y - 15, {
      color: '#f0e4d0', size: 8, align: 'center', shadow: '#000000', letterSpacing: 1,
    });
    r.text(boss.title, r.width / 2, y - 6, {
      color: withAlpha('#f0e4d0', 0.6), size: 6, align: 'center', shadow: '#000000',
    });

    g.fillStyle = withAlpha('#000000', 0.6);
    g.fillRect(x - 2, y - 2, w + 4, h + 4);

    // Chip bar behind, current bar in front.
    g.fillStyle = withAlpha('#ff6060', 0.55);
    g.fillRect(x, y, w * clamp(this._bossChip, 0, 1), h);
    g.fillStyle = mix('#ffd070', '#ff5050', 1 - this._bossDisplay);
    g.fillRect(x, y, w * clamp(this._bossDisplay, 0, 1), h);

    // Phase thresholds, so the player can see the fight's shape.
    g.fillStyle = withAlpha('#000000', 0.6);
    for (const phase of boss.bossDef.phases) {
      if (phase.healthThreshold >= 1) continue;
      g.fillRect(x + w * phase.healthThreshold, y - 1, 1, h + 2);
    }

    g.strokeStyle = withAlpha('#f0e4d0', 0.55);
    g.lineWidth = 1;
    g.strokeRect(x - 0.5, y - 0.5, w + 1, h + 1);
  }

  /**
   * @param {import('../../engine/render/renderer.js').Renderer} r
   * @param {any} p
   * @private
   */
  _drawToasts(r, p) {
    let y = 44;
    for (const t of this.toasts) {
      // Fade in quickly, hold, fade out.
      const age = t.max - t.life;
      const alpha = clamp(Math.min(age / 0.25, t.life / 0.6), 0, 1);
      r.text(t.text, 10, y, {
        color: '#f0e4d0', size: 8, alpha, shadow: '#000000',
      });
      if (t.sub) {
        r.text(t.sub, 10, y + 9, {
          color: withAlpha('#f0e4d0', 0.65), size: 6, alpha, shadow: '#000000',
        });
        y += 9;
      }
      y += 12;
    }
  }

  /**
   * @param {import('../../engine/render/renderer.js').Renderer} r
   * @param {any} p
   * @private
   */
  _drawTitleCard(r, p) {
    if (!this.titleCard) return;
    const card = this.titleCard;
    // Fade in over the first half second, hold, fade out over the last second.
    const age = 4.2 - card.life;
    const alpha = clamp(Math.min(age / 0.6, card.life / 1.1), 0, 1);
    const cy = r.height * 0.34;

    r.text(card.name.toUpperCase(), r.width / 2, cy, {
      color: '#f4ead6', size: 15, align: 'center', baseline: 'middle',
      alpha, shadow: '#000000', letterSpacing: 2,
    });
    r.text(card.subtitle, r.width / 2, cy + 15, {
      color: withAlpha('#f4ead6', 0.7), size: 7, align: 'center', baseline: 'middle',
      alpha, shadow: '#000000',
    });

    const lineW = 60 * alpha;
    r.g.strokeStyle = withAlpha('#f4ead6', alpha * 0.5);
    r.g.lineWidth = 1;
    r.g.beginPath();
    r.g.moveTo(r.width / 2 - lineW, cy + 26);
    r.g.lineTo(r.width / 2 + lineW, cy + 26);
    r.g.stroke();
  }

  /**
   * @param {import('../../engine/render/renderer.js').Renderer} r
   * @param {any} world
   * @param {any} p
   * @private
   */
  _drawInteractPrompt(r, world, p) {
    const item = world?.nearestInteractable?.();
    if (!item) return;
    const label = INTERACT_LABELS[item.kind] ?? 'Examine';
    const bob = Math.sin(this.time * 4) * 1.5;
    r.text(`${label}`, r.width / 2, r.height - 40 + bob, {
      color: '#f0e4d0', size: 7, align: 'center', shadow: '#000000',
    });
  }
}

/** @type {Record<string, string>} */
const INTERACT_LABELS = {
  checkpoint: 'Rest at the Wellspring',
  gate: 'Attune the Gatestone',
  inscription: 'Transcribe',
  npc: 'Speak',
  item: 'Take',
  shop: 'Trade',
  door: 'Open',
  secret: 'Examine',
  prop: 'Examine',
};
