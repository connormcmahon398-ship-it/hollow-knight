/**
 * @file The game context: the service container passed to every gameplay system.
 *
 * ## Why a context object rather than singletons or imports?
 * Gameplay systems need access to the same handful of services — the event bus,
 * physics, combat, particles, audio, the current room. The three options are:
 *
 * 1. **Module-level singletons.** Simplest to write, but makes every system
 *    untestable in isolation and creates import cycles the moment two systems
 *    reference each other.
 * 2. **Threading parameters.** Explicit, but a nine-argument constructor for
 *    every enemy is unusable, and adding a service means editing everything.
 * 3. **A context object.** One parameter, explicit dependency, trivially
 *    replaceable with a stub in tests.
 *
 * The context is deliberately a plain mutable object rather than a class with
 * getters: systems attach themselves during boot, and the room manager swaps
 * `room` and `map` on every transition. Making that ceremony would buy nothing.
 *
 * Fields that are only meaningful once a room is loaded are documented as such;
 * headless tests populate a subset and that is by design.
 */

/**
 * @typedef {Object} GameContext
 * @property {import('../engine/core/events.js').EventBus} bus
 * @property {import('../engine/physics/physics-world.js').PhysicsWorld} physics
 * @property {import('./combat/hitbox.js').CombatSystem} combat
 * @property {import('../engine/fx/particles.js').ParticleSystem} particles
 * @property {import('../engine/input/input.js').InputManager} input
 * @property {import('../engine/render/camera.js').Camera} camera
 * @property {import('../engine/core/rng.js').Rng} rng
 * @property {import('../engine/audio/audio-manager.js').AudioManager} [audio]
 * @property {import('../engine/core/loop.js').GameLoop} [loop]
 * @property {import('./player/player.js').Player} [player]
 * @property {import('./world/room.js').Room} [room] Current room; null before load.
 * @property {import('../engine/physics/tilemap.js').Tilemap} [map] Current room's collision map.
 * @property {import('./world/world.js').World} [world]
 * @property {import('./progression/progression.js').Progression} [progression]
 * @property {import('./content/quests.js').QuestSystem} [quests]
 * @property {import('./npc/dialogue.js').DialogueSystem} [dialogue]
 * @property {import('./map/map-system.js').MapSystem} [mapSystem]
 * @property {import('../engine/save/save-system.js').SaveSystem} [saves]
 * @property {number} elapsed Total simulation seconds since the run started.
 * @property {boolean} paused
 * @property {boolean} debug
 */

/**
 * Create an empty context. Systems attach themselves during boot; nothing here
 * assumes an order, which keeps the boot sequence readable.
 * @returns {Partial<GameContext>}
 */
export function createContext() {
  return {
    elapsed: 0,
    paused: false,
    debug: false,
  };
}
