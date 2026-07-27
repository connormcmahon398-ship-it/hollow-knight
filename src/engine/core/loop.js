/**
 * @file The main game loop: fixed-timestep simulation with interpolated rendering.
 *
 * ## Why fixed timestep?
 * A variable timestep (`update(realDeltaTime)`) is simpler but wrong for this
 * genre for three reasons:
 *
 * 1. **Determinism.** Jump arcs, boss patterns and enemy timings must be
 *    identical on a 60Hz laptop and a 165Hz desktop. With variable dt, jump
 *    height literally changes with frame rate because gravity integration error
 *    scales with step size.
 * 2. **Collision stability.** Large dt spikes (a GC pause, an alt-tab) produce
 *    huge motion in one step. Even with swept collision, a 500ms step teleports
 *    the player across three rooms.
 * 3. **Testability.** Tests can advance the simulation N discrete steps and
 *    assert exact positions.
 *
 * ## The accumulator
 * Real elapsed time is accumulated and drained in fixed `stepSeconds` chunks.
 * Leftover time is exposed as `alpha` in [0,1) so the renderer can interpolate
 * between the previous and current physics state, which removes the judder you
 * would otherwise see when the display rate is not a multiple of the tick rate.
 *
 * ## The spiral of death
 * If simulation takes longer than real time, the accumulator grows without
 * bound and the game freezes. We cap catch-up at `maxStepsPerFrame`; beyond
 * that we discard the backlog and report it. Dropping simulation time is the
 * lesser evil — the alternative is an unrecoverable hang.
 */

/**
 * @typedef {Object} LoopCallbacks
 * @property {(dt: number) => void} update Fixed-step simulation.
 * @property {(alpha: number, frameDt: number) => void} render
 * @property {(stats: LoopStats) => void} [onStats] Called about once a second.
 */

/**
 * @typedef {Object} LoopStats
 * @property {number} fps Rendered frames per second.
 * @property {number} ups Simulation updates per second.
 * @property {number} frameMs Average wall time per rendered frame.
 * @property {number} updateMs Average wall time per simulation step.
 * @property {number} renderMs Average wall time in render.
 * @property {number} droppedSteps Simulation steps discarded to avoid a stall.
 */

/** Default simulation rate. 60Hz is the tuning baseline for all movement values. */
export const DEFAULT_TICK_RATE = 60;

export class GameLoop {
  /**
   * @param {LoopCallbacks} callbacks
   * @param {object} [options]
   * @param {number} [options.tickRate] Simulation steps per second.
   * @param {number} [options.maxStepsPerFrame] Catch-up cap.
   * @param {() => number} [options.now] Injectable clock, for tests.
   * @param {(cb: (t: number) => void) => number} [options.schedule] Injectable frame scheduler.
   * @param {(id: number) => void} [options.cancel]
   */
  constructor(callbacks, options = {}) {
    this._update = callbacks.update;
    this._render = callbacks.render;
    this._onStats = callbacks.onStats ?? null;

    this.tickRate = options.tickRate ?? DEFAULT_TICK_RATE;
    this.stepSeconds = 1 / this.tickRate;
    this.maxStepsPerFrame = options.maxStepsPerFrame ?? 5;

    // Injectable so the loop is testable headlessly without a browser.
    this._now = options.now ?? defaultNow;
    this._schedule = options.schedule ?? defaultSchedule;
    this._cancel = options.cancel ?? defaultCancel;

    this._accumulator = 0;
    this._lastTime = 0;
    this._rafId = 0;
    this.running = false;
    /** Wall-clock seconds since `start()`, excluding paused time. */
    this.elapsed = 0;
    /** Total simulation steps executed since `start()`. */
    this.tick = 0;

    /**
     * Global time scale. 0 freezes the simulation while still rendering (used
     * for pause menus and hit-stop); values below 1 give slow-motion for
     * dramatic boss deaths. Render still receives real frame time so UI and
     * post-processing keep animating.
     */
    this.timeScale = 1;

    /**
     * Frames to freeze the simulation for, decremented per rendered frame.
     * Hit-stop is expressed in frames rather than seconds because it is a
     * *feel* parameter tuned against animation frames.
     */
    this._hitstopFrames = 0;

    this._stats = {
      fps: 0, ups: 0, frameMs: 0, updateMs: 0, renderMs: 0, droppedSteps: 0,
    };
    this._statFrames = 0;
    this._statUpdates = 0;
    this._statFrameMs = 0;
    this._statUpdateMs = 0;
    this._statRenderMs = 0;
    this._statTimer = 0;
    this._droppedSteps = 0;
  }

  /** Begin running. Idempotent. */
  start() {
    if (this.running) return;
    this.running = true;
    this._lastTime = this._now();
    this._accumulator = 0;
    this._rafId = this._schedule(this._frame);
  }

  /** Stop running. The accumulator is reset so resuming does not fast-forward. */
  stop() {
    if (!this.running) return;
    this.running = false;
    this._cancel(this._rafId);
    this._accumulator = 0;
  }

  /**
   * Freeze the *simulation* for a number of frames while rendering continues.
   * This is the single most effective combat-feel tool available: a 4-6 frame
   * freeze on a landed hit reads as impact weight far more strongly than any
   * particle effect.
   * @param {number} frames
   */
  requestHitstop(frames) {
    // Take the max rather than summing, so a flurry of simultaneous hits
    // doesn't compound into a multi-second freeze.
    this._hitstopFrames = Math.max(this._hitstopFrames, frames);
  }

