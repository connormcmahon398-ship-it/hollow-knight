/**
 * @file Rooms: the unit of level design, and the ASCII authoring format.
 *
 * ## Why rooms rather than one continuous world
 * A single seamless tilemap sounds ideal and is a trap: it makes streaming,
 * culling, save-state, the map screen and enemy respawn all global problems. A
 * room is a natural boundary for every one of those. The world *feels*
 * continuous because transitions preserve momentum and take about a fifth of a
 * second — the player never has a loading screen, only a doorway.
 *
 * ## The authoring format
 * Rooms are authored as ASCII art with a metadata header. That choice is
 * deliberate:
 *  - A room's shape is legible in a diff, so level design is reviewable.
 *  - It is directly editable by hand *and* by the level editor, which writes
 *    the same format back out.
 *  - It cannot encode an invalid tile, because unknown glyphs are rejected at
 *    load rather than silently becoming empty space.
 *
 * Entities are placed with a second pass of *marker glyphs* that are stripped
 * from the collision layer, so an enemy marker never accidentally leaves a hole
 * in the floor.
 *
 * ## Connections
 * Each room declares its exits by edge and tile offset. The world builder
 * cross-checks that every exit has a matching entrance on the other side, which
 * catches the single most common level-design error — a door to nowhere — at
 * build time.
 */

import { Tilemap } from '../../engine/physics/tilemap.js';
import { Tiles, tileFromGlyph, TILE_SIZE, getTileDef } from '../../engine/physics/tiles.js';
import { AABB } from '../../engine/math/aabb.js';
import { parseAbilityMask } from '../player/abilities.js';

/**
 * Glyphs that mark an entity rather than a tile.
 * @type {Readonly<Record<string, string>>}
 */
export const MARKERS = Object.freeze({
  PLAYER_SPAWN: '@',
  ENEMY: 'e',
  BOSS: 'B',
  NPC: 'n',
  ITEM: 'I',
  CHECKPOINT: 'W',   // Wellspring: rest, save, respawn point
  GATE_STONE: 'G',   // fast-travel node
  INSCRIPTION: '?',  // lore the player transcribes
  SECRET: 's',       // hidden reward marker
  DOOR: 'D',
  ANCHOR: 'a',       // grapple anchor
  LORE_PROP: 'k',
  SHOP: '$',
});

const MARKER_SET = new Set(Object.values(MARKERS));

/**
 * @typedef {Object} RoomExit
 * @property {string} edge 'left' | 'right' | 'top' | 'bottom'
 * @property {number} offset Tile offset along that edge.
 * @property {number} span How many tiles wide/tall the doorway is.
 * @property {string} to Destination room id.
 * @property {number|string} [gate] Ability mask, or an ability-name string like 'skim|paperwing'.
 * @property {string} [requiresFlag] World flag that must be set.
 */

/**
 * @typedef {Object} RoomSpawn
 * @property {string} kind 'enemy'|'boss'|'npc'|'item'|'checkpoint'|'gate'|'inscription'|'secret'|'anchor'|'shop'|'prop'
 * @property {string} id
 * @property {number} x pixel, centre
 * @property {number} y pixel, feet
 * @property {any} [data]
 */

/**
 * @typedef {Object} RoomDef
 * @property {string} id
 * @property {string} name
 * @property {string} biome
 * @property {string[]} art Rows of the tile layer.
 * @property {RoomExit[]} [exits]
 * @property {Record<string, string|{id: string, data?: any}|Array<string|{id: string, data?: any}>>} [markers]
 *   Maps a marker glyph occurrence index or a named key to what it spawns.
 * @property {number|string} [gate] Ability mask, or an ability-name string.
 * @property {boolean} [isBossArena]
 * @property {boolean} [isSafe] No enemies; used for hubs and rest rooms.
 * @property {boolean} [secret] Not shown on the map until entered.
 * @property {string} [music] Overrides the biome's track.
 * @property {string} [ambientOverride]
 * @property {number} [worldX] Position on the world map, in room units.
 * @property {number} [worldY]
 * @property {string} [lore] Environmental storytelling note for this room.
 */

