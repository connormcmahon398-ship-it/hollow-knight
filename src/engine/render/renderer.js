/**
 * @file Canvas2D renderer.
 *
 * ## Why Canvas2D and not WebGL?
 * The art direction here is procedural vector-and-shape drawing: silhouettes,
 * gradients, strokes, soft glows. Canvas2D is *built* for that and does it in a
 * few lines per shape. WebGL would mean writing a batching sprite pipeline, a
 * shader set, and a text renderer before drawing a single pixel, to accelerate a
 * workload that is not GPU-bound. The scene is a few hundred draw calls; the
 * budget is comfortable.
 *
 * Where Canvas2D genuinely is slow — per-pixel post-processing — the renderer
 * uses cheap approximations (composite-mode overlays, cached gradients) rather
 * than pixel loops.
 *
 * ## Internal resolution and scaling
 * The game renders at a fixed internal resolution and is then scaled to fit the
 * window. This keeps the composition identical on every display, makes the
 * procedural line weights consistent, and means the "camera shows N tiles"
 * design constraint holds everywhere. Scaling uses whole-number factors when
 * one is available, because non-integer scaling of crisp geometry shimmers.
 *
 * ## Layers
 * Rather than a general z-sorted scene graph — overkill for a game whose draw
 * order is authored, not emergent — the renderer exposes named layers drawn in a
 * fixed sequence. A layer is either drawn directly to the main target or into an
 * offscreen buffer when it needs to be composited (lighting, for example, must
 * be multiplied over the scene).
 */

import { NEUTRAL_PALETTE } from './palette.js';
import { clamp } from '../math/math-utils.js';

/** Fixed internal resolution. 16:9, chosen so a room shows ~30x17 tiles. */
export const INTERNAL_WIDTH = 480;
export const INTERNAL_HEIGHT = 270;

/**
 * Font stack. Deliberately generic families only — no bundled or named
 * third-party typeface — so the game carries no font licensing weight.
 */
export const FONT_STACK = 'ui-monospace, "DejaVu Sans Mono", "Courier New", monospace';
export const FONT_STACK_DISPLAY = 'ui-serif, Georgia, "Times New Roman", serif';

export class Renderer {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {object} [options]
   * @param {number} [options.width] internal width
   * @param {number} [options.height] internal height
   */
  constructor(canvas, options = {}) {
    this.canvas = canvas;
    this.width = options.width ?? INTERNAL_WIDTH;
    this.height = options.height ?? INTERNAL_HEIGHT;

    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('Renderer: 2D context unavailable');
    /** @type {CanvasRenderingContext2D} */
    this.ctx = ctx;

    /**
     * Offscreen buffer the scene is composed into at internal resolution, then
     * blitted to the visible canvas. Rendering directly to a scaled canvas would
     * force every draw call through the scale transform and blur the geometry.
     */
    this.buffer = createSurface(this.width, this.height);
    /** Lighting accumulation buffer, composited multiplicatively. */
    this.lightBuffer = createSurface(this.width, this.height);

    /** @type {import('./palette.js').Palette} */
    this.palette = NEUTRAL_PALETTE;

    /** Current camera transform, set by `beginWorld`. */
    this._camX = 0;
    this._camY = 0;
    this._zoom = 1;
    this._inWorld = false;

    /** Full-screen colour flash, e.g. on taking damage. */
    this.flashColor = '#ffffff';
    this.flashAmount = 0;

    /** 0 disables the vignette; 1 is heavy. */
    this.vignetteStrength = 0.55;
    /** Film-grain-style noise intensity. */
    this.grainStrength = 0.03;
    /** Chromatic aberration in pixels at the screen edge. */
    this.aberration = 0;

    this._grainOffset = 0;
    /** @type {CanvasGradient|null} */
    this._vignetteCache = null;
    this._vignetteKey = '';

    this.displayScale = 1;
    this.offsetX = 0;
    this.offsetY = 0;

    /** Draw-call counter, reset each frame; surfaced by the debug overlay. */
    this.drawCalls = 0;
  }

