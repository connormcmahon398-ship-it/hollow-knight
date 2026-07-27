/**
 * @file Headless test harness.
 *
 * Builds a real game context — real physics, real combat, real input, real
 * player — with no DOM and no rendering, and steps it at the true fixed
 * timestep. Tests therefore exercise the same code paths the game runs, rather
 * than a mocked approximation, which is the only way controller tests are worth
 * writing at all.
 */

import { EventBus } from '../../src/engine/core/events.js';
import { PhysicsWorld } from '../../src/engine/physics/physics-world.js';
import { Tilemap } from '../../src/engine/physics/tilemap.js';
import { Tiles, tileFromGlyph } from '../../src/engine/physics/tiles.js';
import { CombatSystem } from '../../src/game/combat/hitbox.js';
import { ParticleSystem } from '../../src/engine/fx/particles.js';
import { InputManager, Action } from '../../src/engine/input/input.js';
import { Camera } from '../../src/engine/render/camera.js';
import { Rng } from '../../src/engine/core/rng.js';
import { Player } from '../../src/game/player/player.js';
import { GRAVITY } from '../../src/game/player/movement-config.js';

export const STEP = 1 / 60;

/**
 * Build a tilemap from ASCII art. Rows are trimmed, so the art can be indented
 * inside a template literal.
 * @param {string} art
 * @param {object} [options]
 * @param {number} [options.outOfBoundsTile]
 * @returns {Tilemap}
 */
export function mapFromArt(art, options = {}) {
  const rows = art.replace(/^\n/, '').replace(/\s+$/, '').split('\n').map((r) => r.trim());
  const h = rows.length;
  const w = Math.max(...rows.map((r) => r.length));
  const map = new Tilemap(w, h, { outOfBoundsTile: options.outOfBoundsTile ?? Tiles.EMPTY });
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      map.set(x, y, tileFromGlyph(rows[y][x] ?? '.'));
    }
  }
  return map;
}

/**
 * A test world: context, systems and a player, all wired together.
 */
export class Harness {
  /**
   * @param {string|Tilemap} art
   */
  constructor(art) {
    const map = typeof art === 'string' ? mapFromArt(art) : art;

    this.bus = new EventBus();
    this.physics = new PhysicsWorld({ gravity: GRAVITY });
    this.physics.setMap(map);
    this.combat = new CombatSystem(this.bus);
    this.combat.map = map;
    this.particles = new ParticleSystem(256);
    this.input = new InputManager();
    this.camera = new Camera(480, 270);
    this.rng = new Rng('test');

    /** @type {Partial<import('../../src/game/context.js').GameContext>} */
    this.ctx = {
      bus: this.bus,
      physics: this.physics,
      combat: this.combat,
      particles: this.particles,
      input: this.input,
      camera: this.camera,
      rng: this.rng,
      map,
      elapsed: 0,
      paused: false,
      debug: false,
    };

    this.map = map;
    this.player = new Player(this.ctx);
    this.player.attach();
    this.ctx.player = this.player;

    /** Events captured during the run, for assertions. @type {{type: string, payload: any}[]} */
    this.events = [];
    this.bus.setMonitor((type, payload) => {
      this.events.push({ type, payload });
    });
  }

  /**
   * Place the player's feet at a tile coordinate.
   * @param {number} tx @param {number} ty tile coords; feet rest on the top of (tx, ty)
   */
  placePlayerAtTile(tx, ty) {
    this.player.spawnAt(tx * 16 + 8, ty * 16);
  }

  /**
   * @param {number} x @param {number} y pixel coords, y is the feet
   */
  placePlayer(x, y) {
    this.player.spawnAt(x, y);
  }

  /**
   * Advance the simulation.
   * @param {number} [steps]
   */
  step(steps = 1) {
    for (let i = 0; i < steps; i++) {
      this.input.update(STEP);
      this.player.update(STEP);
      this.physics.step(STEP);
      this.player.lateUpdate(STEP);
      this.combat.update(STEP);
      this.particles.update(STEP);
      this.bus.flush();
      this.input.endStep();
      this.ctx.elapsed += STEP;
    }
  }

  /**
   * Advance until a predicate holds, or fail after a step budget.
   * @param {() => boolean} predicate
   * @param {number} [maxSteps]
   * @returns {number} steps taken
   */
  stepUntil(predicate, maxSteps = 600) {
    for (let i = 0; i < maxSteps; i++) {
      if (predicate()) return i;
      this.step(1);
    }
    if (!predicate()) {
      throw new Error(`stepUntil: predicate never held within ${maxSteps} steps`);
    }
    return maxSteps;
  }

  /**
   * Settle the player onto the ground and into a stable resting state.
   *
   * Stops on `idle`/`run` rather than merely on `grounded`, because touchdown
   * puts the machine in the transient `land` state and a test that stopped
   * there would observe a state the player occupies for a single step.
   * @param {number} [maxSteps]
   */
  settle(maxSteps = 300) {
    for (let i = 0; i < maxSteps; i++) {
      this.step(1);
      if (
        this.player.body.grounded
        && Math.abs(this.player.body.velocity.y) < 1
        && (this.state === 'idle' || this.state === 'run')
      ) return;
    }
  }

  /**
   * Hold a key down.
   * @param {string} code
   */
  hold(code) {
    this.input.pressKey(code);
  }

  /** @param {string} code */
  release(code) {
    this.input.releaseKey(code);
  }

  /**
   * Press and release a key across one step, the way a real tap behaves.
   * @param {string} code
   */
  tap(code) {
    this.input.pressKey(code);
    this.step(1);
    this.input.releaseKey(code);
  }

  /** @param {string} type @returns {any[]} payloads of captured events */
  eventsOfType(type) {
    return this.events.filter((e) => e.type === type).map((e) => e.payload);
  }

  /** @param {string} type @returns {boolean} */
  sawEvent(type) {
    return this.events.some((e) => e.type === type);
  }

  clearEvents() {
    this.events.length = 0;
  }

  /** @returns {number} player's feet position */
  get feetY() {
    return this.player.body.box.bottom;
  }

  /** @returns {number} player's horizontal centre */
  get centerX() {
    return this.player.body.box.centerX;
  }

  /** @returns {string} current player state name */
  get state() {
    return this.player.machine.currentName ?? '';
  }
}

/** Key codes matching the default bindings, for readable tests. */
export const Key = Object.freeze({
  LEFT: 'ArrowLeft',
  RIGHT: 'ArrowRight',
  UP: 'ArrowUp',
  DOWN: 'ArrowDown',
  JUMP: 'KeyZ',
  ATTACK: 'KeyX',
  DASH: 'KeyC',
  FOCUS: 'KeyF',
});

export { Action };
