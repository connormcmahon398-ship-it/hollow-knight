/**
 * @file The map screen and fast travel.
 *
 * ## Why the map is drawn from room metadata, not from tiles
 * A pixel-accurate minimap of a tile world is expensive to build and, at map
 * scale, unreadable. What the player actually needs is *topology*: which rooms
 * connect to which, where they are relative to each other, and which ones they
 * have not fully explored. Each room declares a position on a coarse world grid,
 * and the map draws boxes and links from that.
 *
 * The consequence — and it is a feature — is that the map is legible at a
 * glance and cheap enough to redraw every frame while the player pans it.
 *
 * ## Fog of war
 * Rooms are drawn only once visited. Rooms adjacent to a visited room are drawn
 * as faint outlines, so the map suggests where to go next without giving it
 * away.
 */

import { ROOM_DEFS } from '../world/room.js';
import { getBiome } from '../content/biomes.js';
import { withAlpha, mix } from '../../engine/render/palette.js';
import { clamp, damp } from '../../engine/math/math-utils.js';
import { Action } from '../../engine/input/input.js';
import { Events } from '../../engine/core/events.js';

/** Pixels per world-grid unit on the map screen. */
const CELL = 12;

export class MapSystem {
  /**
   * @param {Partial<import('../context.js').GameContext>} ctx
   */
  constructor(ctx) {
    this.ctx = ctx;
    /** Rooms the player has entered. @type {Set<string>} */
    this.visited = new Set();
    /** Gatestones attuned, usable as fast-travel destinations. @type {Set<string>} */
    this.gates = new Set();

    this.panX = 0;
    this.panY = 0;
    this._targetPanX = 0;
    this._targetPanY = 0;
    this.zoom = 1;

    /** Index into the fast-travel list when the map is open at a gate. */
    this.travelIndex = 0;
    this.canFastTravel = false;

    ctx.bus?.on(Events.FAST_TRAVEL_USED, (e) => {
      this.gates.add(e.gate);
    });
  }

  /**
   * @param {import('../world/room.js').Room} room
   */
  visit(room) {
    this.visited.add(room.id);
    // Centre the view on the newly entered room.
    this._targetPanX = -room.worldX * CELL;
    this._targetPanY = -room.worldY * CELL;
  }

  /**
   * @param {number} dt
   * @param {import('../../engine/input/input.js').InputManager} input
   */
  updateScreen(dt, input) {
    const speed = 140 * dt;
    this._targetPanX -= input.axisX * speed;
    this._targetPanY -= input.axisY * speed;
    this.panX = damp(this.panX, this._targetPanX, 12, dt);
    this.panY = damp(this.panY, this._targetPanY, 12, dt);

    const world = this.ctx.world;
    const atGate = world?.interactables?.some(
      (i) => i.kind === 'gate' && i.used,
    ) ?? false;
    this.canFastTravel = atGate && this.gates.size > 1;

    if (this.canFastTravel) {
      const list = [...this.gates];
      if (input.consume(Action.LEFT)) this.travelIndex = (this.travelIndex - 1 + list.length) % list.length;
      if (input.consume(Action.RIGHT)) this.travelIndex = (this.travelIndex + 1) % list.length;
      if (input.consume(Action.CONFIRM)) {
        this.ctx.bus?.queue('fasttravel:go', { gate: list[this.travelIndex] });
      }
    }
  }

