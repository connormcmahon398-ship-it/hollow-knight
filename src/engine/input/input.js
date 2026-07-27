/**
 * @file Input: keyboard, gamepad, rebinding, and the buffering that makes
 * action platformers feel responsive.
 *
 * ## Actions, not keys
 * Gameplay code asks `input.pressed(Action.JUMP)`, never `KeyW`. Bindings are
 * data, which is what makes remapping, gamepad support and the "press any key to
 * bind" UI possible without touching gameplay.
 *
 * ## Input buffering — the important part
 * Two mechanisms account for most of the difference between a platformer that
 * feels tight and one that feels unresponsive, and neither is about latency:
 *
 * - **Buffered presses.** A jump pressed up to ~120ms *before* landing still
 *   fires on touchdown. Without it, players who press jump slightly early get
 *   nothing, and the game feels like it dropped their input — because from the
 *   player's point of view, it did.
 * - **Coyote time** (implemented in the character controller, driven by this
 *   module's timing) lets a jump register for a few frames *after* walking off
 *   a ledge.
 *
 * Both are implemented as timestamps rather than booleans, so a consumer can ask
 * "was this pressed within the last N seconds" and then *consume* it, which
 * prevents one press triggering two actions.
 *
 * ## Polling model
 * Browser key events are asynchronous but the simulation is a fixed timestep.
 * Events are therefore accumulated into a pending set and folded into the
 * action state once per simulation step, so a key pressed and released between
 * two steps is never silently lost.
 */

/** Canonical game actions. */
export const Action = Object.freeze({
  LEFT: 'left',
  RIGHT: 'right',
  UP: 'up',
  DOWN: 'down',
  JUMP: 'jump',
  ATTACK: 'attack',
  DASH: 'dash',
  SCRIPT: 'script',        // cast the equipped ink-script
  FOCUS: 'focus',          // channel to heal
  INTERACT: 'interact',
  MAP: 'map',
  INVENTORY: 'inventory',
  PAUSE: 'pause',
  CONFIRM: 'confirm',
  CANCEL: 'cancel',
  QUICK_CAST: 'quickCast',
  DEBUG: 'debug',
});

/**
 * Default keyboard bindings. Two schemes are provided out of the box (WASD and
 * arrows) because forcing a choice at first launch is a bad first impression.
 * @type {Record<string, string[]>}
 */
export const DEFAULT_KEY_BINDINGS = {
  [Action.LEFT]: ['ArrowLeft', 'KeyA'],
  [Action.RIGHT]: ['ArrowRight', 'KeyD'],
  [Action.UP]: ['ArrowUp', 'KeyW'],
  [Action.DOWN]: ['ArrowDown', 'KeyS'],
  [Action.JUMP]: ['KeyZ', 'Space'],
  [Action.ATTACK]: ['KeyX', 'KeyJ'],
  [Action.DASH]: ['KeyC', 'ShiftLeft', 'ShiftRight'],
  [Action.SCRIPT]: ['KeyV', 'KeyK'],
  [Action.FOCUS]: ['KeyF', 'KeyL'],
  [Action.INTERACT]: ['KeyE', 'ArrowUp', 'KeyW'],
  [Action.MAP]: ['KeyM', 'Tab'],
  [Action.INVENTORY]: ['KeyI'],
  [Action.PAUSE]: ['Escape'],
  [Action.CONFIRM]: ['Enter', 'KeyZ', 'Space'],
  [Action.CANCEL]: ['Escape', 'KeyX'],
  [Action.QUICK_CAST]: ['KeyQ'],
  [Action.DEBUG]: ['Backquote'],
};

/**
 * Standard Gamepad API button indices.
 * @type {Record<string, number[]>}
 */
export const DEFAULT_PAD_BINDINGS = {
  [Action.JUMP]: [0],          // A / cross
  [Action.ATTACK]: [2],        // X / square
  [Action.DASH]: [5, 7],       // right shoulder / trigger
  [Action.SCRIPT]: [3],        // Y / triangle
  [Action.FOCUS]: [1],         // B / circle
  [Action.INTERACT]: [3],
  [Action.MAP]: [8],
  [Action.INVENTORY]: [4],
  [Action.PAUSE]: [9],
  [Action.CONFIRM]: [0],
  [Action.CANCEL]: [1],
  [Action.QUICK_CAST]: [6],
  [Action.UP]: [12],
  [Action.DOWN]: [13],
  [Action.LEFT]: [14],
  [Action.RIGHT]: [15],
};

