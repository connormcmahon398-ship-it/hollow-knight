/**
 * @file Parallax backgrounds.
 *
 * ## Why parallax matters here
 * The playable layer is flat-shaded geometry. Without depth behind it, a room
 * reads as a diagram. Parallax is the cheapest way to establish that the world
 * continues past the walls, and it is the main tool for giving each region a
 * *silhouette* — the Spire's distant towers, the Archive's receding shelves —
 * which is what makes regions recognisable from a single screenshot.
 *
 * ## Implementation
 * Layers are generated procedurally from the room's seed, so every room has a
 * background that is unique but stable. Shapes are computed once into a small
 * command list and then drawn with an offset each frame; regenerating geometry
 * per frame would be wasteful, and randomising per frame would strobe.
 */

import { Rng } from '../../engine/core/rng.js';
import { withAlpha, mix, darken } from '../../engine/render/palette.js';

/**
 * @typedef {Object} ParallaxShape
 * @property {number} x @property {number} y
 * @property {number} w @property {number} h
 * @property {number} kind
 */

/**
 * @typedef {Object} ParallaxLayer
 * @property {number} depth Smaller moves less; 0 is infinitely distant.
 * @property {string} color
 * @property {ParallaxShape[]} shapes
 */

const SHAPE = { TOWER: 0, ARCH: 1, SHELF: 2, SPIRE: 3, PIPE: 4, ORB: 5, BONE: 6, GEAR: 7, RAIN: 8 };

export class ParallaxBackground {
  constructor() {
    /** @type {ParallaxLayer[]} */
    this.layers = [];
    this.styleKey = '';
    this.time = 0;
  }

  /**
   * Rebuild for a room. Idempotent for the same key.
   * @param {string} style
   * @param {import('../../engine/render/palette.js').Palette} palette
   * @param {string} seed
   * @param {number} width @param {number} height room pixel size
   */
  build(style, palette, seed, width, height) {
    const key = `${style}:${seed}:${width}x${height}`;
    if (this.styleKey === key) return;
    this.styleKey = key;
    this.layers = [];

    const rng = new Rng(seed);
    // Three depth bands. More layers is diminishing returns and linearly more
    // draw calls; three is enough to read as depth.
    const bands = [
      { depth: 0.12, alpha: 0.30, scale: 1.5 },
      { depth: 0.28, alpha: 0.42, scale: 1.15 },
      { depth: 0.5, alpha: 0.55, scale: 0.9 },
    ];

    for (let b = 0; b < bands.length; b++) {
      const band = bands[b];
      /** @type {ParallaxShape[]} */
      const shapes = [];
      const count = Math.max(4, Math.round((width / 120) * (3 - b)));

      for (let i = 0; i < count; i++) {
        const x = rng.range(-width * 0.3, width * 1.3);
        shapes.push(this._makeShape(style, rng, x, height, band.scale));
      }

      this.layers.push({
        depth: band.depth,
        color: withAlpha(
          mix(palette.sky, palette.ramp[2 + b], 0.35 + b * 0.16),
          band.alpha,
        ),
        shapes,
      });
    }
  }

  /**
   * @param {string} style
   * @param {Rng} rng
   * @param {number} x @param {number} height @param {number} scale
   * @returns {ParallaxShape}
   * @private
   */
  _makeShape(style, rng, x, height, scale) {
    switch (style) {
      case 'sky':
      case 'weir':
        return { x, y: height * rng.range(0.1, 0.5), w: rng.range(20, 46) * scale, h: rng.range(90, 220) * scale, kind: SHAPE.TOWER };
      case 'stacks':
        return { x, y: height * rng.range(0.05, 0.6), w: rng.range(40, 90) * scale, h: rng.range(60, 160) * scale, kind: SHAPE.SHELF };
      case 'prisms':
        return { x, y: height * rng.range(0.3, 0.8), w: rng.range(18, 40) * scale, h: rng.range(50, 130) * scale, kind: SHAPE.SPIRE };
      case 'pipes':
        return { x, y: height * rng.range(0.1, 0.8), w: rng.range(60, 160) * scale, h: rng.range(8, 18) * scale, kind: SHAPE.PIPE };
      case 'bones':
        return { x, y: height * rng.range(0.2, 0.75), w: rng.range(30, 70) * scale, h: rng.range(50, 120) * scale, kind: SHAPE.BONE };
      case 'gears':
        return { x, y: height * rng.range(0.1, 0.8), w: rng.range(30, 80) * scale, h: rng.range(30, 80) * scale, kind: SHAPE.GEAR };
      case 'furnace':
      case 'deep':
        return { x, y: height * rng.range(0.2, 0.8), w: rng.range(20, 50) * scale, h: rng.range(20, 50) * scale, kind: SHAPE.ORB };
      case 'rain':
        return { x, y: height * rng.range(0, 1), w: 1, h: rng.range(10, 26) * scale, kind: SHAPE.RAIN };
      case 'flats':
      default:
        return { x, y: height * rng.range(0.45, 0.85), w: rng.range(50, 140) * scale, h: rng.range(14, 46) * scale, kind: SHAPE.ARCH };
    }
  }

