/**
 * @file A synchronous, deferred-dispatch event bus.
 *
 * ## Why an event bus?
 * The alternative is direct references: combat calls into audio, audio calls into
 * UI, UI calls into save. That produces a dependency web where nothing can be
 * tested or replaced in isolation. With a bus, `CombatSystem` emits
 * `damage:dealt` and neither knows nor cares that audio, particles, the HUD and
 * the achievement tracker are all listening.
 *
 * ## Why deferred dispatch?
 * Naive buses invoke listeners immediately, which lets a listener mutate the
 * world mid-iteration — the classic "enemy died during the enemy update loop and
 * corrupted the array" bug. `EventBus` therefore supports two modes:
 *
 *  - `emit()`   — immediate, for events that must be observed synchronously
 *                 (e.g. a query-style event, or damage modification hooks).
 *  - `queue()`  — appended to a buffer and flushed at a well-defined point in
 *                 the frame (end of update), which is safe for anything
 *                 structural (spawning, despawning, room transitions).
 *
 * Listener mutation during dispatch is handled by iterating a snapshot.
 */

/**
 * @typedef {(payload: any) => void} Listener
 */

export class EventBus {
  constructor() {
    /** @type {Map<string, Listener[]>} */
    this._listeners = new Map();
    /** @type {Map<string, Listener[]>} */
    this._onceListeners = new Map();
    /** @type {Array<{type: string, payload: any}>} */
    this._queue = [];
    /** @type {Array<{type: string, payload: any}>} */
    this._swapQueue = [];
    /** @type {((type: string, payload: any) => void)|null} */
    this._monitor = null;
    this._depth = 0;
  }

  /**
   * Subscribe to an event.
   * @param {string} type
   * @param {Listener} fn
   * @returns {() => void} unsubscribe function
   */
  on(type, fn) {
    let arr = this._listeners.get(type);
    if (!arr) {
      arr = [];
      this._listeners.set(type, arr);
    }
    arr.push(fn);
    return () => this.off(type, fn);
  }

  /**
   * Subscribe to the next occurrence only.
   * @param {string} type
   * @param {Listener} fn
   * @returns {() => void} unsubscribe function
   */
  once(type, fn) {
    let arr = this._onceListeners.get(type);
    if (!arr) {
      arr = [];
      this._onceListeners.set(type, arr);
    }
    arr.push(fn);
    return () => {
      const list = this._onceListeners.get(type);
      if (!list) return;
      const i = list.indexOf(fn);
      if (i >= 0) list.splice(i, 1);
    };
  }

  /**
   * @param {string} type
   * @param {Listener} fn
   */
  off(type, fn) {
    const arr = this._listeners.get(type);
    if (!arr) return;
    const i = arr.indexOf(fn);
    if (i >= 0) arr.splice(i, 1);
    if (arr.length === 0) this._listeners.delete(type);
  }

  /**
   * Remove every listener for a type, or all listeners entirely.
   * Called on scene teardown to prevent leaks across room/scene changes.
   * @param {string} [type]
   */
  clear(type) {
    if (type === undefined) {
      this._listeners.clear();
      this._onceListeners.clear();
      this._queue.length = 0;
    } else {
      this._listeners.delete(type);
      this._onceListeners.delete(type);
    }
  }

  /**
   * Dispatch immediately to all listeners.
   * @param {string} type
   * @param {any} [payload]
   */
  emit(type, payload) {
    if (this._monitor) this._monitor(type, payload);
    // Recursion guard: a listener that re-emits the same event forever would
    // otherwise blow the stack with an unhelpful trace.
    if (this._depth > 32) {
      throw new Error(`EventBus: dispatch depth exceeded while emitting "${type}" (probable emit loop)`);
    }
    this._depth++;
    try {
      const arr = this._listeners.get(type);
      if (arr && arr.length) {
        // Snapshot so listeners may safely subscribe/unsubscribe during dispatch.
        const snapshot = arr.length === 1 ? arr : arr.slice();
        for (let i = 0; i < snapshot.length; i++) snapshot[i](payload);
      }
      const onceArr = this._onceListeners.get(type);
      if (onceArr && onceArr.length) {
        this._onceListeners.delete(type);
        for (let i = 0; i < onceArr.length; i++) onceArr[i](payload);
      }
    } finally {
      this._depth--;
    }
  }

  /**
   * Defer an event until the next {@link flush}. Use for structural changes.
   * @param {string} type
   * @param {any} [payload]
   */
  queue(type, payload) {
    this._queue.push({ type, payload });
  }