  /**
   * Size the visible canvas to its container and compute the display scale.
   * @param {number} cssWidth
   * @param {number} cssHeight
   * @param {number} [dpr]
   */
  resize(cssWidth, cssHeight, dpr = 1) {
    const pixelW = Math.max(1, Math.floor(cssWidth * dpr));
    const pixelH = Math.max(1, Math.floor(cssHeight * dpr));
    if (this.canvas.width !== pixelW || this.canvas.height !== pixelH) {
      this.canvas.width = pixelW;
      this.canvas.height = pixelH;
    }

    // Prefer an integer scale so crisp geometry stays crisp; fall back to
    // fractional only when the window is too small for 1x.
    const rawScale = Math.min(pixelW / this.width, pixelH / this.height);
    this.displayScale = rawScale >= 1 ? Math.floor(rawScale) : rawScale;
    if (this.displayScale <= 0) this.displayScale = rawScale;

    this.offsetX = Math.floor((pixelW - this.width * this.displayScale) / 2);
    this.offsetY = Math.floor((pixelH - this.height * this.displayScale) / 2);
  }

  /** @returns {CanvasRenderingContext2D} the buffer context everything draws into */
  get g() {
    return this.buffer.ctx;
  }

  /**
   * Begin a frame: clear the buffers.
   * @param {string} [clearColor]
   */
  beginFrame(clearColor) {
    this.drawCalls = 0;
    const g = this.buffer.ctx;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalAlpha = 1;
    g.globalCompositeOperation = 'source-over';
    g.fillStyle = clearColor ?? this.palette.sky;
    g.fillRect(0, 0, this.width, this.height);

    const l = this.lightBuffer.ctx;
    l.setTransform(1, 0, 0, 1, 0, 0);
    l.globalCompositeOperation = 'source-over';
    l.globalAlpha = 1;
    // Light buffer starts at the ambient level; brighter areas are painted on.
    const amb = Math.round(clamp(this.palette.ambient, 0, 1) * 255);
    l.fillStyle = `rgb(${amb},${amb},${amb})`;
    l.fillRect(0, 0, this.width, this.height);
  }

  /**
   * Push the world-space camera transform. Everything drawn between this and
   * `endWorld` uses world coordinates.
   * @param {import('./camera.js').Camera} camera
   */
  beginWorld(camera) {
    const t = camera.getRenderTransform();
    this._camX = t.x;
    this._camY = t.y;
    this._zoom = camera.zoom;
    this._inWorld = true;

    const g = this.buffer.ctx;
    g.save();
    g.translate(this.width / 2, this.height / 2);
    if (t.angle !== 0) g.rotate(t.angle);
    if (camera.zoom !== 1) g.scale(camera.zoom, camera.zoom);
    g.translate(-t.x, -t.y);

    // Mirror the transform onto the light buffer so lights are authored in
    // world space too.
    const l = this.lightBuffer.ctx;
    l.save();
    l.translate(this.width / 2, this.height / 2);
    if (t.angle !== 0) l.rotate(t.angle);
    if (camera.zoom !== 1) l.scale(camera.zoom, camera.zoom);
    l.translate(-t.x, -t.y);
  }

  endWorld() {
    if (!this._inWorld) return;
    this.buffer.ctx.restore();
    this.lightBuffer.ctx.restore();
    this._inWorld = false;
  }

  // --- primitive helpers ----------------------------------------------------
  // These exist so that game drawing code reads as intent ("draw a tapered
  // blade") rather than as a sequence of context mutations, and so that the
  // draw-call counter and style handling live in one place.

  /**
   * @param {number} x @param {number} y @param {number} w @param {number} h
   * @param {string} color
   */
  rect(x, y, w, h, color) {
    const g = this.buffer.ctx;
    g.fillStyle = color;
    g.fillRect(x, y, w, h);
    this.drawCalls++;
  }

  /**
   * @param {number} x @param {number} y @param {number} w @param {number} h
   * @param {string} color @param {number} [lineWidth]
   */
  strokeRect(x, y, w, h, color, lineWidth = 1) {
    const g = this.buffer.ctx;
    g.strokeStyle = color;
    g.lineWidth = lineWidth;
    g.strokeRect(x, y, w, h);
    this.drawCalls++;
  }