/** How long a press stays available to be consumed, in seconds. */
export const DEFAULT_BUFFER_TIME = 0.12;

export class InputManager {
  /**
   * @param {object} [options]
   * @param {number} [options.bufferTime]
   * @param {EventTarget} [options.target] Defaults to `window`.
   */
  constructor(options = {}) {
    this.bufferTime = options.bufferTime ?? DEFAULT_BUFFER_TIME;

    /** @type {Record<string, string[]>} */
    this.keyBindings = structuredCloneCompat(DEFAULT_KEY_BINDINGS);
    /** @type {Record<string, number[]>} */
    this.padBindings = structuredCloneCompat(DEFAULT_PAD_BINDINGS);

    /** Raw key state, updated by DOM events. @type {Set<string>} */
    this._keysDown = new Set();
    /** Keys that went down since the last poll. @type {Set<string>} */
    this._keysPressedPending = new Set();
    /** Keys that went up since the last poll. @type {Set<string>} */
    this._keysReleasedPending = new Set();

    /** Per-action state. @type {Map<string, ActionState>} */
    this._actions = new Map();
    for (const name of Object.values(Action)) {
      this._actions.set(name, { down: false, pressedAt: -Infinity, releasedAt: -Infinity, consumedAt: -Infinity });
    }

    /** Simulation time, advanced by `update`. */
    this.time = 0;

    /** Analog stick values, -1..1. */
    this.axisX = 0;
    this.axisY = 0;

    /** Analog stick values from the pad only, after deadzone. */
    this._padAxisX = 0;
    this._padAxisY = 0;
    /** @type {boolean[]|null} */
    this._padCurrentButtons = null;
    /** Index of the active gamepad, or -1. */
    this.padIndex = -1;
    this._padPrevButtons = /** @type {boolean[]} */ ([]);

    /**
     * When set, the next key press is captured for rebinding instead of being
     * routed to gameplay.
     * @type {((code: string) => void)|null}
     */
    this._rebindCallback = null;

    /** True when the game window has focus; used to release stuck keys. */
    this.hasFocus = true;

    /** Set while any input is from a gamepad, so the UI can show pad prompts. */
    this.lastInputWasPad = false;

    this._target = options.target ?? (typeof window !== 'undefined' ? window : null);
    this._listeners = [];
    /** Records recent inputs for the debug overlay. @type {string[]} */
    this.recentInputs = [];
  }

  /** Attach DOM listeners. Safe to call once; call `detach` on teardown. */
  attach() {
    if (!this._target) return;
    const onKeyDown = /** @param {KeyboardEvent} e */ (e) => {
      // Never swallow browser shortcuts involving modifiers (Ctrl+R, Cmd+Q).
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (this._rebindCallback) {
        e.preventDefault();
        const cb = this._rebindCallback;
        this._rebindCallback = null;
        cb(e.code);
        return;
      }
      if (!e.repeat) {
        this._keysPressedPending.add(e.code);
        this.lastInputWasPad = false;
      }
      this._keysDown.add(e.code);
      if (this._isBoundKey(e.code)) e.preventDefault();
    };
    const onKeyUp = /** @param {KeyboardEvent} e */ (e) => {
      this._keysDown.delete(e.code);
      this._keysReleasedPending.add(e.code);
      if (this._isBoundKey(e.code)) e.preventDefault();
    };
    const onBlur = () => {
      this.hasFocus = false;
      // Releasing everything on blur prevents the classic "alt-tabbed while
      // holding right, came back walking into a wall forever" bug.
      this.releaseAll();
    };
    const onFocus = () => { this.hasFocus = true; };

    this._addListener('keydown', onKeyDown);
    this._addListener('keyup', onKeyUp);
    this._addListener('blur', onBlur);
    this._addListener('focus', onFocus);
  }

  /**
   * @param {string} type
   * @param {(e: any) => void} fn
   * @private
   */
  _addListener(type, fn) {
    this._target?.addEventListener(type, fn);
    this._listeners.push({ type, fn });
  }

  /** Remove all DOM listeners. */
  detach() {
    for (const { type, fn } of this._listeners) this._target?.removeEventListener(type, fn);
    this._listeners.length = 0;
  }

  /**
   * @param {string} code
   * @returns {boolean}
   * @private
   */
  _isBoundKey(code) {
    for (const keys of Object.values(this.keyBindings)) {
      if (keys.includes(code)) return true;
    }
    return false;
  }

  /** Clear all held state. */
  releaseAll() {
    this._keysDown.clear();
    for (const state of this._actions.values()) {
      if (state.down) {
        state.down = false;
        state.releasedAt = this.time;
      }
    }
    this.axisX = 0;
    this.axisY = 0;
  }

