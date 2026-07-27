/**
 * @file Colour model and palette utilities.
 *
 * ## Why colour gets its own subsystem
 * Every visual in this game is drawn from primitives at runtime — there are no
 * image assets. That makes colour the primary tool for giving each of the
 * world's regions a distinct identity, so it needs to be more than a list of hex
 * strings.
 *
 * A `Palette` is a small, structured description of a region's look: a ramp of
 * terrain values from deep shadow to lit edge, an accent, a fluid tint, a fog
 * colour and a light colour. Every drawing routine in the game reads from the
 * *active* palette rather than hard-coding colours, which means a new biome is a
 * data entry rather than a rendering change, and a global mood shift (dusk,
 * flooding, the endgame's desaturation) is a single palette blend.
 *
 * ## Why OKLCH-style perceptual mixing rather than plain RGB lerp?
 * Interpolating two saturated colours in RGB passes through a muddy desaturated
 * middle — blending a deep blue and a warm ochre in RGB gives grey-brown.
 * Mixing in a perceptual space keeps the transition vivid, which matters
 * because biome cross-fades and damage flashes are both colour blends. We use a
 * lightweight OKLab implementation: enough of the benefit for a fraction of the
 * cost of full colour management.
 */

/**
 * @typedef {Object} PaletteSpec
 * @property {string} id
 * @property {string} name
 * @property {string[]} terrain Dark-to-light ramp, at least 4 entries.
 * @property {string} accent Highlight colour for interactive/important detail.
 * @property {string} accentAlt Secondary accent.
 * @property {string} fluid Tint for water/aether in this region.
 * @property {string} fog Distance fog and vignette tint.
 * @property {string} light Ambient light colour.
 * @property {string} sky Far background colour.
 * @property {number} ambient Ambient light intensity, 0..1.
 * @property {string[]} [flora] Optional decorative colours.
 */

/**
 * Parse `#rgb`, `#rrggbb`, `#rrggbbaa` or `rgba()` into components.
 * @param {string} css
 * @returns {{r: number, g: number, b: number, a: number}} channels in 0..255, alpha 0..1
 */
export function parseColor(css) {
  if (typeof css !== 'string') return { r: 255, g: 0, b: 255, a: 1 };
  const s = css.trim();
  if (s[0] === '#') {
    const hex = s.slice(1);
    if (hex.length === 3) {
      return {
        r: parseInt(hex[0] + hex[0], 16),
        g: parseInt(hex[1] + hex[1], 16),
        b: parseInt(hex[2] + hex[2], 16),
        a: 1,
      };
    }
    if (hex.length === 6 || hex.length === 8) {
      return {
        r: parseInt(hex.slice(0, 2), 16),
        g: parseInt(hex.slice(2, 4), 16),
        b: parseInt(hex.slice(4, 6), 16),
        a: hex.length === 8 ? parseInt(hex.slice(6, 8), 16) / 255 : 1,
      };
    }
  }
  const m = s.match(/rgba?\(([^)]+)\)/);
  if (m) {
    const parts = m[1].split(',').map((p) => parseFloat(p));
    return { r: parts[0] || 0, g: parts[1] || 0, b: parts[2] || 0, a: parts.length > 3 ? parts[3] : 1 };
  }
  return { r: 255, g: 0, b: 255, a: 1 };
}

/**
 * @param {number} r @param {number} g @param {number} b @param {number} [a]
 * @returns {string}
 */
export function rgba(r, g, b, a = 1) {
  const ri = Math.round(clamp255(r));
  const gi = Math.round(clamp255(g));
  const bi = Math.round(clamp255(b));
  return a >= 1 ? `rgb(${ri},${gi},${bi})` : `rgba(${ri},${gi},${bi},${a.toFixed(3)})`;
}

/** @param {number} v @returns {number} */
function clamp255(v) {
  return v < 0 ? 0 : v > 255 ? 255 : v;
}

// --- OKLab conversion -------------------------------------------------------
// Reference: Björn Ottosson's OKLab. Implemented directly rather than pulled in
// as a dependency because it is 20 lines and we need exactly two functions.

/**
 * @param {number} r @param {number} g @param {number} b sRGB 0..255
 * @returns {[number, number, number]} OKLab L, a, b
 */
function srgbToOklab(r, g, b) {
  const lr = srgbToLinear(r / 255);
  const lg = srgbToLinear(g / 255);
  const lb = srgbToLinear(b / 255);

  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);

  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

/**
 * @param {number} L @param {number} a @param {number} b
 * @returns {[number, number, number]} sRGB 0..255
 */
function oklabToSrgb(L, a, b) {
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.291485548 * b;

  const l = l_ * l_ * l_;
  const m = m_ * m_ * m_;
  const s = s_ * s_ * s_;

  return [
    linearToSrgb(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s) * 255,
    linearToSrgb(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s) * 255,
    linearToSrgb(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s) * 255,
  ];
}