  /**
   * @param {number} x @param {number} y @param {number} r @param {string} color
   */
  circle(x, y, r, color) {
    const g = this.buffer.ctx;
    g.fillStyle = color;
    g.beginPath();
    g.arc(x, y, Math.max(0.1, r), 0, Math.PI * 2);
    g.fill();
    this.drawCalls++;
  }

  /**
   * @param {number} x @param {number} y @param {number} rx @param {number} ry
   * @param {string} color @param {number} [rotation]
   */
  ellipse(x, y, rx, ry, color, rotation = 0) {
    const g = this.buffer.ctx;
    g.fillStyle = color;
    g.beginPath();
    g.ellipse(x, y, Math.max(0.1, rx), Math.max(0.1, ry), rotation, 0, Math.PI * 2);
    g.fill();
    this.drawCalls++;
  }

  /**
   * @param {number} x1 @param {number} y1 @param {number} x2 @param {number} y2
   * @param {string} color @param {number} [width]
   */
  line(x1, y1, x2, y2, color, width = 1) {
    const g = this.buffer.ctx;
    g.strokeStyle = color;
    g.lineWidth = width;
    g.beginPath();
    g.moveTo(x1, y1);
    g.lineTo(x2, y2);
    g.stroke();
    this.drawCalls++;
  }

  /**
   * Filled polygon from a flat [x0,y0,x1,y1,...] array.
   * @param {number[]} points
   * @param {string} color
   * @param {string} [strokeColor]
   * @param {number} [strokeWidth]
   */
  polygon(points, color, strokeColor, strokeWidth = 1) {
    if (points.length < 4) return;
    const g = this.buffer.ctx;
    g.beginPath();
    g.moveTo(points[0], points[1]);
    for (let i = 2; i < points.length; i += 2) g.lineTo(points[i], points[i + 1]);
    g.closePath();
    if (color) {
      g.fillStyle = color;
      g.fill();
    }
    if (strokeColor) {
      g.strokeStyle = strokeColor;
      g.lineWidth = strokeWidth;
      g.stroke();
    }
    this.drawCalls++;
  }

  /**
   * A soft radial glow. Used for lights, magic effects and creature eyes.
   * @param {number} x @param {number} y @param {number} radius
   * @param {string} color
   * @param {number} [intensity]
   */
  glow(x, y, radius, color, intensity = 1) {
    if (radius <= 0) return;
    const g = this.buffer.ctx;
    const grad = g.createRadialGradient(x, y, 0, x, y, radius);
    grad.addColorStop(0, color);
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    const prevOp = g.globalCompositeOperation;
    const prevAlpha = g.globalAlpha;
    g.globalCompositeOperation = 'lighter';
    g.globalAlpha = clamp(intensity, 0, 1);
    g.fillStyle = grad;
    g.beginPath();
    g.arc(x, y, radius, 0, Math.PI * 2);
    g.fill();
    g.globalCompositeOperation = prevOp;
    g.globalAlpha = prevAlpha;
    this.drawCalls++;
  }

  /**
   * Add light to the lighting buffer. Areas left unlit fall to the palette's
   * ambient level when the buffer is composited.
   * @param {number} x @param {number} y @param {number} radius
   * @param {string} color
   * @param {number} [intensity]
   */
  addLight(x, y, radius, color, intensity = 1) {
    if (radius <= 0 || intensity <= 0) return;
    const l = this.lightBuffer.ctx;
    const grad = l.createRadialGradient(x, y, 0, x, y, radius);
    grad.addColorStop(0, color);
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    l.globalCompositeOperation = 'lighter';
    l.globalAlpha = clamp(intensity, 0, 1);
    l.fillStyle = grad;
    l.beginPath();
    l.arc(x, y, radius, 0, Math.PI * 2);
    l.fill();
    l.globalAlpha = 1;
  }

