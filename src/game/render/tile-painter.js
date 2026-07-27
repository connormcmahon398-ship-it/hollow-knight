/**
 * @file Draws the tile world.
 *
 * ## Procedural tiles, cached per room
 * There are no tile images. Each tile is drawn from primitives using the active
 * biome palette, with per-tile deterministic variation so a wall of forty tiles
 * does not look like forty copies of one tile.
 *
 * Drawing that from scratch every frame would be thousands of path operations.
 * Instead the static layers are rendered **once per room** into an offscreen
 * canvas the size of the room and blitted with a single `drawImage`. Rooms are
 * at most a few thousand pixels across, so the memory is trivial and the saving
 * is enormous — the per-frame cost of terrain becomes one draw call.
 *
 * Only genuinely dynamic tiles (crumbling platforms mid-collapse, arena gates,
 * animated fluid surfaces) are drawn live on top.
 *
 * ## Edge-aware drawing
 * A tile is drawn differently depending on its neighbours: exposed top faces
 * get a lit edge, interior tiles get a darker fill, and corners get a bevel.
 * This is what gives flat-shaded terrain a sense of form, and it costs one
 * neighbour lookup per tile at cache-build time.
 */

import { createSurface } from '../../engine/render/renderer.js';
import {
  Tiles, TILE_SIZE, isSolid, isRamp, getTileDef, tileSurfaceHeight,
} from '../../engine/physics/tiles.js';
import { valueNoise2D } from '../../engine/core/rng.js';
import { withAlpha, mix, lighten, darken } from '../../engine/render/palette.js';

export class TilePainter {
  constructor() {
    /** @type {import('../../engine/render/renderer.js').Surface|null} */
    this._cache = null;
    this._cacheKey = '';
    this._cacheW = 0;
    this._cacheH = 0;
    /** Animation clock for fluids and glows. */
    this.time = 0;
  }

  /**
   * Rebuild the static terrain cache. Called on room entry and whenever the
   * geometry changes permanently (a wall broken, a shortcut opened).
   * @param {import('../../engine/physics/tilemap.js').Tilemap} map
   * @param {import('../../engine/render/palette.js').Palette} palette
   * @param {string} key Identity of the current room+state; a change forces a rebuild.
   */
  buildCache(map, palette, key) {
    if (this._cacheKey === key && this._cache) return;

    const w = map.pixelWidth;
    const h = map.pixelHeight;
    if (!this._cache || this._cacheW !== w || this._cacheH !== h) {
      this._cache = createSurface(Math.max(1, w), Math.max(1, h));
      this._cacheW = w;
      this._cacheH = h;
    }

    const g = this._cache.ctx;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, w, h);

    // Background fill first, so gaps read as depth rather than as holes.
    this._paintBackdrop(g, map, palette);

    for (let ty = 0; ty < map.height; ty++) {
      for (let tx = 0; tx < map.width; tx++) {
        const id = map.get(tx, ty);
        if (id === Tiles.EMPTY) continue;
        if (isDynamicTile(id)) continue; // drawn live
        this._paintTile(g, map, palette, tx, ty, id);
      }
    }