  /**
   * Fold pending events and gamepad state into action state.
   * Called once per fixed simulation step.
   * @param {number} dt
   */
  update(dt) {
    this.time += dt;
    this._pollGamepad();

    for (const [name, state] of this._actions) {
      const keys = this.keyBindings[name] ?? [];
      let downNow = false;
      let pressedNow = false;

      for (const key of keys) {
        if (this._keysDown.has(key)) downNow = true;
        if (this._keysPressedPending.has(key)) pressedNow = true;
      }

      if (this._padDown(name)) downNow = true;
      if (this._padPressed(name)) {
        pressedNow = true;
        this.lastInputWasPad = true;
      }

      if (pressedNow || (downNow && !state.down)) {
        state.pressedAt = this.time;
        // A fresh press invalidates any previous consumption, so holding the
        // button does not let a stale consume block the new one.
        state.consumedAt = -Infinity;
        if (this.recentInputs.length > 24) this.recentInputs.shift();
        this.recentInputs.push(name);
      }
      if (!downNow && state.down) {
        state.releasedAt = this.time;
      }
      state.down = downNow;
    }

    this._keysPressedPending.clear();
    this._keysReleasedPending.clear();

    // The axes are recomputed from scratch every step rather than being nudged
    // toward the current input. An earlier version only raised the axis when
    // the new magnitude was larger, which meant it latched: once a direction
    // was pressed the axis never returned to zero, and the character walked in
    // that direction forever. Deriving state fresh each step makes that class
    // of bug impossible.
    const digitalX = (this.isDown(Action.RIGHT) ? 1 : 0) - (this.isDown(Action.LEFT) ? 1 : 0);
    const digitalY = (this.isDown(Action.DOWN) ? 1 : 0) - (this.isDown(Action.UP) ? 1 : 0);
    this.axisX = digitalX;
    this.axisY = digitalY;
    // An analog stick wins only where it is deflected further than the d-pad,
    // so holding both does the intuitive thing instead of fighting.
    if (Math.abs(this._padAxisX) > Math.abs(this.axisX)) this.axisX = this._padAxisX;
    if (Math.abs(this._padAxisY) > Math.abs(this.axisY)) this.axisY = this._padAxisY;
  }

  /** @private */
  _pollGamepad() {
    // Reset first: bailing out early without clearing would leave the last
    // polled stick value latched after the pad is unplugged.
    this._padAxisX = 0;
    this._padAxisY = 0;
    if (typeof navigator === 'undefined' || !navigator.getGamepads) {
      this._padCurrentButtons = null;
      return;
    }
    const pads = navigator.getGamepads();
    /** @type {Gamepad|null} */
    let pad = null;
    for (let i = 0; i < pads.length; i++) {
      if (pads[i] && pads[i].connected) {
        pad = pads[i];
        this.padIndex = i;
        break;
      }
    }
    if (!pad) {
      this.padIndex = -1;
      this._padPrevButtons.length = 0;
      this._padCurrentButtons = null;
      return;
    }

    // Deadzone rejects stick drift, which would otherwise read as a constant
    // walk on a well-used controller.
    const dz = 0.28;
    const ax = pad.axes[0] ?? 0;
    const ay = pad.axes[1] ?? 0;
    this._padAxisX = Math.abs(ax) > dz ? ax : 0;
    this._padAxisY = Math.abs(ay) > dz ? ay : 0;
    if (this._padAxisX !== 0 || this._padAxisY !== 0) this.lastInputWasPad = true;

    this._padCurrentButtons = pad.buttons.map((b) => b.pressed);
  }

  /**
   * @param {string} action
   * @returns {boolean}
   * @private
   */
  _padDown(action) {
    const buttons = this._padCurrentButtons;
    if (!buttons) return false;
    const indices = this.padBindings[action];
    if (!indices) return false;
    for (const i of indices) if (buttons[i]) return true;
    return false;
  }

  /**
   * @param {string} action
   * @returns {boolean}
   * @private
   */
  _padPressed(action) {
    const buttons = this._padCurrentButtons;
    if (!buttons) return false;
    const indices = this.padBindings[action];
    if (!indices) return false;
    for (const i of indices) {
      if (buttons[i] && !this._padPrevButtons[i]) return true;
    }
    return false;
  }

  /** Snapshot gamepad buttons for edge detection. Call at end of the step. */
  endStep() {
    if (this._padCurrentButtons) {
      this._padPrevButtons = this._padCurrentButtons.slice();
    }
  }

