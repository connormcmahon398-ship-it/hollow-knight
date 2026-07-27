/**
 * @file The world: room loading, transitions, entity lifetime and persistence.
 *
 * ## Responsibilities
 * The `World` owns *what currently exists*. When the player crosses a doorway it
 * tears down the outgoing room's entities, builds the incoming room's, and
 * repositions everything — all inside a single simulation step, with a short
 * fade covering the swap.
 *
 * ## Why teardown rather than keeping rooms warm
 * Keeping neighbouring rooms simulated would let enemies fight while off-screen
 * and would multiply the per-step cost by the number of loaded rooms. The
 * player cannot observe the difference (nothing off-screen is meant to progress
 * independently), so the simpler and cheaper model wins.
 *
 * The cost is that enemies respawn on re-entry. That is a *design* decision as
 * much as a technical one — it keeps traversal meaningful and gives the world a
 * pulse — and it is mediated by persistence: bosses, opened doors, taken items
 * and broken walls all stay changed.
 *
 * ## Persistence model
 * Three tiers, in increasing permanence:
 *  - **Volatile**: enemy positions and health. Discarded on room exit.
 *  - **Run state**: which shortcuts are open, which walls are broken. Kept for
 *    the session and written to the save.
 *  - **World flags**: bosses defeated, items taken, quests advanced, NPCs moved.
 *    Written to the save and never reset except by starting a new game.
 */

import { createRoom, ROOM_DEFS } from './room.js';
import { createEnemy } from '../enemy/enemy.js';
import { createBoss } from '../boss/boss.js';
import { Events } from '../../engine/core/events.js';
import { getBiome } from '../content/biomes.js';
import { AABB } from '../../engine/math/aabb.js';
import { TILE_SIZE, Tiles } from '../../engine/physics/tiles.js';
import { parseAbilityMask } from '../player/abilities.js';

export class World {
  /**
   * @param {Partial<import('../context.js').GameContext>} ctx
   */
  constructor(ctx) {
    this.ctx = ctx;
    this.bus = ctx.bus;

    /** @type {import('./room.js').Room|null} */
    this.room = null;
    /** @type {import('../enemy/enemy.js').Enemy[]} */
    this.enemies = [];
    /** @type {import('../boss/boss.js').Boss|null} */
    this.boss = null;
    /** @type {any[]} Interactables: NPCs, items, checkpoints, inscriptions. */
    this.interactables = [];
    /** @type {import('./projectile.js').Projectile[]} */
    this.projectiles = [];

    /** Rooms the player has entered, for the map. @type {Set<string>} */
    this.visitedRooms = new Set();
    /** Persistent world flags. @type {Set<string>} */
    this.flags = new Set();

    /** Transition state. */
    this.transitioning = false;
    this.transitionTimer = 0;
    this.transitionDuration = 0.34;
    /** @type {{to: string, exit: any}|null} */
    this.pendingTransition = null;
    /** 0 = clear, 1 = fully black. */
    this.fadeAmount = 0;

    /** Current biome definition, cached. */
    this.biome = null;

    /** @type {(() => void)[]} */
    this._unsubscribers = [];
    this._wireEvents();
  }

  /** @private */
  _wireEvents() {
    if (!this.bus) return;
    // Enemies and bosses request spawns through the bus so they never need a
    // reference to the world (which would be a cycle).
    this._unsubscribers.push(
      this.bus.on('enemy:spawnRequest', (e) => this.spawnEnemyBurst(e)),
      this.bus.on(Events.BOSS_DEFEATED, (e) => {
        this.setFlag(`boss:${e.def.id}`);
        this.unsealArena();
      }),
    );
  }

  /** Release event subscriptions. */
  dispose() {
    for (const off of this._unsubscribers) off();
    this._unsubscribers.length = 0;
  }

  // ==========================================================================
  // Flags
  // ==========================================================================

  /** @param {string} flag @returns {boolean} */
  hasFlag(flag) {
    return this.flags.has(flag);
  }

