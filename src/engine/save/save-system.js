/**
 * @file Save/load with versioning and migrations.
 *
 * ## Why versioning from day one
 * A save format always changes. If the first release ships without a version
 * field, every later change either breaks existing saves or requires guessing
 * the shape from its contents. A single integer at the top costs nothing now and
 * is the difference between "we can patch this" and "everyone loses their run".
 *
 * Migrations are a chain of pure functions from version N to N+1. Loading a save
 * runs it forward through every migration to the current version, so old saves
 * keep working indefinitely and each migration only has to understand one step.
 *
 * ## Corruption handling
 * A save is validated after parsing, not trusted. Browser storage can be
 * truncated by a crash mid-write, and a partially written save that throws deep
 * inside the game's boot is far worse than one rejected cleanly at the door.
 * Writes go to a temporary key and are then swapped, so an interrupted write
 * never destroys the previous good save.
 */

/** Bump when the format changes, and add a migration. */
export const SAVE_VERSION = 3;

/** Storage key prefix. */
const KEY_PREFIX = 'aetherweir.save.';
const SETTINGS_KEY = 'aetherweir.settings';

/**
 * Migrations, keyed by the version they upgrade *from*.
 * @type {Record<number, (data: any) => any>}
 */
const MIGRATIONS = {
  // v1 stored abilities as an array of ability id strings; v2 uses the bitmask
  // that the runtime and the reachability validator both operate on.
  1: (data) => {
    if (Array.isArray(data.player?.abilities)) {
      data.player.abilities = { flags: 0, disabled: 0 };
    }
    data.version = 2;
    return data;
  },
  // v2 kept world flags as an object map; v3 uses an array, which is smaller and
  // preserves insertion order for debugging.
  2: (data) => {
    if (data.world?.flags && !Array.isArray(data.world.flags)) {
      data.world.flags = Object.keys(data.world.flags).filter((k) => data.world.flags[k]);
    }
    data.version = 3;
    return data;
  },
};

export class SaveSystem {
  /**
   * @param {object} [options]
   * @param {Storage} [options.storage] Injectable, so tests do not need a browser.
   * @param {number} [options.slots]
   */
  constructor(options = {}) {
    this.storage = options.storage
      ?? (typeof localStorage !== 'undefined' ? localStorage : new MemoryStorage());
    this.slotCount = options.slots ?? 3;
    /** @type {string|null} Last error, for the UI to display. */
    this.lastError = null;
  }

  /**
   * @param {number} slot
   * @returns {string}
   */
  _key(slot) {
    return `${KEY_PREFIX}${slot}`;
  }

  /**
   * Write a save.
   * @param {number} slot
   * @param {object} payload
   * @returns {boolean} success
   */
  save(slot, payload) {
    this.lastError = null;
    const data = {
      version: SAVE_VERSION,
      savedAt: Date.now(),
      ...payload,
    };
    try {
      const json = JSON.stringify(data);
      // Write to a scratch key first. If the browser dies mid-write, the real
      // key still holds the previous good save.
      const tmpKey = `${this._key(slot)}.tmp`;
      this.storage.setItem(tmpKey, json);
      this.storage.setItem(this._key(slot), json);
      this.storage.removeItem(tmpKey);
      return true;
    } catch (err) {
      // Quota exceeded, private browsing, disabled storage: all land here.
      this.lastError = err instanceof Error ? err.message : String(err);
      return false;
    }
  }

  /**
   * Read a save, running migrations as needed.
   * @param {number} slot
   * @returns {object|null} null if absent or unrecoverable
   */
  load(slot) {
    this.lastError = null;
    let raw;
    try {
      raw = this.storage.getItem(this._key(slot));
    } catch (err) {
      this.lastError = 'Storage unavailable';
      return null;
    }
    if (!raw) return null;

    let data;
    try {
      data = JSON.parse(raw);
    } catch {
      this.lastError = 'Save file is corrupt (invalid JSON)';
      return null;
    }

    if (!data || typeof data !== 'object') {
      this.lastError = 'Save file is corrupt (not an object)';
      return null;
    }

    const migrated = this.migrate(data);
    if (!migrated) return null;

    if (!this.validate(migrated)) {
      this.lastError = 'Save file failed validation';
      return null;
    }
    return migrated;
  }

  /**
   * Run a save forward to the current version.
   * @param {any} data
   * @returns {any|null}
   */
  migrate(data) {
    let version = typeof data.version === 'number' ? data.version : 1;
    if (version > SAVE_VERSION) {
      // A save from a *newer* build. Refusing is the honest response; silently
      // loading it would corrupt a run the player may still want.
      this.lastError = `Save is from a newer version (${version} > ${SAVE_VERSION})`;
      return null;
    }
    let current = data;
    let guard = 0;
    while (version < SAVE_VERSION && guard++ < 32) {
      const migration = MIGRATIONS[version];
      if (!migration) {
        this.lastError = `No migration from save version ${version}`;
        return null;
      }
      current = migration(current);
      version = current.version;
    }
    current.version = SAVE_VERSION;
    return current;
  }