  /**
   * @param {string} action
   * @returns {boolean} true while held
   */
  isDown(action) {
    return this._actions.get(action)?.down ?? false;
  }

  /**
   * True if the action was pressed within the buffer window and has not been
   * consumed. **Does not consume** — use `consume` for that.
   * @param {string} action
   * @param {number} [window] override the buffer window
   * @returns {boolean}
   */
  pressed(action, window = this.bufferTime) {
    const s = this._actions.get(action);
    if (!s) return false;
    if (s.consumedAt >= s.pressedAt) return false;
    return this.time - s.pressedAt <= window;
  }

  /**
   * Consume a buffered press. Returns whether there was one.
   *
   * Consuming is what stops a single jump press from being used by both the
   * jump state and the wall-jump state in the same frame.
   * @param {string} action
   * @param {number} [window]
   * @returns {boolean}
   */
  consume(action, window = this.bufferTime) {
    if (!this.pressed(action, window)) return false;
    const s = /** @type {ActionState} */ (this._actions.get(action));
    s.consumedAt = this.time;
    return true;
  }

  /**
   * Discard any buffered press without acting on it. Used when entering a state
   * that should not inherit inputs (e.g. opening a menu).
   * @param {string} action
   */
  clearBuffer(action) {
    const s = this._actions.get(action);
    if (s) s.consumedAt = this.time;
  }

  /** Clear every buffered press. */
  clearAllBuffers() {
    for (const s of this._actions.values()) s.consumedAt = this.time;
  }

  /**
   * @param {string} action
   * @returns {boolean} true if released within the buffer window
   */
  released(action, window = this.bufferTime) {
    const s = this._actions.get(action);
    if (!s) return false;
    return !s.down && this.time - s.releasedAt <= window;
  }

  /**
   * Seconds the action has been held, or 0 when not held.
   * Used for variable-height jumps and charged attacks.
   * @param {string} action
   * @returns {number}
   */
  heldFor(action) {
    const s = this._actions.get(action);
    if (!s || !s.down) return 0;
    return this.time - s.pressedAt;
  }

  /** @returns {number} -1, 0 or 1 */
  moveDirection() {
    const x = this.axisX;
    if (x > 0.3) return 1;
    if (x < -0.3) return -1;
    return 0;
  }

  /** @returns {number} -1 (up), 0 or 1 (down) */
  verticalDirection() {
    const y = this.axisY;
    if (y > 0.5) return 1;
    if (y < -0.5) return -1;
    return 0;
  }

  /**
   * Begin capturing the next key press for rebinding.
   * @param {(code: string) => void} callback
   */
  captureNextKey(callback) {
    this._rebindCallback = callback;
  }

  /** @returns {boolean} */
  get isCapturing() {
    return this._rebindCallback !== null;
  }

  /**
   * Replace the binding list for one action.
   * @param {string} action
   * @param {string[]} keys
   */
  setBinding(action, keys) {
    this.keyBindings[action] = keys.slice();
  }

  /** Restore factory bindings. */
  resetBindings() {
    this.keyBindings = structuredCloneCompat(DEFAULT_KEY_BINDINGS);
    this.padBindings = structuredCloneCompat(DEFAULT_PAD_BINDINGS);
  }

  /** @returns {Record<string, string[]>} serialisable binding state */
  serializeBindings() {
    return structuredCloneCompat(this.keyBindings);
  }

  /** @param {Record<string, string[]>} data */
  loadBindings(data) {
    if (!data) return;
    for (const [action, keys] of Object.entries(data)) {
      if (Array.isArray(keys)) this.keyBindings[action] = keys.slice();
    }
  }

  // --- test / headless support ---

  /**
   * Simulate a key press. Used by tests and by the attract-mode demo.
   * @param {string} code
   */
  pressKey(code) {
    this._keysDown.add(code);
    this._keysPressedPending.add(code);
  }

  /** @param {string} code */
  releaseKey(code) {
    this._keysDown.delete(code);
    this._keysReleasedPending.add(code);
  }
}

/**
 * @typedef {Object} ActionState
 * @property {boolean} down
 * @property {number} pressedAt
 * @property {number} releasedAt
 * @property {number} consumedAt
 */

/**
 * `structuredClone` is not available in every target; these payloads are plain
 * JSON so a round-trip is equivalent and dependency-free.
 * @template T
 * @param {T} obj
 * @returns {T}
 */
function structuredCloneCompat(obj) {
  return JSON.parse(JSON.stringify(obj));
}