  /**
   * @param {import('../../engine/render/renderer.js').Renderer} renderer
   * @param {import('../../engine/render/camera.js').Camera} camera
   * @param {number} dt
   */
  render(renderer, camera, dt) {
    this.time += dt;
    const g = renderer.g;
    const cam = camera.getRenderTransform();

    for (const layer of this.layers) {
      // A layer at depth d moves at (1-d) of the camera's speed, so distant
      // layers barely shift.
      const offsetX = cam.x * layer.depth;
      const offsetY = cam.y * layer.depth * 0.5;
      g.fillStyle = layer.color;
      g.strokeStyle = layer.color;

      for (const s of layer.shapes) {
        const x = s.x - offsetX;
        const y = s.y - offsetY;
        this._drawShape(g, s, x, y);
      }
    }
  }

  /**
   * @param {CanvasRenderingContext2D} g
   * @param {ParallaxShape} s
   * @param {number} x @param {number} y
   * @private
   */
  _drawShape(g, s, x, y) {
    switch (s.kind) {
      case SHAPE.TOWER:
        g.fillRect(x, y, s.w, s.h);
        g.beginPath();
        g.moveTo(x - 3, y);
        g.lineTo(x + s.w / 2, y - s.w * 0.7);
        g.lineTo(x + s.w + 3, y);
        g.closePath();
        g.fill();
        break;

      case SHAPE.SHELF:
        g.fillRect(x, y, s.w, s.h);
        g.save();
        g.globalAlpha *= 0.5;
        for (let i = 1; i < 5; i++) {
          g.fillRect(x, y + (i * s.h) / 5, s.w, 2);
        }
        g.restore();
        break;

      case SHAPE.SPIRE:
        g.beginPath();
        g.moveTo(x, y + s.h);
        g.lineTo(x + s.w / 2, y);
        g.lineTo(x + s.w, y + s.h);
        g.closePath();
        g.fill();
        break;

      case SHAPE.PIPE:
        g.fillRect(x, y, s.w, s.h);
        g.beginPath();
        g.arc(x, y + s.h / 2, s.h * 0.8, 0, Math.PI * 2);
        g.fill();
        break;

      case SHAPE.BONE:
        g.beginPath();
        g.moveTo(x + s.w * 0.5, y);
        g.quadraticCurveTo(x, y + s.h * 0.5, x + s.w * 0.5, y + s.h);
        g.lineWidth = Math.max(2, s.w * 0.14);
        g.stroke();
        break;

      case SHAPE.GEAR: {
        const r = s.w / 2;
        const teeth = 8;
        g.save();
        g.translate(x + r, y + r);
        g.rotate(this.time * 0.15 + x * 0.01);
        g.beginPath();
        for (let i = 0; i < teeth * 2; i++) {
          const a = (i / (teeth * 2)) * Math.PI * 2;
          const rad = i % 2 === 0 ? r : r * 0.78;
          const px = Math.cos(a) * rad;
          const py = Math.sin(a) * rad;
          if (i === 0) g.moveTo(px, py);
          else g.lineTo(px, py);
        }
        g.closePath();
        g.fill();
        g.restore();
        break;
      }

      case SHAPE.ORB:
        g.beginPath();
        g.arc(x, y, s.w / 2, 0, Math.PI * 2);
        g.fill();
        break;

      case SHAPE.RAIN: {
        // Rain streaks fall continuously and wrap, so a room reads as weather
        // rather than as a static texture.
        const fall = (this.time * 220 + x * 3) % 400;
        g.lineWidth = 1;
        g.beginPath();
        g.moveTo(x, y + fall - 200);
        g.lineTo(x - 2, y + fall - 200 + s.h);
        g.stroke();
        break;
      }

      case SHAPE.ARCH:
      default:
        g.beginPath();
        g.moveTo(x, y + s.h);
        g.quadraticCurveTo(x + s.w / 2, y - s.h * 0.4, x + s.w, y + s.h);
        g.closePath();
        g.fill();
        break;
    }
  }
}
