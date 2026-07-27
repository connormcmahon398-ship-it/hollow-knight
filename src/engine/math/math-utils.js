/**
 * @file Scalar math helpers, easing curves and frame-rate independent smoothing.
 *
 * A note on `damp` vs `lerp`: gameplay code is full of `x = lerp(x, target, 0.1)`
 * smoothing, which is **frame-rate dependent** — it converges twice as fast at
 * 120fps as at 60fps. Because this engine runs a fixed simulation timestep that
 * is *usually* stable, that bug would mostly hide, then surface on slow machines
 * where the loop clamps. `damp()` is the correct exponential form and is what
 * camera, audio ducking and animation blending use.
 */

export const TAU = Math.PI * 2;
export const HALF_PI = Math.PI / 2;
export const DEG_TO_RAD = Math.PI / 180;
export const RAD_TO_DEG = 180 / Math.PI;
export const EPSILON = 1e-6;

/**
 * @param {number} v
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
export function clamp(v, min, max) {
  return v < min ? min : v > max ? max : v;
}

/** @param {number} v @returns {number} */
export function clamp01(v) {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/**
 * @param {number} a
 * @param {number} b
 * @param {number} t
 * @returns {number}
 */
export function lerp(a, b, t) {
  return a + (b - a) * t;
}

/**
 * Inverse lerp: where does `v` sit between `a` and `b`?
 * @param {number} a @param {number} b @param {number} v
 * @returns {number} unclamped
 */
export function invLerp(a, b, v) {
  return Math.abs(b - a) < EPSILON ? 0 : (v - a) / (b - a);
}

/**
 * Remap a value from one range to another.
 * @param {number} v
 * @param {number} inMin @param {number} inMax
 * @param {number} outMin @param {number} outMax
 * @returns {number}
 */
export function remap(v, inMin, inMax, outMin, outMax) {
  return lerp(outMin, outMax, clamp01(invLerp(inMin, inMax, v)));
}

/**
 * Frame-rate independent exponential smoothing.
 *
 * `lambda` is the *rate*: higher converges faster. A `lambda` of 10 closes
 * roughly 63% of the remaining distance every 0.1s regardless of `dt`.
 *
 * @param {number} current
 * @param {number} target
 * @param {number} lambda
 * @param {number} dt
 * @returns {number}
 */
export function damp(current, target, lambda, dt) {
  return lerp(target, current, Math.exp(-lambda * dt));
}

/**
 * Move `current` toward `target` by at most `maxDelta`. Unlike `lerp` this
 * reaches the target exactly, which matters for things that must *settle*
 * (e.g. a health bar, or velocity reaching zero so an entity can sleep).
 * @param {number} current @param {number} target @param {number} maxDelta
 * @returns {number}
 */
export function moveToward(current, target, maxDelta) {
  const diff = target - current;
  if (Math.abs(diff) <= maxDelta) return target;
  return current + Math.sign(diff) * maxDelta;
}

/**
 * Smooth Hermite interpolation between two edges.
 * @param {number} edge0 @param {number} edge1 @param {number} x
 * @returns {number}
 */
export function smoothstep(edge0, edge1, x) {
  const t = clamp01(invLerp(edge0, edge1, x));
  return t * t * (3 - 2 * t);
}

/**
 * Ken Perlin's smoother variant; zero 1st *and* 2nd derivative at the edges.
 * @param {number} edge0 @param {number} edge1 @param {number} x
 * @returns {number}
 */
export function smootherstep(edge0, edge1, x) {
  const t = clamp01(invLerp(edge0, edge1, x));
  return t * t * t * (t * (t * 6 - 15) + 10);
}

/**
 * Shortest signed angular difference, in radians, in (-PI, PI].
 * @param {number} from @param {number} to
 * @returns {number}
 */
export function angleDelta(from, to) {
  let d = (to - from) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return d;
}

/**
 * Interpolate angles the short way round.
 * @param {number} a @param {number} b @param {number} t
 * @returns {number}
 */
export function lerpAngle(a, b, t) {
  return a + angleDelta(a, b) * t;
}

/**
 * True modulo that returns a non-negative result for negative inputs, unlike `%`.
 * Needed constantly for tile wrapping and animation frame indexing.
 * @param {number} n @param {number} m
 * @returns {number}
 */
export function mod(n, m) {
  return ((n % m) + m) % m;
}

/**
 * @param {number} v
 * @param {number} [deadzone]
 * @returns {number} rescaled so output ramps from 0 at the deadzone edge
 */
export function applyDeadzone(v, deadzone = 0.2) {
  const a = Math.abs(v);
  if (a < deadzone) return 0;
  return Math.sign(v) * ((a - deadzone) / (1 - deadzone));
}

/** @param {number} a @param {number} b @param {number} [eps] @returns {boolean} */
export function approximately(a, b, eps = EPSILON) {
  return Math.abs(a - b) <= eps;
}

/**
 * Snap to the nearest multiple of `step`.
 * @param {number} v @param {number} step
 * @returns {number}
 */
export function snap(v, step) {
  return step === 0 ? v : Math.round(v / step) * step;
}

/**
 * A critically-damped spring, used for camera follow and UI motion.
 * Returns the new position and writes the new velocity back into `state`.
 *
 * Preferred over `damp` where overshoot-free *acceleration* matters: a camera
 * driven by `damp` starts moving instantly (which reads as jitter), whereas a
 * spring eases in.
 *
 * @param {{value: number, velocity: number}} state mutated in place
 * @param {number} target
 * @param {number} smoothTime approximate time to reach the target, seconds
 * @param {number} dt
 * @param {number} [maxSpeed]
 * @returns {number} the new value
 */
export function springDamp(state, target, smoothTime, dt, maxSpeed = Infinity) {
  // Standard critically damped spring (Game Programming Gems 4, 1.10).
  const omega = 2 / Math.max(smoothTime, 1e-4);
  const x = omega * dt;
  const exp = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);
  let change = state.value - target;
  const maxChange = maxSpeed * Math.max(smoothTime, 1e-4);
  change = clamp(change, -maxChange, maxChange);
  const temp = (state.velocity + omega * change) * dt;
  state.velocity = (state.velocity - omega * temp) * exp;
  let output = target + (change + temp) * exp;
  // Prevent overshoot past the target.
  const origMinusCurrent = target - state.value;
  const outMinusOrig = output - target;
  if (origMinusCurrent * outMinusOrig > 0) {
    output = target;
    state.velocity = 0;
  }
  state.value = output;
  return output;
}