  /**
   * @param {string} text
   * @param {number} x @param {number} y
   * @param {object} [options]
   * @param {string} [options.color]
   * @param {number} [options.size]
   * @param {CanvasTextAlign} [options.align]
   * @param {CanvasTextBaseline} [options.baseline]
   * @param {string} [options.font]
   * @param {string} [options.shadow] Draw a 1px offset shadow in this colour.
   * @param {number} [options.alpha]
   * @param {number} [options.letterSpacing]
   */
  text(text, x, y, options = {}) {
    const g = this.buffer.ctx;
    const size = options.size ?? 8;
    g.font = `${size}px ${options.font ?? FONT_STACK}`;
    g.textAlign = options.align ?? 'left';
    g.textBaseline = options.baseline ?? 'top';
    const prevAlpha = g.globalAlpha;
    if (options.alpha !== undefined) g.globalAlpha = options.alpha;
    if (options.letterSpacing !== undefined && 'letterSpacing' in g) {
      /** @type {any} */ (g).letterSpacing = `${options.letterSpacing}px`;
    }
    if (options.shadow) {
      g.fillStyle = options.shadow;
      g.fillText(text, x + 1, y + 1);
    }
    g.fillStyle = options.color ?? '#ffffff';
    g.fillText(text, x, y);
    if (options.letterSpacing !== undefined && 'letterSpacing' in g) {
      /** @type {any} */ (g).letterSpacing = '0px';
    }
    g.globalAlpha = prevAlpha;
    this.drawCalls++;
  }

  /**
   * @param {string} text
   * @param {number} [size]
   * @param {string} [font]
   * @returns {number} width in internal pixels
   */
  measureText(text, size = 8, font = FONT_STACK) {
    const g = this.buffer.ctx;
    g.font = `${size}px ${font}`;
    return g.measureText(text).width;
  }

  /**
   * Run a drawing callback with a temporary alpha.
   * @param {number} alpha
   * @param {() => void} fn
   */
  withAlpha(alpha, fn) {
    const g = this.buffer.ctx;
    const prev = g.globalAlpha;
    g.globalAlpha = clamp(alpha, 0, 1) * prev;
    fn();
    g.globalAlpha = prev;
  }

  /**
   * Run a drawing callback with a temporary composite mode.
   * @param {GlobalCompositeOperation} mode
   * @param {() => void} fn
   */
  withComposite(mode, fn) {
    const g = this.buffer.ctx;
    const prev = g.globalCompositeOperation;
    g.globalCompositeOperation = mode;
    fn();
    g.globalCompositeOperation = prev;
  }

  /**
   * Run a drawing callback clipped to a rectangle.
   * @param {number} x @param {number} y @param {number} w @param {number} h
   * @param {() => void} fn
   */
  withClip(x, y, w, h, fn) {
    const g = this.buffer.ctx;
    g.save();
    g.beginPath();
    g.rect(x, y, w, h);
    g.clip();
    fn();
    g.restore();
  }

  /**
   * Run a drawing callback under a local transform.
   * @param {number} x @param {number} y
   * @param {number} rotation
   * @param {number} scaleX @param {number} scaleY
   * @param {() => void} fn
   */
  withTransform(x, y, rotation, scaleX, scaleY, fn) {
    const g = this.buffer.ctx;
    g.save();
    g.translate(x, y);
    if (rotation) g.rotate(rotation);
    if (scaleX !== 1 || scaleY !== 1) g.scale(scaleX, scaleY);
    fn();
    g.restore();
  }

  /**
   * Composite the lighting buffer over the scene.
   * `multiply` darkens unlit regions toward black while leaving lit regions
   * untouched, which is the cheapest convincing 2D lighting model.
   */
  applyLighting() {
    const g = this.buffer.ctx;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalCompositeOperation = 'multiply';
    g.globalAlpha = 1;
    g.drawImage(this.lightBuffer.canvas, 0, 0);
    g.globalCompositeOperation = 'source-over';
  }