    this._cacheKey = key;
  }

  /** Force the next `buildCache` to rebuild even with the same key. */
  invalidate() {
    this._cacheKey = '';
  }

  /**
   * @param {CanvasRenderingContext2D} g
   * @param {import('../../engine/physics/tilemap.js').Tilemap} map
   * @param {import('../../engine/render/palette.js').Palette} palette
   * @private
   */
  _paintBackdrop(g, map, palette) {
    // A soft vertical gradient behind everything, plus faint masonry hinting at
    // structure behind the playable layer.
    const grad = g.createLinearGradient(0, 0, 0, map.pixelHeight);
    grad.addColorStop(0, palette.backdropDeep);
    grad.addColorStop(1, palette.backdrop);
    g.fillStyle = grad;
    g.fillRect(0, 0, map.pixelWidth, map.pixelHeight);

    g.strokeStyle = withAlpha(palette.ramp[2], 0.16);
    g.lineWidth = 1;
    const block = TILE_SIZE * 3;
    for (let y = 0; y < map.pixelHeight; y += block) {
      // Offset alternate courses so it reads as brickwork, not a grid.
      const offset = ((y / block) | 0) % 2 === 0 ? 0 : block / 2;
      for (let x = -block; x < map.pixelWidth + block; x += block) {
        g.strokeRect(x + offset + 0.5, y + 0.5, block, block);
      }
    }
  }

  /**
   * @param {CanvasRenderingContext2D} g
   * @param {import('../../engine/physics/tilemap.js').Tilemap} map
   * @param {import('../../engine/render/palette.js').Palette} palette
   * @param {number} tx @param {number} ty @param {number} id
   * @private
   */
  _paintTile(g, map, palette, tx, ty, id) {
    const ts = TILE_SIZE;
    const x = tx * ts;
    const y = ty * ts;
    const def = getTileDef(id);

    // Deterministic per-tile variation, so terrain has texture without noise
    // that crawls between frames.
    const n = valueNoise2D(tx * 0.7, ty * 0.7, 1337);

    if (def.solid) {
      this._paintSolid(g, map, palette, tx, ty, id, n);
      return;
    }

    switch (id) {
      case Tiles.BACKDROP:
        g.fillStyle = withAlpha(palette.ramp[1], 0.7);
        g.fillRect(x, y, ts, ts);
        g.strokeStyle = withAlpha(palette.ramp[0], 0.5);
        g.strokeRect(x + 0.5, y + 0.5, ts - 1, ts - 1);
        break;

      case Tiles.ONE_WAY: {
        const top = palette.ramp[7];
        g.fillStyle = top;
        g.fillRect(x, y, ts, 4);
        g.fillStyle = withAlpha(palette.ramp[3], 0.85);
        g.fillRect(x, y + 4, ts, 2);
        // Support brackets, so a platform reads as built rather than floating.
        g.fillStyle = withAlpha(palette.ramp[2], 0.7);
        g.fillRect(x + 3, y + 6, 2, 3);
        g.fillRect(x + ts - 5, y + 6, 2, 3);
        break;
      }

      case Tiles.SPIKE:
      case Tiles.SPIKE_HEAVY: {
        const heavy = id === Tiles.SPIKE_HEAVY;
        const count = heavy ? 3 : 4;
        const w = ts / count;
        g.fillStyle = heavy ? palette.accentAlt : palette.ramp[8];
        for (let i = 0; i < count; i++) {
          g.beginPath();
          g.moveTo(x + i * w, y + ts);
          g.lineTo(x + i * w + w / 2, y + (heavy ? 1 : 3));
          g.lineTo(x + (i + 1) * w, y + ts);
          g.closePath();
          g.fill();
        }
        g.fillStyle = withAlpha(palette.ramp[3], 0.9);
        g.fillRect(x, y + ts - 3, ts, 3);
        break;
      }

      case Tiles.LADDER:
      case Tiles.LADDER_TOP:
        g.strokeStyle = palette.ramp[6];
        g.lineWidth = 2;
        g.beginPath();
        g.moveTo(x + 3.5, y);
        g.lineTo(x + 3.5, y + ts);
        g.moveTo(x + ts - 3.5, y);
        g.lineTo(x + ts - 3.5, y + ts);
        g.stroke();
        g.lineWidth = 1.5;
        g.beginPath();
        g.moveTo(x + 3, y + 5.5);
        g.lineTo(x + ts - 3, y + 5.5);
        g.moveTo(x + 3, y + 12.5);
        g.lineTo(x + ts - 3, y + 12.5);
        g.stroke();
        break;

      case Tiles.UPDRAFT:
        // Drawn faintly here; the animated streaks are added live.
        g.fillStyle = withAlpha(palette.accent, 0.06);
        g.fillRect(x, y, ts, ts);
        break;

      default:
        break;
    }
  }

  /**
   * @param {CanvasRenderingContext2D} g
   * @param {import('../../engine/physics/tilemap.js').Tilemap} map
   * @param {import('../../engine/render/palette.js').Palette} palette
   * @param {number} tx @param {number} ty @param {number} id @param {number} n
   * @private
   */
  _paintSolid(g, map, palette, tx, ty, id, n) {
    const ts = TILE_SIZE;
    const x = tx * ts;
    const y = ty * ts;
    const def = getTileDef(id);

    const openAbove = !isSolid(map.get(tx, ty - 1));
    const openBelow = !isSolid(map.get(tx, ty + 1));
    const openLeft = !isSolid(map.get(tx - 1, ty));
    const openRight = !isSolid(map.get(tx + 1, ty));
    const exposed = openAbove || openBelow || openLeft || openRight;

    // Interior tiles are darker; exposed tiles catch light. This single rule
    // does most of the work of making flat terrain look three-dimensional.
    let base = exposed ? palette.ramp[4 + Math.round(n * 1.5)] : palette.ramp[1];
    if (id === Tiles.ICE) base = mix(base, '#bfe8ff', 0.55);
    else if (id === Tiles.TAR) base = mix(base, '#14100c', 0.6);
    else if (id === Tiles.BREAKABLE || id === Tiles.BREAKABLE_HEAVY) base = mix(base, palette.accentAlt, 0.22);
    else if (id === Tiles.CRUMBLE) base = mix(base, palette.accent, 0.14);
    else if (id === Tiles.SOLID_ALT) base = mix(base, palette.accentAlt, 0.18);
    else if (id === Tiles.PHASE_WALL) base = mix(base, palette.accent, 0.3);

    if (isRamp(id) && id !== Tiles.SOLID && id !== Tiles.SOLID_ALT) {
      // Ramps are drawn as the polygon under their surface function, so the
      // visual and the collision are guaranteed to agree.
      const hL = tileSurfaceHeight(id, 0);
      const hR = tileSurfaceHeight(id, 1);
      g.fillStyle = base;
      g.beginPath();
      g.moveTo(x, y + ts - hL * ts);
      g.lineTo(x + ts, y + ts - hR * ts);
      g.lineTo(x + ts, y + ts);
      g.lineTo(x, y + ts);
      g.closePath();
      g.fill();
      g.strokeStyle = palette.edgeLight;
      g.lineWidth = 1.5;
      g.beginPath();
      g.moveTo(x, y + ts - hL * ts);
      g.lineTo(x + ts, y + ts - hR * ts);
      g.stroke();
      return;
    }

    g.fillStyle = base;
    g.fillRect(x, y, ts, ts);

    // Lit top edge.
    if (openAbove) {
      g.fillStyle = palette.edgeLight;
      g.fillRect(x, y, ts, 2);
      g.fillStyle = withAlpha(lighten(base, 0.05), 0.6);
      g.fillRect(x, y + 2, ts, 2);
    }
    // Shaded underside.
    if (openBelow) {
      g.fillStyle = withAlpha(palette.shadow, 0.75);
      g.fillRect(x, y + ts - 3, ts, 3);
    }
    // Side bevels.
    if (openLeft) {
      g.fillStyle = withAlpha(darken(base, 0.03), 0.7);
      g.fillRect(x, y, 2, ts);
    }
    if (openRight) {
      g.fillStyle = withAlpha(palette.shadow, 0.5);
      g.fillRect(x + ts - 2, y, 2, ts);
    }

    // Surface detail: a few deterministic speckles and a crack or two.
    if (exposed) {
      g.fillStyle = withAlpha(palette.shadow, 0.3);
      const dots = 2 + ((tx * 7 + ty * 13) % 3);
      for (let i = 0; i < dots; i++) {
        const dx = ((tx * 31 + ty * 17 + i * 41) % (ts - 4)) + 2;
        const dy = ((tx * 13 + ty * 29 + i * 53) % (ts - 4)) + 2;
        g.fillRect(x + dx, y + dy, 1, 1);
      }
    }

    // Type-specific overlays.
    if (id === Tiles.BREAKABLE || id === Tiles.BREAKABLE_HEAVY) {
      g.strokeStyle = withAlpha(palette.accent, id === Tiles.BREAKABLE_HEAVY ? 0.75 : 0.5);
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(x + 3, y + 3);
      g.lineTo(x + ts - 5, y + 7);
      g.lineTo(x + 6, y + ts - 4);
      g.stroke();
    } else if (id === Tiles.CONVEYOR_R || id === Tiles.CONVEYOR_L) {
      const dir = id === Tiles.CONVEYOR_R ? 1 : -1;
      g.strokeStyle = palette.accent;
      g.lineWidth = 1.5;
      for (let i = 0; i < 2; i++) {
        const ax = x + 4 + i * 7;
        g.beginPath();
        g.moveTo(ax, y + 4);
        g.lineTo(ax + 4 * dir, y + 8);
        g.lineTo(ax, y + 12);
        g.stroke();
      }
    } else if (id === Tiles.PHASE_WALL) {
      g.strokeStyle = withAlpha(palette.accent, 0.55);
      g.setLineDash([3, 3]);
      g.strokeRect(x + 1.5, y + 1.5, ts - 3, ts - 3);
      g.setLineDash([]);
    }
  }

  /**
   * Blit the cached terrain, then draw everything animated on top.
   * @param {import('../../engine/render/renderer.js').Renderer} renderer
   * @param {import('../../engine/physics/tilemap.js').Tilemap} map
   * @param {import('../../engine/render/palette.js').Palette} palette
   * @param {import('../../engine/render/camera.js').Camera} camera
   * @param {number} dt
   */
  render(renderer, map, palette, camera, dt) {
    this.time += dt;
    if (this._cache) {
      renderer.g.drawImage(this._cache.canvas, 0, 0);
    }
    this._renderDynamic(renderer, map, palette, camera);
  }

  /**
   * @param {import('../../engine/render/renderer.js').Renderer} renderer
   * @param {import('../../engine/physics/tilemap.js').Tilemap} map
   * @param {import('../../engine/render/palette.js').Palette} palette
   * @param {import('../../engine/render/camera.js').Camera} camera
   * @private
   */
  _renderDynamic(renderer, map, palette, camera) {
    const view = camera.getViewBounds(TILE_SIZE * 2);
    const ts = TILE_SIZE;
    const tx0 = Math.max(0, Math.floor(view.x / ts));
    const tx1 = Math.min(map.width - 1, Math.floor(view.right / ts));
    const ty0 = Math.max(0, Math.floor(view.y / ts));
    const ty1 = Math.min(map.height - 1, Math.floor(view.bottom / ts));
    const g = renderer.g;

    for (let ty = ty0; ty <= ty1; ty++) {
      for (let tx = tx0; tx <= tx1; tx++) {
        const id = map.get(tx, ty);
        if (!isDynamicTile(id)) continue;
        const x = tx * ts;
        const y = ty * ts;

        switch (id) {
          case Tiles.WATER:
          case Tiles.AETHER:
          case Tiles.BRINE:
          case Tiles.SEAR: {
            const def = getTileDef(id);
            const surface = !getTileDef(map.get(tx, ty - 1)).fluid;
            let tint = palette.fluid;
            if (id === Tiles.AETHER) tint = mix(palette.fluid, palette.accent, 0.4);
            else if (id === Tiles.BRINE) tint = mix(palette.fluid, '#7fdc9f', 0.4);
            else if (id === Tiles.SEAR) tint = mix('#ff5a20', palette.accent, 0.3);

            g.fillStyle = withAlpha(tint, 0.55);
            g.fillRect(x, y, ts, ts);

            if (surface) {
              // An animated surface line sells the fluid far more cheaply than
              // any per-pixel effect.
              const wave = Math.sin(this.time * 2 + tx * 0.6) * 1.6;
              g.fillStyle = withAlpha(lighten(tint, 0.16), 0.85);
              g.fillRect(x, y + wave, ts, 2);
            }
            break;
          }

          case Tiles.UPDRAFT: {
            g.strokeStyle = withAlpha(palette.accent, 0.35);
            g.lineWidth = 1;
            for (let i = 0; i < 3; i++) {
              const phase = (this.time * 60 + i * 26 + tx * 11) % (ts * 2);
              const sy = y + ts - phase;
              if (sy < y - ts || sy > y + ts) continue;
              const sx = x + 3 + i * 5;
              g.beginPath();
              g.moveTo(sx, sy);
              g.lineTo(sx, sy - 6);
              g.stroke();
            }
            break;
          }

          case Tiles.GATE: {
            // Arena seals: obviously artificial, obviously temporary.
            g.fillStyle = withAlpha(palette.accentAlt, 0.5);
            g.fillRect(x, y, ts, ts);
            g.strokeStyle = withAlpha(palette.accent, 0.85);
            g.lineWidth = 1;
            const pulse = 0.5 + 0.5 * Math.sin(this.time * 5 + ty * 0.5);
            g.globalAlpha = 0.4 + pulse * 0.5;
            g.strokeRect(x + 1.5, y + 1.5, ts - 3, ts - 3);
            g.globalAlpha = 1;
            break;
          }

          case Tiles.CRUMBLE: {
            const state = map.tileState.get(ty * map.width + tx);
            if (state?.timer !== undefined && state.timer < 1) {
              // Shake as it is about to give way.
              const shake = (1 - state.timer) * 2;
              g.save();
              g.translate(
                Math.sin(this.time * 40) * shake,
                Math.cos(this.time * 37) * shake,
              );
              g.fillStyle = mix(palette.ramp[4], palette.accent, 0.3);
              g.fillRect(x, y, ts, ts);
              g.restore();
            }
            break;
          }

          default:
            break;
        }
      }
    }
    g.globalAlpha = 1;
  }
}

/**
 * @param {number} id
 * @returns {boolean} true for tiles that must be drawn live each frame
 */
function isDynamicTile(id) {
  return id === Tiles.WATER || id === Tiles.AETHER || id === Tiles.BRINE
    || id === Tiles.SEAR || id === Tiles.UPDRAFT || id === Tiles.GATE
    || id === Tiles.CRUMBLE;
}