  /** @returns {boolean} */
  get inHitstop() {
    return this._hitstopFrames > 0;
  }

  /**
   * Advance the simulation by exactly `steps` fixed steps, bypassing wall-clock
   * timing. This is how tests drive the game, and how the level editor scrubs.
   * @param {number} steps
   */
  stepManual(steps = 1) {
    for (let i = 0; i < steps; i++) {
      this._update(this.stepSeconds);
      this.tick++;
      this.elapsed += this.stepSeconds;
    }
  }

  /**
   * One frame. Bound as a property so it can be passed directly to the
   * scheduler without re-binding every frame.
   * @param {number} [timestampMs]
   * @private
   */
  _frame = (timestampMs) => {
    if (!this.running) return;
    this._rafId = this._schedule(this._frame);

    const frameStart = this._now();
    let frameDt = frameStart - this._lastTime;
    this._lastTime = frameStart;

    // Guard against absurd deltas from tab-switching or breakpoints. Without
    // this, returning to a backgrounded tab injects minutes of simulation.
    if (frameDt > 0.25) frameDt = 0.25;
    if (frameDt < 0) frameDt = 0;

    this.elapsed += frameDt;

    if (this._hitstopFrames > 0) {
      // During hit-stop we render but do not simulate, and we deliberately do
      // not accumulate time — otherwise the game would "catch up" in a burst
      // the instant the freeze ends, which looks like a stutter.
      this._hitstopFrames--;
    } else {
      this._accumulator += frameDt * this.timeScale;
    }

    let steps = 0;
    const updateStart = this._now();
    while (this._accumulator >= this.stepSeconds) {
      if (steps >= this.maxStepsPerFrame) {
        // Spiral-of-death protection: abandon the backlog.
        const dropped = Math.floor(this._accumulator / this.stepSeconds);
        this._droppedSteps += dropped;
        this._accumulator = 0;
        break;
      }
      this._update(this.stepSeconds);
      this._accumulator -= this.stepSeconds;
      this.tick++;
      steps++;
    }
    const updateEnd = this._now();

    // Fraction of a step remaining, for render interpolation.
    const alpha = this._accumulator / this.stepSeconds;
    this._render(alpha, frameDt);
    const renderEnd = this._now();

    // --- statistics ---
    this._statFrames++;
    this._statUpdates += steps;
    this._statFrameMs += (renderEnd - frameStart) * 1000;
    this._statUpdateMs += (updateEnd - updateStart) * 1000;
    this._statRenderMs += (renderEnd - updateEnd) * 1000;
    this._statTimer += frameDt;
    if (this._statTimer >= 1) {
      const inv = 1 / this._statFrames;
      this._stats.fps = this._statFrames / this._statTimer;
      this._stats.ups = this._statUpdates / this._statTimer;
      this._stats.frameMs = this._statFrameMs * inv;
      this._stats.updateMs = this._statUpdateMs * inv;
      this._stats.renderMs = this._statRenderMs * inv;
      this._stats.droppedSteps = this._droppedSteps;
      this._onStats?.(this._stats);
      this._statFrames = 0;
      this._statUpdates = 0;
      this._statFrameMs = 0;
      this._statUpdateMs = 0;
      this._statRenderMs = 0;
      this._statTimer = 0;
      this._droppedSteps = 0;
    }
  };

  /** @returns {LoopStats} */
  getStats() {
    return this._stats;
  }
}

/** @returns {number} seconds */
function defaultNow() {
  return (typeof performance !== 'undefined' ? performance.now() : Date.now()) / 1000;
}

/**
 * @param {(t: number) => void} cb
 * @returns {number}
 */
function defaultSchedule(cb) {
  if (typeof requestAnimationFrame !== 'undefined') return requestAnimationFrame(cb);
  return /** @type {any} */ (setTimeout(() => cb(Date.now()), 16));
}

/** @param {number} id */
function defaultCancel(id) {
  if (typeof cancelAnimationFrame !== 'undefined') cancelAnimationFrame(id);
  else clearTimeout(id);
}

/**
 * A simple countdown timer used pervasively by gameplay code (attack cooldowns,
 * invulnerability windows, AI hesitation). Centralised so the "did it fire this
 * frame" edge case is written once instead of thirty times.
 */
export class Timer {
  /** @param {number} [duration] seconds */
  constructor(duration = 0) {
    this.duration = duration;
    this.remaining = 0;
  }

  /** @param {number} [duration] overrides the stored duration */
  start(duration) {
    if (duration !== undefined) this.duration = duration;
    this.remaining = this.duration;
  }

  /** Force the timer to the finished state. */
  clear() {
    this.remaining = 0;
  }

  /**
   * @param {number} dt
   * @returns {boolean} true on the single step the timer reaches zero
   */
  tick(dt) {
    if (this.remaining <= 0) return false;
    this.remaining -= dt;
    if (this.remaining <= 0) {
      this.remaining = 0;
      return true;
    }
    return false;
  }

  /** @returns {boolean} */
  get active() {
    return this.remaining > 0;
  }

  /** @returns {boolean} */
  get finished() {
    return this.remaining <= 0;
  }

  /** @returns {number} progress in [0,1], 1 when finished */
  get progress() {
    return this.duration <= 0 ? 1 : 1 - this.remaining / this.duration;
  }
}