/** @param {number} c @returns {number} */
function srgbToLinear(c) {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/** @param {number} c @returns {number} */
function linearToSrgb(c) {
  const v = c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(Math.max(c, 0), 1 / 2.4) - 0.055;
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/**
 * Perceptually mix two colours.
 * @param {string} a
 * @param {string} b
 * @param {number} t 0 returns `a`, 1 returns `b`
 * @returns {string}
 */
export function mix(a, b, t) {
  if (t <= 0) return a;
  if (t >= 1) return b;
  const ca = parseColor(a);
  const cb = parseColor(b);
  const la = srgbToOklab(ca.r, ca.g, ca.b);
  const lb = srgbToOklab(cb.r, cb.g, cb.b);
  const [r, g, bl] = oklabToSrgb(
    la[0] + (lb[0] - la[0]) * t,
    la[1] + (lb[1] - la[1]) * t,
    la[2] + (lb[2] - la[2]) * t,
  );
  return rgba(r, g, bl, ca.a + (cb.a - ca.a) * t);
}

/**
 * Adjust perceptual lightness. `amount` of +0.1 is a visible but subtle lift.
 * @param {string} css @param {number} amount
 * @returns {string}
 */
export function lighten(css, amount) {
  const c = parseColor(css);
  const [L, a, b] = srgbToOklab(c.r, c.g, c.b);
  const [r, g, bl] = oklabToSrgb(Math.max(0, Math.min(1, L + amount)), a, b);
  return rgba(r, g, bl, c.a);
}

/** @param {string} css @param {number} amount @returns {string} */
export function darken(css, amount) {
  return lighten(css, -amount);
}

/**
 * Scale chroma. 0 gives greyscale, values above 1 push saturation.
 * @param {string} css @param {number} factor
 * @returns {string}
 */
export function saturate(css, factor) {
  const c = parseColor(css);
  const [L, a, b] = srgbToOklab(c.r, c.g, c.b);
  const [r, g, bl] = oklabToSrgb(L, a * factor, b * factor);
  return rgba(r, g, bl, c.a);
}

/**
 * Replace a colour's alpha.
 * @param {string} css @param {number} alpha
 * @returns {string}
 */
export function withAlpha(css, alpha) {
  const c = parseColor(css);
  return rgba(c.r, c.g, c.b, alpha);
}

/**
 * Build a smooth N-step ramp through a set of key colours. Used to expand a
 * biome's 4-5 authored terrain colours into the finer gradient the tile painter
 * wants for depth shading.
 * @param {string[]} keys
 * @param {number} steps
 * @returns {string[]}
 */
export function buildRamp(keys, steps) {
  if (keys.length === 0) return [];
  if (keys.length === 1) return new Array(steps).fill(keys[0]);
  const out = [];
  for (let i = 0; i < steps; i++) {
    const t = steps === 1 ? 0 : i / (steps - 1);
    const scaled = t * (keys.length - 1);
    const idx = Math.min(keys.length - 2, Math.floor(scaled));
    out.push(mix(keys[idx], keys[idx + 1], scaled - idx));
  }
  return out;
}

/**
 * A resolved, ready-to-draw palette. Construction pre-computes the expanded
 * ramp and common derived colours so per-frame drawing never mixes colours.
 */
export class Palette {
  /** @param {PaletteSpec} spec */
  constructor(spec) {
    this.id = spec.id;
    this.name = spec.name;
    this.spec = spec;
    /** 12-step terrain ramp, index 0 darkest. */
    this.ramp = buildRamp(spec.terrain, 12);
    this.accent = spec.accent;
    this.accentAlt = spec.accentAlt;
    this.fluid = spec.fluid;
    this.fog = spec.fog;
    this.light = spec.light;
    this.sky = spec.sky;
    this.ambient = spec.ambient;
    this.flora = spec.flora ?? [spec.accent, spec.accentAlt];

    // Derived colours used constantly by the tile painter.
    this.shadow = darken(spec.terrain[0], 0.06);
    this.midtone = this.ramp[5];
    this.edgeLight = lighten(spec.terrain[spec.terrain.length - 1], 0.08);
    this.outline = darken(spec.terrain[0], 0.1);
    this.backdrop = mix(spec.terrain[0], spec.sky, 0.55);
    this.backdropDeep = mix(spec.terrain[0], spec.sky, 0.25);
  }

  /**
   * Sample the terrain ramp.
   * @param {number} t 0..1
   * @returns {string}
   */
  terrainAt(t) {
    const i = Math.round(Math.max(0, Math.min(1, t)) * (this.ramp.length - 1));
    return this.ramp[i];
  }

  /**
   * Blend two palettes, used for smooth transitions when the player crosses a
   * biome border mid-room.
   * @param {Palette} other
   * @param {number} t
   * @returns {Palette}
   */
  blendWith(other, t) {
    if (t <= 0) return this;
    if (t >= 1) return other;
    const a = this.spec;
    const b = other.spec;
    const len = Math.max(a.terrain.length, b.terrain.length);
    /** @type {string[]} */
    const terrain = [];
    for (let i = 0; i < len; i++) {
      terrain.push(mix(
        a.terrain[Math.min(i, a.terrain.length - 1)],
        b.terrain[Math.min(i, b.terrain.length - 1)],
        t,
      ));
    }
    return new Palette({
      id: `${a.id}~${b.id}`,
      name: `${a.name} / ${b.name}`,
      terrain,
      accent: mix(a.accent, b.accent, t),
      accentAlt: mix(a.accentAlt, b.accentAlt, t),
      fluid: mix(a.fluid, b.fluid, t),
      fog: mix(a.fog, b.fog, t),
      light: mix(a.light, b.light, t),
      sky: mix(a.sky, b.sky, t),
      ambient: a.ambient + (b.ambient - a.ambient) * t,
      flora: (a.flora ?? []).map((c, i) => mix(c, (b.flora ?? [])[i] ?? c, t)),
    });
  }
}

/**
 * Fallback palette, used before a region loads and by the level editor.
 * @type {Palette}
 */
export const NEUTRAL_PALETTE = new Palette({
  id: 'neutral',
  name: 'Neutral',
  terrain: ['#14161d', '#232733', '#39404f', '#525b6d', '#6f7a8e'],
  accent: '#c8b48a',
  accentAlt: '#7fa8b8',
  fluid: '#2f5f74',
  fog: '#0e1016',
  light: '#cfd6e6',
  sky: '#0a0c12',
  ambient: 0.55,
});