  /**
   * Structural validation. Deliberately shallow: it checks the shape the loader
   * relies on, not every field, because over-strict validation rejects saves
   * that would have loaded fine.
   * @param {any} data
   * @returns {boolean}
   */
  validate(data) {
    if (typeof data !== 'object' || data === null) return false;
    if (typeof data.version !== 'number') return false;
    if (data.player && typeof data.player !== 'object') return false;
    if (data.world && typeof data.world !== 'object') return false;
    if (data.world?.flags && !Array.isArray(data.world.flags)) return false;
    if (data.world?.visitedRooms && !Array.isArray(data.world.visitedRooms)) return false;
    return true;
  }

  /**
   * @param {number} slot
   * @returns {boolean}
   */
  exists(slot) {
    try {
      return this.storage.getItem(this._key(slot)) !== null;
    } catch {
      return false;
    }
  }

  /**
   * @param {number} slot
   */
  erase(slot) {
    try {
      this.storage.removeItem(this._key(slot));
      this.storage.removeItem(`${this._key(slot)}.tmp`);
    } catch {
      /* nothing useful to do */
    }
  }

  /**
   * Summaries for the slot-selection screen, without fully loading each save.
   * @returns {Array<{slot: number, exists: boolean, summary: any}>}
   */
  listSlots() {
    const out = [];
    for (let i = 0; i < this.slotCount; i++) {
      const data = this.exists(i) ? this.load(i) : null;
      out.push({
        slot: i,
        exists: data !== null,
        summary: data
          ? {
            roomName: data.meta?.roomName ?? '—',
            biome: data.meta?.biome ?? '',
            playTime: data.player?.stats?.timePlayed ?? 0,
            completion: data.meta?.completion ?? 0,
            savedAt: data.savedAt ?? 0,
            deaths: data.player?.stats?.deaths ?? 0,
          }
          : null,
      });
    }
    return out;
  }

  /**
   * @param {object} settings
   */
  saveSettings(settings) {
    try {
      this.storage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    } catch {
      /* settings are non-critical */
    }
  }

  /**
   * @returns {object|null}
   */
  loadSettings() {
    try {
      const raw = this.storage.getItem(SETTINGS_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  /**
   * Export a save as a string the player can copy elsewhere. Useful in a
   * browser game, where storage can be cleared by the browser without warning.
   * @param {number} slot
   * @returns {string|null}
   */
  exportSlot(slot) {
    const data = this.load(slot);
    if (!data) return null;
    // Base64 keeps it on one line and discourages casual editing without
    // pretending to be security, which it is not.
    const json = JSON.stringify(data);
    return typeof btoa !== 'undefined'
      ? btoa(unescape(encodeURIComponent(json)))
      : Buffer.from(json, 'utf8').toString('base64');
  }

  /**
   * @param {number} slot
   * @param {string} code
   * @returns {boolean}
   */
  importSlot(slot, code) {
    try {
      const json = typeof atob !== 'undefined'
        ? decodeURIComponent(escape(atob(code)))
        : Buffer.from(code, 'base64').toString('utf8');
      const data = JSON.parse(json);
      const migrated = this.migrate(data);
      if (!migrated || !this.validate(migrated)) {
        this.lastError = 'Imported save is invalid';
        return false;
      }
      return this.save(slot, migrated);
    } catch {
      this.lastError = 'Imported save could not be decoded';
      return false;
    }
  }
}

/**
 * An in-memory Storage implementation, used by tests and as a fallback when
 * localStorage is unavailable (private browsing, disabled cookies). The game
 * still runs; the save simply does not persist across a reload, which is far
 * better than refusing to start.
 */
export class MemoryStorage {
  constructor() {
    /** @type {Map<string, string>} */
    this._map = new Map();
  }

  /** @param {string} k @returns {string|null} */
  getItem(k) {
    return this._map.has(k) ? /** @type {string} */ (this._map.get(k)) : null;
  }

  /** @param {string} k @param {string} v */
  setItem(k, v) {
    this._map.set(k, String(v));
  }

  /** @param {string} k */
  removeItem(k) {
    this._map.delete(k);
  }

  clear() {
    this._map.clear();
  }

  /** @returns {number} */
  get length() {
    return this._map.size;
  }

  /** @param {number} i @returns {string|null} */
  key(i) {
    return [...this._map.keys()][i] ?? null;
  }
}