  /** @param {string} flag */
  setFlag(flag) {
    if (this.flags.has(flag)) return;
    this.flags.add(flag);
    this.bus?.emit(Events.FLAG_SET, { flag });
  }

  /** @param {string} flag */
  clearFlag(flag) {
    this.flags.delete(flag);
  }

  // ==========================================================================
  // Room loading
  // ==========================================================================

  /**
   * Load a room immediately, without a transition. Used for the initial load,
   * respawns and fast travel.
   * @param {string} roomId
   * @param {{x: number, y: number, facing?: number}} [spawnPoint]
   */
  loadRoom(roomId, spawnPoint) {
    this.teardownRoom();

    const room = createRoom(roomId);
    this.room = room;
    this.ctx.room = room;
    this.ctx.map = room.map;
    this.ctx.physics?.setMap(room.map);
    if (this.ctx.combat) this.ctx.combat.map = room.map;

    this.biome = getBiome(room.biome);
    room.visited = true;
    this.visitedRooms.add(roomId);

    // Re-apply persistent changes to the freshly parsed tilemap: doors the
    // player opened, walls they broke. The room is rebuilt from its definition
    // each time, so without this pass, shortcuts would silently re-seal.
    this._applyPersistentTileChanges(room);

    this._spawnRoomContents(room);

    const player = this.ctx.player;
    if (player) {
      /** @type {{x: number, y: number, facing?: number}} */
      const point = spawnPoint
        ?? room.playerSpawn
        ?? { x: room.bounds.centerX, y: room.bounds.centerY };
      player.spawnAt(point.x, point.y, point.facing ?? player.facing);
      // Brief invulnerability so arriving in a room next to an enemy is not an
      // instant hit the player had no chance to avoid.
      player.iframeTimer = Math.max(player.iframeTimer, 0.5);
    }

    const camera = this.ctx.camera;
    if (camera) {
      camera.setBounds(room.bounds.x, room.bounds.y, room.bounds.w, room.bounds.h);
      if (player) camera.snapTo(player.body.box.centerX, player.body.box.centerY);
    }

    this.bus?.emit(Events.ROOM_ENTERED, { room, biome: this.biome });
    this.bus?.emit(Events.BIOME_ENTERED, { biome: this.biome });
  }

  /**
   * @param {import('./room.js').Room} room
   * @private
   */
  _applyPersistentTileChanges(room) {
    for (const flag of this.flags) {
      if (!flag.startsWith(`tile:${room.id}:`)) continue;
      // Format: tile:<roomId>:<tx>,<ty>:<newTileId>
      const rest = flag.slice(`tile:${room.id}:`.length);
      const [coords, tileId] = rest.split(':');
      const [tx, ty] = coords.split(',').map(Number);
      if (Number.isFinite(tx) && Number.isFinite(ty)) {
        room.map.set(tx, ty, Number(tileId) || Tiles.EMPTY);
      }
    }
  }

  /**
   * Record a permanent change to a room's geometry.
   * @param {number} tx @param {number} ty @param {number} tileId
   */
  changeTilePermanently(tx, ty, tileId) {
    if (!this.room) return;
    this.room.map.set(tx, ty, tileId);
    this.setFlag(`tile:${this.room.id}:${tx},${ty}:${tileId}`);
  }

  /**
   * @param {import('./room.js').Room} room
   * @private
   */
  _spawnRoomContents(room) {
    for (const spawn of room.spawns) {
      switch (spawn.kind) {
        case 'enemy':
          this._spawnEnemy(spawn, room);
          break;
        case 'boss':
          this._spawnBoss(spawn, room);
          break;
        default:
          // Everything else is an interactable, handled by the interaction
          // system, which owns their behaviour and rendering.
          this.interactables.push({
            kind: spawn.kind,
            id: spawn.id,
            x: spawn.x,
            y: spawn.y,
            data: spawn.data,
            bounds: new AABB(spawn.x - 12, spawn.y - 24, 24, 24),
            room: room.id,
            used: this.hasFlag(`interact:${room.id}:${spawn.id}`),
          });
          break;
      }
    }
  }