  /**
   * Screen-space post-processing. Applied after the world and before the UI, so
   * the interface stays crisp and unvignetted.
   * @param {number} dt
   */
  applyPostFX(dt) {
    const g = this.buffer.ctx;
    g.setTransform(1, 0, 0, 1, 0, 0);

    if (this.vignetteStrength > 0) {
      const key = `${this.width}x${this.height}:${this.vignetteStrength}:${this.palette.fog}`;
      if (this._vignetteKey !== key) {
        const grad = g.createRadialGradient(
          this.width / 2, this.height / 2, this.height * 0.32,
          this.width / 2, this.height / 2, this.height * 0.86,
        );
        grad.addColorStop(0, 'rgba(0,0,0,0)');
        grad.addColorStop(1, this.palette.fog);
        this._vignetteCache = grad;
        this._vignetteKey = key;
      }
      g.globalAlpha = this.vignetteStrength;
      g.fillStyle = /** @type {CanvasGradient} */ (this._vignetteCache);
      g.fillRect(0, 0, this.width, this.height);
      g.globalAlpha = 1;
    }

    if (this.flashAmount > 0) {
      g.globalCompositeOperation = 'lighter';
      g.globalAlpha = clamp(this.flashAmount, 0, 1);
      g.fillStyle = this.flashColor;
      g.fillRect(0, 0, this.width, this.height);
      g.globalAlpha = 1;
      g.globalCompositeOperation = 'source-over';
      // Decay is frame-time based so a long frame does not leave the screen white.
      this.flashAmount = Math.max(0, this.flashAmount - dt * 4.5);
    }

    if (this.grainStrength > 0) {
      this._grainOffset = (this._grainOffset + 1) % 8;
      this._drawGrain();
    }
  }

  /**
   * Cheap animated grain: a sparse scatter of translucent dots. A per-pixel
   * noise pass would cost ~130k `putImageData` writes a frame for an effect
   * nobody consciously notices; this reads the same at a fraction of the price.
   * @private
   */
  _drawGrain() {
    const g = this.buffer.ctx;
    g.globalAlpha = this.grainStrength;
    g.fillStyle = '#ffffff';
    // Deterministic scatter, offset each frame so it animates.
    const count = 90;
    let seed = 1013904223 + this._grainOffset * 2654435761;
    for (let i = 0; i < count; i++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      const x = (seed >>> 16) % this.width;
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      const y = (seed >>> 16) % this.height;
      g.fillRect(x, y, 1, 1);
    }
    g.globalAlpha = 1;
  }

  /**
   * Trigger a full-screen flash.
   * @param {string} color
   * @param {number} amount 0..1
   */
  flash(color, amount) {
    this.flashColor = color;
    this.flashAmount = Math.max(this.flashAmount, amount);
  }

  /**
   * Blit the internal buffer to the visible canvas.
   */
  present() {
    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    // Nearest-neighbour keeps the procedurally drawn geometry crisp when
    // upscaled by an integer factor.
    ctx.imageSmoothingEnabled = this.displayScale % 1 !== 0;
    ctx.drawImage(
      this.buffer.canvas,
      0, 0, this.width, this.height,
      this.offsetX, this.offsetY,
      this.width * this.displayScale,
      this.height * this.displayScale,
    );
  }

  /**
   * Convert a page-space pointer position into internal-resolution coordinates.
   * @param {number} clientX @param {number} clientY
   * @param {DOMRect} rect bounding rect of the canvas element
   * @param {number} [dpr]
   * @returns {{x: number, y: number}}
   */
  clientToInternal(clientX, clientY, rect, dpr = 1) {
    const px = (clientX - rect.left) * dpr;
    const py = (clientY - rect.top) * dpr;
    return {
      x: (px - this.offsetX) / this.displayScale,
      y: (py - this.offsetY) / this.displayScale,
    };
  }
}

/**
 * @typedef {Object} Surface
 * @property {HTMLCanvasElement|OffscreenCanvas} canvas
 * @property {CanvasRenderingContext2D} ctx
 */

/**
 * Create an offscreen drawing surface, preferring `OffscreenCanvas` where
 * available (it avoids attaching an unused DOM node).
 * @param {number} w @param {number} h
 * @returns {Surface}
 */
export function createSurface(w, h) {
  /** @type {any} */
  let canvas;
  if (typeof OffscreenCanvas !== 'undefined') {
    canvas = new OffscreenCanvas(w, h);
  } else {
    canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
  }
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('createSurface: 2D context unavailable');
  return { canvas, ctx };
}