  /**
   * @param {import('../../engine/render/renderer.js').Renderer} r
   */
  renderScreen(r) {
    const g = r.g;
    const p = r.palette;

    g.fillStyle = 'rgba(6,8,12,0.92)';
    g.fillRect(0, 0, r.width, r.height);

    const cx = r.width / 2 + this.panX;
    const cy = r.height / 2 + this.panY;

    // Connections first, so room boxes draw over them.
    g.strokeStyle = withAlpha('#8fa8c0', 0.3);
    g.lineWidth = 1;
    for (const def of ROOM_DEFS.values()) {
      if (!this.visited.has(def.id)) continue;
      for (const exit of def.exits ?? []) {
        const other = ROOM_DEFS.get(exit.to);
        if (!other) continue;
        g.beginPath();
        g.moveTo(cx + (def.worldX ?? 0) * CELL, cy + (def.worldY ?? 0) * CELL);
        g.lineTo(cx + (other.worldX ?? 0) * CELL, cy + (other.worldY ?? 0) * CELL);
        g.stroke();
      }
    }

    // Unvisited neighbours: hinted, not revealed.
    for (const def of ROOM_DEFS.values()) {
      if (this.visited.has(def.id)) continue;
      const adjacent = [...this.visited].some((v) => {
        const vd = ROOM_DEFS.get(v);
        return vd?.exits?.some((e) => e.to === def.id);
      });
      if (!adjacent) continue;
      const x = cx + (def.worldX ?? 0) * CELL;
      const y = cy + (def.worldY ?? 0) * CELL;
      g.strokeStyle = withAlpha('#8fa8c0', 0.22);
      g.setLineDash([2, 2]);
      g.strokeRect(x - 4, y - 3, 8, 6);
      g.setLineDash([]);
    }

    // Visited rooms.
    const currentId = this.ctx.world?.room?.id;
    for (const def of ROOM_DEFS.values()) {
      if (!this.visited.has(def.id)) continue;
      const biome = getBiome(def.biome);
      const x = cx + (def.worldX ?? 0) * CELL;
      const y = cy + (def.worldY ?? 0) * CELL;
      const w = 9;
      const h = 7;

      g.fillStyle = withAlpha(biome.palette.ramp[5], def.id === currentId ? 0.95 : 0.6);
      g.fillRect(x - w / 2, y - h / 2, w, h);
      g.strokeStyle = withAlpha(biome.palette.accent, 0.7);
      g.lineWidth = 1;
      g.strokeRect(x - w / 2 + 0.5, y - h / 2 + 0.5, w - 1, h - 1);

      if (def.isBossArena) {
        g.fillStyle = '#ff8080';
        g.fillRect(x - 1.5, y - 1.5, 3, 3);
      }
    }

    // The player's position, pulsing so it is findable instantly.
    if (currentId) {
      const def = ROOM_DEFS.get(currentId);
      if (def) {
        const x = cx + (def.worldX ?? 0) * CELL;
        const y = cy + (def.worldY ?? 0) * CELL;
        g.fillStyle = '#ffffff';
        g.beginPath();
        g.arc(x, y, 2.2, 0, Math.PI * 2);
        g.fill();
        r.glow(x, y, 10, withAlpha('#8fd0ff', 0.6), 0.7);
      }
    }

    // Header and legend.
    const room = this.ctx.world?.room;
    r.text(room ? getBiome(room.biome).name.toUpperCase() : 'MAP', r.width / 2, 12, {
      color: '#f4ead6', size: 9, align: 'center', letterSpacing: 2,
    });
    r.text(room?.name ?? '', r.width / 2, 24, {
      color: 'rgba(244,234,214,0.6)', size: 6, align: 'center',
    });
    r.text(`${this.visited.size} chambers recorded`, 8, r.height - 18, {
      color: 'rgba(244,234,214,0.5)', size: 6,
    });

    if (this.canFastTravel) {
      const list = [...this.gates];
      const target = list[this.travelIndex] ?? '—';
      r.text(`< ${target} >   ENTER to travel`, r.width / 2, r.height - 18, {
        color: '#f0e4d0', size: 7, align: 'center',
      });
    } else {
      r.text('M or ESC to close', r.width - 8, r.height - 18, {
        color: 'rgba(244,234,214,0.5)', size: 6, align: 'right',
      });
    }
  }

  /** @returns {object} */
  toJSON() {
    return { visited: [...this.visited], gates: [...this.gates] };
  }

  /** @param {any} data */
  load(data) {
    if (!data) return;
    this.visited = new Set(data.visited ?? []);
    this.gates = new Set(data.gates ?? []);
  }
}