/**
 * Easing functions, keyed by name so animation and tween data can reference
 * them as strings from content files.
 * All take and return a normalised [0,1] value.
 * @type {Record<string, (t: number) => number>}
 */
export const Ease = {
  linear: (t) => t,
  inQuad: (t) => t * t,
  outQuad: (t) => t * (2 - t),
  inOutQuad: (t) => (t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t),
  inCubic: (t) => t * t * t,
  outCubic: (t) => --t * t * t + 1,
  inOutCubic: (t) => (t < 0.5 ? 4 * t * t * t : (t - 1) * (2 * t - 2) * (2 * t - 2) + 1),
  inQuart: (t) => t * t * t * t,
  outQuart: (t) => 1 - --t * t * t * t,
  inExpo: (t) => (t === 0 ? 0 : Math.pow(2, 10 * (t - 1))),
  outExpo: (t) => (t === 1 ? 1 : 1 - Math.pow(2, -10 * t)),
  inOutExpo: (t) => {
    if (t === 0 || t === 1) return t;
    if (t < 0.5) return Math.pow(2, 20 * t - 10) / 2;
    return (2 - Math.pow(2, -20 * t + 10)) / 2;
  },
  outBack: (t) => {
    const c1 = 1.70158;
    const c3 = c1 + 1;
    return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
  },
  inBack: (t) => {
    const c1 = 1.70158;
    const c3 = c1 + 1;
    return c3 * t * t * t - c1 * t * t;
  },
  outElastic: (t) => {
    if (t === 0 || t === 1) return t;
    const c4 = TAU / 3;
    return Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * c4) + 1;
  },
  outBounce: (t) => {
    const n1 = 7.5625;
    const d1 = 2.75;
    if (t < 1 / d1) return n1 * t * t;
    if (t < 2 / d1) return n1 * (t -= 1.5 / d1) * t + 0.75;
    if (t < 2.5 / d1) return n1 * (t -= 2.25 / d1) * t + 0.9375;
    return n1 * (t -= 2.625 / d1) * t + 0.984375;
  },
  /** Rises to 1 at t=0.5 then falls back to 0. Useful for one-shot pulses. */
  pulse: (t) => Math.sin(t * Math.PI),
};

/**
 * Look up an easing function by name, falling back to linear.
 * @param {string} [name]
 * @returns {(t: number) => number}
 */
export function getEase(name) {
  return (name && Ease[name]) || Ease.linear;
}