  /**
   * @param {import('./room.js').RoomSpawn} spawn
   * @param {import('./room.js').Room} room
   * @private
   */
  _spawnEnemy(spawn, room) {
    // Enemies killed permanently (rare — only story-critical ones) stay dead.
    const key = `${room.id}:${spawn.id}:${Math.round(spawn.x)},${Math.round(spawn.y)}`;
    if (this.hasFlag(`slain:${key}`)) return;

    let enemy;
    try {
      enemy = createEnemy(spawn.id, this.ctx);
    } catch (err) {
      console.warn(`World: room "${room.id}" references unknown enemy "${spawn.id}"`);
      return;
    }
    enemy.spawnKey = key;
    enemy.spawnAt(spawn.x, spawn.y);
    // Patrol bounds default to the room, so walkers do not path into the void.
    enemy.patrolMinX = room.bounds.x + 4;
    enemy.patrolMaxX = room.bounds.right - 4;
    enemy.attach();
    this.enemies.push(enemy);
  }

  /**
   * @param {import('./room.js').RoomSpawn} spawn
   * @param {import('./room.js').Room} room
   * @private
   */
  _spawnBoss(spawn, room) {
    if (this.hasFlag(`boss:${spawn.id}`)) return; // already defeated
    let boss;
    try {
      boss = createBoss(spawn.id, this.ctx);
    } catch (err) {
      console.warn(`World: room "${room.id}" references unknown boss "${spawn.id}"`);
      return;
    }
    boss.spawnAt(spawn.x, spawn.y);
    boss.attach();
    this.boss = boss;
    this.enemies.push(boss);
  }

  /**
   * Spawn a cluster of enemies at runtime (splitters, boss summons).
   * @param {{id: string, count?: number, x: number, y: number, scatter?: number}} req
   */
  spawnEnemyBurst(req) {
    const count = req.count ?? 1;
    const scatter = req.scatter ?? 40;
    const rng = this.ctx.rng;
    // A hard cap stops a summon-heavy boss phase plus splitters from producing
    // an unbounded population, which would tank the frame rate and be unwinnable.
    const budget = Math.max(0, 40 - this.enemies.length);
    for (let i = 0; i < Math.min(count, budget); i++) {
      let enemy;
      try {
        enemy = createEnemy(req.id, this.ctx);
      } catch {
        return;
      }
      const ox = rng ? rng.range(-scatter, scatter) : (i - count / 2) * 20;
      const oy = rng ? rng.range(-scatter * 0.4, 0) : 0;
      enemy.spawnAt(req.x + ox, req.y + oy);
      if (this.room) {
        enemy.patrolMinX = this.room.bounds.x + 4;
        enemy.patrolMaxX = this.room.bounds.right - 4;
      }
      enemy.alerted = true;
      enemy.alertMemory = 6;
      enemy.attach();
      this.enemies.push(enemy);
    }
  }

  /** Remove every entity belonging to the current room. */
  teardownRoom() {
    for (const enemy of this.enemies) enemy.detach();
    this.enemies.length = 0;
    this.boss = null;
    this.interactables.length = 0;
    for (const p of this.projectiles) p.dispose?.();
    this.projectiles.length = 0;
    this.ctx.particles?.clear();
    if (this.room) this.bus?.emit(Events.ROOM_EXITED, { room: this.room });
  }

  // ==========================================================================
  // Transitions
  // ==========================================================================

  /**
   * @param {number} dt
   */
  update(dt) {
    if (this.transitioning) {
      this._updateTransition(dt);
      return;
    }
    this._checkExits();
    this._updateEnemies(dt);
    this._checkBossTrigger();
  }