  /**
   * Dispatch all queued events. Events queued *during* the flush are processed
   * in subsequent passes, bounded to avoid an infinite cascade.
   * @param {number} [maxPasses]
   */
  flush(maxPasses = 8) {
    let pass = 0;
    while (this._queue.length > 0 && pass < maxPasses) {
      // Swap buffers so newly queued events land in a clean array.
      const batch = this._queue;
      this._queue = this._swapQueue;
      this._swapQueue = batch;
      for (let i = 0; i < batch.length; i++) {
        this.emit(batch[i].type, batch[i].payload);
      }
      batch.length = 0;
      pass++;
    }
    if (this._queue.length > 0) {
      console.warn(`EventBus.flush: ${this._queue.length} events still queued after ${maxPasses} passes; dropping to avoid a stall.`);
      this._queue.length = 0;
    }
  }

  /**
   * @param {string} type
   * @returns {number} number of persistent listeners
   */
  listenerCount(type) {
    return (this._listeners.get(type)?.length ?? 0) + (this._onceListeners.get(type)?.length ?? 0);
  }

  /**
   * Install a debug hook that observes every immediate dispatch.
   * @param {((type: string, payload: any) => void)|null} fn
   */
  setMonitor(fn) {
    this._monitor = fn;
  }
}

/**
 * Canonical event names. Using constants instead of bare strings gives us
 * a single place to audit the game's cross-system vocabulary, and makes typos
 * a load-time failure in tooling rather than a silent no-op at runtime.
 */
export const Events = Object.freeze({
  // --- Combat ---
  DAMAGE_DEALT: 'damage:dealt',
  DAMAGE_TAKEN: 'damage:taken',
  ENTITY_KILLED: 'entity:killed',
  ATTACK_STARTED: 'attack:started',
  ATTACK_CONNECTED: 'attack:connected',
  PARRIED: 'combat:parried',

  // --- Player ---
  PLAYER_SPAWNED: 'player:spawned',
  PLAYER_DIED: 'player:died',
  PLAYER_RESPAWNED: 'player:respawned',
  PLAYER_HEALED: 'player:healed',
  PLAYER_LANDED: 'player:landed',
  PLAYER_JUMPED: 'player:jumped',
  PLAYER_DASHED: 'player:dashed',
  ABILITY_UNLOCKED: 'ability:unlocked',

  // --- World ---
  ROOM_ENTERED: 'room:entered',
  ROOM_EXITED: 'room:exited',
  ROOM_CLEARED: 'room:cleared',
  BIOME_ENTERED: 'biome:entered',
  DOOR_OPENED: 'door:opened',
  SECRET_FOUND: 'secret:found',

  // --- Progression ---
  ITEM_ACQUIRED: 'item:acquired',
  UPGRADE_ACQUIRED: 'upgrade:acquired',
  SEAL_EQUIPPED: 'seal:equipped',
  SEAL_UNEQUIPPED: 'seal:unequipped',
  CURRENCY_CHANGED: 'currency:changed',
  INSCRIPTION_TRANSCRIBED: 'inscription:transcribed',

  // --- Quest / narrative ---
  QUEST_STARTED: 'quest:started',
  QUEST_ADVANCED: 'quest:advanced',
  QUEST_COMPLETED: 'quest:completed',
  QUEST_FAILED: 'quest:failed',
  FLAG_SET: 'flag:set',
  DIALOGUE_STARTED: 'dialogue:started',
  DIALOGUE_ENDED: 'dialogue:ended',
  DIALOGUE_CHOICE: 'dialogue:choice',

  // --- Boss ---
  BOSS_ENCOUNTER_STARTED: 'boss:started',
  BOSS_PHASE_CHANGED: 'boss:phase',
  BOSS_DEFEATED: 'boss:defeated',

  // --- Meta ---
  GAME_SAVED: 'game:saved',
  GAME_LOADED: 'game:loaded',
  CHECKPOINT_REACHED: 'checkpoint:reached',
  FAST_TRAVEL_USED: 'fasttravel:used',
  SCENE_CHANGED: 'scene:changed',
  ENDING_REACHED: 'ending:reached',

  // --- Presentation (listened to by audio / fx / camera) ---
  SFX: 'fx:sfx',
  SCREEN_SHAKE: 'fx:shake',
  HITSTOP: 'fx:hitstop',
  SPAWN_PARTICLES: 'fx:particles',
  FLASH: 'fx:flash',
});
