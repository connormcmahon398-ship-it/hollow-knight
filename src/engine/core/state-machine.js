/**
 * @file Hierarchical finite state machine used by the player, enemies and bosses.
 *
 * ## Why a shared HFSM rather than per-entity `if` chains?
 * Character logic is where games rot fastest. A player controller written as
 * nested conditionals ("if not dashing and not attacking and grounded and ...")
 * grows quadratically: every new ability must be excluded from every existing
 * branch. An explicit state machine inverts this — each state declares only its
 * own behaviour and its own exits, so adding a state is additive.
 *
 * ## Design choices
 * 1. **States are objects, not classes-by-convention.** A state is any object with
 *    optional `enter/exit/update/lateUpdate/onEvent` hooks. This keeps trivial
 *    states as three-line literals while allowing complex ones to be classes.
 * 2. **Transitions are requested, not performed.** `machine.change(name)` defers
 *    the actual swap to a safe point so a state cannot destroy itself midway
 *    through its own `update`.
 * 3. **`canExit` guards** let a state refuse interruption (e.g. an attack's
 *    recovery frames), which is essential for combat feel.
 * 4. **Time-in-state is tracked centrally** because nearly every state needs it
 *    and hand-rolling it per state is a reliable source of bugs.
 */

/**
 * @typedef {Object} State
 * @property {string} [name] Auto-filled by the machine on registration.
 * @property {(prev: string|null, params?: any) => void} [enter]
 * @property {(next: string|null) => void} [exit]
 * @property {(dt: number) => void} [update]
 * @property {(dt: number) => void} [lateUpdate]
 * @property {(type: string, payload?: any) => boolean|void} [onEvent] Return true to consume.
 * @property {(next: string) => boolean} [canExit] Return false to block a transition.
 */

export class StateMachine {
  /**
   * @param {object} [options]
   * @param {string} [options.debugName] Included in error messages.
   * @param {(from: string|null, to: string) => void} [options.onTransition]
   */
  constructor(options = {}) {
    /** @type {Map<string, State>} */
    this.states = new Map();
    /** @type {State|null} */
    this.current = null;
    /** @type {string|null} */
    this.currentName = null;
    /** @type {string|null} */
    this.previousName = null;
    /** Seconds spent in the current state. */
    this.timeInState = 0;
    /** Frames spent in the current state. */
    this.framesInState = 0;
    /** @type {{name: string, params: any}|null} */
    this._pending = null;
    this._debugName = options.debugName ?? 'StateMachine';
    this._onTransition = options.onTransition ?? null;
    this._transitioning = false;
    /** @type {string[]} Ring buffer of recent states, for debugging. */
    this.history = [];
    this._historyLimit = 12;
  }

  /**
   * @param {string} name
   * @param {State} state
   * @returns {this}
   */
  add(name, state) {
    if (this.states.has(name)) {
      throw new Error(`${this._debugName}: duplicate state "${name}"`);
    }
    state.name = name;
    this.states.set(name, state);
    return this;
  }

  /**
   * Register several states at once from a plain object.
   * @param {Record<string, State>} map
   * @returns {this}
   */
  addAll(map) {
    for (const key of Object.keys(map)) this.add(key, map[key]);
    return this;
  }

  /** @param {string} name @returns {boolean} */
  has(name) {
    return this.states.has(name);
  }

  /** @param {string} name @returns {boolean} */
  is(name) {
    return this.currentName === name;
  }

  /**
   * @param {...string} names
   * @returns {boolean} true if the current state is any of `names`
   */
  isAny(...names) {
    return this.currentName !== null && names.includes(this.currentName);
  }

  /**
   * Enter a state directly, bypassing `canExit` guards. Used for initialisation
   * and for hard resets (respawn, room load).
   * @param {string} name
   * @param {any} [params]
   */
  force(name, params) {
    this._pending = null;
    this._doTransition(name, params);
  }

  /**
   * Request a transition. Honours the current state's `canExit` guard.
   * The transition is applied at the next {@link resolve} (called automatically
   * at the start of {@link update}), so it is always safe to call from inside a
   * state's own `update`.
   * @param {string} name
   * @param {any} [params]
   * @returns {boolean} false if the transition was refused by a guard
   */
  change(name, params) {
    if (!this.states.has(name)) {
      throw new Error(`${this._debugName}: unknown state "${name}"`);
    }
    if (this.currentName === name) return false;
    if (this.current?.canExit && this.current.canExit(name) === false) return false;
    this._pending = { name, params };
    return true;
  }

  /** Apply any pending transition. Safe to call at any point in the frame. */
  resolve() {
    // A loop, because a state's `enter` may immediately request another change
    // (e.g. Land -> Idle when there is no landing lag). Bounded to catch cycles.
    let guard = 0;
    while (this._pending && guard++ < 16) {
      const { name, params } = this._pending;
      this._pending = null;
      this._doTransition(name, params);
    }
    if (guard >= 16) {
      throw new Error(`${this._debugName}: transition loop detected around "${this.currentName}"`);
    }
  }

  /**
   * @param {number} dt seconds
   */
  update(dt) {
    this.resolve();
    if (!this.current) return;
    this.timeInState += dt;
    this.framesInState++;
    this.current.update?.(dt);
    this.resolve();
  }

  /**
   * Second update pass, run after physics has been integrated. Lets states react
   * to collision results (e.g. "I was airborne, now I am grounded -> Land").
   * @param {number} dt
   */
  lateUpdate(dt) {
    if (!this.current) return;
    this.current.lateUpdate?.(dt);
    this.resolve();
  }

  /**
   * Offer an event to the current state.
   * @param {string} type
   * @param {any} [payload]
   * @returns {boolean} true if consumed
   */
  handleEvent(type, payload) {
    const consumed = this.current?.onEvent?.(type, payload) === true;
    this.resolve();
    return consumed;
  }

  /**
   * @param {string} name
   * @param {any} params
   * @private
   */
  _doTransition(name, params) {
    const next = this.states.get(name);
    if (!next) throw new Error(`${this._debugName}: unknown state "${name}"`);
    if (this._transitioning) {
      // Re-entrancy would corrupt previousName/timeInState bookkeeping.
      throw new Error(`${this._debugName}: re-entrant transition into "${name}"`);
    }
    this._transitioning = true;
    try {
      const from = this.currentName;
      this.current?.exit?.(name);
      this.previousName = from;
      this.current = next;
      this.currentName = name;
      this.timeInState = 0;
      this.framesInState = 0;
      this.history.push(name);
      if (this.history.length > this._historyLimit) this.history.shift();
      this._onTransition?.(from, name);
      next.enter?.(from, params);
    } finally {
      this._transitioning = false;
    }
  }
}