  /**
   * @param {number} dt
   */
  lateUpdate(dt) {
    if (this.transitioning) return;
    for (const enemy of this.enemies) enemy.lateUpdate(dt);
    // Cull finished enemies after the whole update, never during iteration.
    for (let i = this.enemies.length - 1; i >= 0; i--) {
      const enemy = this.enemies[i];
      if (!enemy.finished) continue;
      enemy.detach();
      this.enemies.splice(i, 1);
      if (enemy === this.boss) this.boss = null;
    }
  }

  /**
   * @param {number} dt
   * @private
   */
  _updateEnemies(dt) {
    const camera = this.ctx.camera;
    const view = camera ? camera.getViewBounds(140) : null;
    for (const enemy of this.enemies) {
      // Off-screen enemies are skipped entirely. This is safe because nothing
      // in the design depends on an unobserved enemy making progress, and it
      // keeps large rooms cheap.
      const visible = !view || view.intersects(enemy.body.box);
      enemy.dormant = !visible;
      if (!visible && !enemy.isBoss) {
        enemy.body.enabled = false;
        continue;
      }
      enemy.body.enabled = true;
      enemy.update(dt);
    }
  }

  /** @private */
  _checkBossTrigger() {
    const boss = this.boss;
    const player = this.ctx.player;
    if (!boss || !player || boss.encounterActive || boss.defeated) return;
    // The encounter starts when the player is meaningfully inside the arena,
    // not the moment they poke their head through the door.
    if (Math.abs(player.body.box.centerX - boss.body.box.centerX) < 150) {
      boss.beginEncounter();
      this.sealArena();
    }
  }

  /** Close the arena doors for a boss fight. */
  sealArena() {
    if (!this.room) return;
    for (const exit of this.room.exits) {
      const bounds = this.room.exitBounds(exit);
      this._fillDoorway(bounds, Tiles.GATE);
    }
    this.bus?.emit(Events.SFX, { id: 'arenaSeal' });
  }

  /** Reopen the arena doors. */
  unsealArena() {
    if (!this.room) return;
    this.room.map.replaceAll(Tiles.GATE, Tiles.EMPTY);
    this.bus?.emit(Events.SFX, { id: 'arenaOpen' });
  }

  /**
   * @param {AABB} bounds
   * @param {number} tileId
   * @private
   */
  _fillDoorway(bounds, tileId) {
    if (!this.room) return;
    const map = this.room.map;
    const tx0 = Math.max(0, Math.floor(bounds.x / TILE_SIZE));
    const tx1 = Math.min(map.width - 1, Math.floor((bounds.right - 1) / TILE_SIZE));
    const ty0 = Math.max(0, Math.floor(bounds.y / TILE_SIZE));
    const ty1 = Math.min(map.height - 1, Math.floor((bounds.bottom - 1) / TILE_SIZE));
    for (let ty = ty0; ty <= ty1; ty++) {
      for (let tx = tx0; tx <= tx1; tx++) {
        if (map.get(tx, ty) === Tiles.EMPTY) map.set(tx, ty, tileId);
      }
    }
  }

  /** @private */
  _checkExits() {
    const player = this.ctx.player;
    const room = this.room;
    if (!player || !room || !player.hasControl) return;

    for (const exit of room.exits) {
      const bounds = room.exitBounds(exit);
      if (!bounds.intersects(player.body.box)) continue;
      if (exit.requiresFlag && !this.hasFlag(exit.requiresFlag)) continue;
      const gate = typeof exit.gate === 'string' ? parseAbilityMask(exit.gate) : (exit.gate ?? 0);
      if (gate && !player.abilities.hasAll(gate)) continue;
      if (!ROOM_DEFS.has(exit.to)) {
        console.warn(`World: exit from "${room.id}" leads to unknown room "${exit.to}"`);
        continue;
      }
      this.beginTransition(exit);
      return;
    }
  }

  /**
   * @param {import('./room.js').RoomExit} exit
   */
  beginTransition(exit) {
    if (this.transitioning) return;
    this.transitioning = true;
    this.transitionTimer = 0;
    this.pendingTransition = { to: exit.to, exit };
    this.ctx.player?.machine.force('transition');
    this.bus?.emit(Events.SFX, { id: 'roomTransition' });
  }