export class Room {
  /**
   * @param {RoomDef} def
   */
  constructor(def) {
    this.def = def;
    this.id = def.id;
    this.name = def.name;
    this.biome = def.biome;
    this.gate = typeof def.gate === 'string' ? parseAbilityMask(def.gate) : (def.gate ?? 0);
    this.isBossArena = def.isBossArena ?? false;
    this.isSafe = def.isSafe ?? false;
    this.secret = def.secret ?? false;
    this.music = def.music ?? null;
    this.worldX = def.worldX ?? 0;
    this.worldY = def.worldY ?? 0;
    this.lore = def.lore ?? '';

    const parsed = parseRoomArt(def.art, def.markers ?? {});
    /** @type {Tilemap} */
    this.map = parsed.map;
    /** @type {RoomSpawn[]} */
    this.spawns = parsed.spawns;
    /** @type {{x: number, y: number}|null} */
    this.playerSpawn = parsed.playerSpawn;

    this.widthTiles = this.map.width;
    this.heightTiles = this.map.height;
    /** Pixel-space bounds; rooms are always positioned at the origin locally. */
    this.bounds = new AABB(0, 0, this.map.pixelWidth, this.map.pixelHeight);

    /** @type {RoomExit[]} */
    this.exits = (def.exits ?? []).map((x) => ({
      ...x,
      gate: typeof x.gate === 'string' ? parseAbilityMask(x.gate) : (x.gate ?? 0),
    }));

    /** Set true once the player has entered; drives map reveal. */
    this.visited = false;
    /** Per-run state that resets on death. */
    this.clearedThisVisit = false;
  }

  /**
   * The world-space trigger volume for an exit, slightly outside the room so
   * the player must actually reach the edge.
   * @param {RoomExit} exit
   * @returns {AABB}
   */
  exitBounds(exit) {
    const ts = TILE_SIZE;
    const span = exit.span ?? 3;
    switch (exit.edge) {
      case 'left':
        return new AABB(-ts, exit.offset * ts, ts * 1.5, span * ts);
      case 'right':
        return new AABB(this.bounds.right - ts * 0.5, exit.offset * ts, ts * 1.5, span * ts);
      case 'top':
        return new AABB(exit.offset * ts, -ts, span * ts, ts * 1.5);
      case 'bottom':
      default:
        return new AABB(exit.offset * ts, this.bounds.bottom - ts * 0.5, span * ts, ts * 1.5);
    }
  }

  /**
   * Where the player should appear when arriving through a given exit from the
   * other side. Placed a little inside the room so they are not immediately
   * back inside the exit trigger, which would ping-pong them between rooms.
   * @param {RoomExit} exit the exit on *this* room that leads back the way they came
   * @returns {{x: number, y: number, facing: number}}
   */
  entryPointFor(exit) {
    const ts = TILE_SIZE;
    const span = exit.span ?? 3;
    switch (exit.edge) {
      case 'left':
        return { x: ts * 1.6, y: (exit.offset + span) * ts, facing: 1 };
      case 'right':
        return { x: this.bounds.right - ts * 1.6, y: (exit.offset + span) * ts, facing: -1 };
      case 'top':
        return { x: (exit.offset + span / 2) * ts, y: ts * 2.5, facing: 1 };
      case 'bottom':
      default:
        return { x: (exit.offset + span / 2) * ts, y: this.bounds.bottom - ts * 0.6, facing: 1 };
    }
  }

  /**
   * @param {string} kind
   * @returns {RoomSpawn[]}
   */
  spawnsOfKind(kind) {
    return this.spawns.filter((s) => s.kind === kind);
  }

  /** @returns {RoomSpawn|null} the first checkpoint in this room, if any */
  get checkpoint() {
    return this.spawns.find((s) => s.kind === 'checkpoint') ?? null;
  }

  /** @returns {number} how many rooms wide this is on the world map */
  get mapWidth() {
    return Math.max(1, Math.round(this.widthTiles / 30));
  }

  /** @returns {number} */
  get mapHeight() {
    return Math.max(1, Math.round(this.heightTiles / 17));
  }
}

/**
 * Parse ASCII art into a tilemap plus entity spawns.
 *
 * @param {string[]} art
 * @param {Record<string, any>} markers Maps marker glyph -> spawn descriptor(s).
 * @returns {{map: Tilemap, spawns: RoomSpawn[], playerSpawn: {x: number, y: number}|null}}
 */