  /**
   * @param {number} dt
   * @private
   */
  _updateTransition(dt) {
    this.transitionTimer += dt;
    const half = this.transitionDuration / 2;

    if (this.transitionTimer < half) {
      this.fadeAmount = this.transitionTimer / half;
      return;
    }

    if (this.pendingTransition) {
      const { to, exit } = this.pendingTransition;
      this.pendingTransition = null;
      this._performTransition(to, exit);
    }

    this.fadeAmount = Math.max(0, 1 - (this.transitionTimer - half) / half);
    if (this.transitionTimer >= this.transitionDuration) {
      this.transitioning = false;
      this.fadeAmount = 0;
      const player = this.ctx.player;
      if (player) player.machine.force(player.body.grounded ? 'idle' : 'fall');
    }
  }

  /**
   * @param {string} roomId
   * @param {import('./room.js').RoomExit} exit
   * @private
   */
  _performTransition(roomId, exit) {
    const player = this.ctx.player;
    // Momentum is preserved through a doorway, which is what makes the world
    // feel continuous rather than like a series of discrete screens.
    const carriedVX = player ? player.body.velocity.x : 0;
    const carriedVY = player ? player.body.velocity.y : 0;

    this.loadRoom(roomId);

    const room = this.room;
    if (!room || !player) return;

    // Find the reciprocal exit — the one on the new room leading back — and
    // place the player just inside it.
    const opposite = oppositeEdge(exit.edge);
    const back = room.exits.find((e) => e.to === exit.to || e.edge === opposite)
      ?? room.exits.find((e) => e.edge === opposite);

    if (back) {
      const point = room.entryPointFor(back);
      player.spawnAt(point.x, point.y, point.facing);
    } else if (room.playerSpawn) {
      player.spawnAt(room.playerSpawn.x, room.playerSpawn.y);
    }

    // Restore momentum along the axis of travel only. Carrying the
    // perpendicular component would fling the player sideways out of a vertical
    // doorway.
    if (exit.edge === 'left' || exit.edge === 'right') {
      player.body.velocity.x = carriedVX;
    } else {
      player.body.velocity.y = Math.max(carriedVY, 0);
    }
    player.iframeTimer = Math.max(player.iframeTimer, 0.4);

    const camera = this.ctx.camera;
    if (camera) camera.snapTo(player.body.box.centerX, player.body.box.centerY);
  }

  // ==========================================================================
  // Queries
  // ==========================================================================

  /**
   * Interactable the player is currently able to use.
   * @returns {any|null}
   */
  nearestInteractable() {
    const player = this.ctx.player;
    if (!player) return null;
    let best = null;
    let bestDist = 34;
    for (const item of this.interactables) {
      const d = Math.hypot(
        item.x - player.body.box.centerX,
        item.y - 12 - player.body.box.centerY,
      );
      if (d < bestDist) {
        bestDist = d;
        best = item;
      }
    }
    return best;
  }

  /** @returns {number} living enemies excluding the boss */
  get liveEnemyCount() {
    return this.enemies.filter((e) => !e.isDead && !e.isBoss).length;
  }

  /** @returns {object} state to persist */
  toJSON() {
    return {
      roomId: this.room?.id ?? null,
      visitedRooms: [...this.visitedRooms],
      flags: [...this.flags],
    };
  }

  /**
   * @param {any} data
   */
  load(data) {
    if (!data) return;
    this.visitedRooms = new Set(data.visitedRooms ?? []);
    this.flags = new Set(data.flags ?? []);
  }
}

/**
 * @param {string} edge
 * @returns {string}
 */
export function oppositeEdge(edge) {
  switch (edge) {
    case 'left': return 'right';
    case 'right': return 'left';
    case 'top': return 'bottom';
    case 'bottom': return 'top';
    default: return 'left';
  }
}