export function parseRoomArt(art, markers = {}) {
  if (!Array.isArray(art) || art.length === 0) {
    throw new Error('parseRoomArt: art must be a non-empty array of rows');
  }
  const height = art.length;
  const width = Math.max(...art.map((r) => r.length));
  const map = new Tilemap(width, height, { outOfBoundsTile: Tiles.SOLID });

  /** @type {RoomSpawn[]} */
  const spawns = [];
  /** @type {{x: number, y: number}|null} */
  let playerSpawn = null;

  // Marker glyphs can appear several times in a room; each occurrence consumes
  // the next entry from that glyph's list, which is what lets one room place
  // three different enemies with the same `e` glyph.
  /** @type {Record<string, number>} */
  const markerCounters = {};

  for (let y = 0; y < height; y++) {
    const row = art[y];
    for (let x = 0; x < width; x++) {
      const glyph = row[x] ?? '.';

      if (MARKER_SET.has(glyph)) {
        // Markers occupy empty space, never solid tiles.
        map.set(x, y, Tiles.EMPTY);
        const px = x * TILE_SIZE + TILE_SIZE / 2;
        // Entities are placed with their feet at the *bottom* of the marker tile.
        const py = (y + 1) * TILE_SIZE;

        if (glyph === MARKERS.PLAYER_SPAWN) {
          playerSpawn = { x: px, y: py };
          continue;
        }

        const index = markerCounters[glyph] ?? 0;
        markerCounters[glyph] = index + 1;
        const spawn = resolveMarker(glyph, markers, index, px, py);
        if (spawn) spawns.push(spawn);
        continue;
      }

      const tile = tileFromGlyph(glyph);
      if (glyph !== '.' && tile === Tiles.EMPTY && glyph !== ' ') {
        throw new Error(`parseRoomArt: unknown glyph "${glyph}" at row ${y}, column ${x}`);
      }
      map.set(x, y, tile);
    }
  }

  return { map, spawns, playerSpawn };
}

/**
 * @param {string} glyph
 * @param {Record<string, any>} markers
 * @param {number} index
 * @param {number} px @param {number} py
 * @returns {RoomSpawn|null}
 */
function resolveMarker(glyph, markers, index, px, py) {
  const entry = markers[glyph];
  /** @type {any} */
  let spec = null;
  if (Array.isArray(entry)) spec = entry[index] ?? entry[entry.length - 1];
  else spec = entry;

  if (!spec) return null;
  const id = typeof spec === 'string' ? spec : spec.id;
  const data = typeof spec === 'string' ? undefined : spec.data;

  /** @type {Record<string, string>} */
  const kindByGlyph = {
    [MARKERS.ENEMY]: 'enemy',
    [MARKERS.BOSS]: 'boss',
    [MARKERS.NPC]: 'npc',
    [MARKERS.ITEM]: 'item',
    [MARKERS.CHECKPOINT]: 'checkpoint',
    [MARKERS.GATE_STONE]: 'gate',
    [MARKERS.INSCRIPTION]: 'inscription',
    [MARKERS.SECRET]: 'secret',
    [MARKERS.DOOR]: 'door',
    [MARKERS.ANCHOR]: 'anchor',
    [MARKERS.LORE_PROP]: 'prop',
    [MARKERS.SHOP]: 'shop',
  };

  return { kind: kindByGlyph[glyph] ?? 'prop', id, x: px, y: py, data };
}

/**
 * Serialise a tilemap back to ASCII art, for the level editor's save path.
 * @param {Tilemap} map
 * @returns {string[]}
 */
export function tilemapToArt(map) {
  /** @type {string[]} */
  const rows = [];
  for (let y = 0; y < map.height; y++) {
    let row = '';
    for (let x = 0; x < map.width; x++) {
      row += getTileDef(map.get(x, y)).glyph;
    }
    rows.push(row);
  }
  return rows;
}

/** @type {Map<string, RoomDef>} */
export const ROOM_DEFS = new Map();

/**
 * @param {RoomDef} def
 * @returns {RoomDef}
 */
export function defineRoom(def) {
  if (ROOM_DEFS.has(def.id)) throw new Error(`Duplicate room id "${def.id}"`);
  ROOM_DEFS.set(def.id, def);
  return def;
}

/** @param {RoomDef[]} defs */
export function defineRooms(defs) {
  for (const d of defs) defineRoom(d);
}

/**
 * @param {string} id
 * @returns {Room}
 */
export function createRoom(id) {
  const def = ROOM_DEFS.get(id);
  if (!def) throw new Error(`Unknown room "${id}"`);
  return new Room(def);
}

/** @returns {RoomDef[]} */
export function allRoomDefs() {
  return [...ROOM_DEFS.values()];
}
