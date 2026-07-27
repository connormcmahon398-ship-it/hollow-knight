# AETHERWEIR

An original 2D exploration-action platformer, built from scratch with **zero
runtime dependencies** and **no asset files of any kind**.

Every visual is drawn from canvas primitives at runtime. Every sound is
synthesised from oscillators and noise. The entire game is source code.

---

## Running it

```bash
npm run serve       # http://localhost:8080
```

That is the whole setup. There is no build step, no bundler and no
`node_modules` requirement to *play* — the browser loads the ES modules
directly. (Playwright is a dev dependency, used only by the smoke test.)

| Command | What it does |
|---|---|
| `npm run serve` | Start the game on `localhost:8080` |
| `npm test` | 115 unit and integration tests (`node:test`) |
| `npm run validate` | Content counts **and a proof the game is completable** |
| `npm run smoke` | Boot the real game in Chromium and drive it |
| `npm run typecheck` | `tsc --noEmit` over the JSDoc types |

The room editor is at `tools/editor.html` once the server is running.

## Controls

| | |
|---|---|
| Move | Arrow keys / WASD |
| Jump | `Z` / Space — hold for height |
| Strike | `X` — hold a direction to aim up or down |
| Dash | `C` / Shift |
| Focus (heal) | `F` — hold; you cannot move |
| Interact | `E` |
| Map | `M` |
| Pause | `Esc` |
| Debug overlay | `` ` `` |

A gamepad works if one is connected. Bindings are remappable at runtime.

---

## The game

You are **Nib**, a small ink-and-brass automaton of the Scrivener order, woken
in a salt flat to record the last testimony of **Aetherweir** — a fallen
sky-continent whose remaining aether is held back by failing dams.

The central mechanic *is* the theme. Lore is not found in item descriptions; it
is **transcribed** by the player from inscriptions on the world, a channelled
act that costs a moment of vulnerability. What you choose to record, redact or
forge determines which of the four endings you reach. Ink is simultaneously your
magic, your healing, your record, and what you drop when you die.

**Sixteen regions** (fourteen required, two hidden), **83 creatures**,
**35 bosses**, **308 rooms**, **70 items**, **32 characters**, **47 inscriptions**.

See [`docs/DESIGN.md`](docs/DESIGN.md) for the world, the progression curve and
the ending conditions.

---

## Architecture at a glance

Full detail in [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

```
src/
  engine/            game-agnostic; knows nothing about Aetherweir
    core/            loop, events, RNG, state machines, pooling
    math/            Vec2, AABB + swept collision, spatial hash, easing
    physics/         tiles, tilemap, bodies, collision resolver
    render/          renderer, camera, OKLab palette system
    input/           action bindings, buffering, gamepad
    audio/           Web Audio synthesiser and procedural music
    fx/              particle system
    save/            versioned save with migrations
  game/              Aetherweir specifically
    player/          controller, movement tuning, attack frame data
    combat/          damage model, hitbox/hurtbox resolution
    enemy/           enemy chassis + 16 AI archetypes
    boss/            phase machine + pattern scheduler
    world/           rooms, world manager, projectiles, interaction
    render/          tile / actor / prop painters, parallax, effects
    ui/ map/ npc/    HUD, map screen, dialogue
    progression/     inventory, seals, completion
    content/         everything above, as data
tools/               dev server, level editor, validators, smoke test
tests/               115 tests
```

The strict rule is that `engine/` never imports from `game/`. The engine is a
platformer engine; the game is the thing built on it.

## Three ideas the codebase is organised around

**1. Behaviour is a small library; content is a large table.**
Sixteen AI archetypes produce 83 creatures. Sixteen boss pattern factories
produce 253 pattern instances across 85 phases. Twenty-four hand-authored room
templates produce 308 rooms. Fixing "chargers overshoot ledges" fixes it
everywhere at once, and the content stays reviewable as data.

**2. The things that must never break are checked by machine.**
`npm run validate` does a fixed-point reachability search over the world graph
and fails the build if the game cannot be finished. `defineBoss` refuses at load
time to register an encounter with no recovery window or an unreactable
telegraph. Neither is a test that can be forgotten — they run on every build.

**3. Tuning lives in one file per system, with reasons.**
`src/game/player/movement-config.js` holds every number that defines how the
character feels, each with a note on why it is that value. Combat frame data
lives in `attacks.js`. Colour lives in the palette system. None of them are
scattered through the logic.

---

## What is generated, and what is not

The world builder is honest about its boundary:

- **Hand-authored:** every room interior, all 24 templates, the opening region
  end to end, every creature, boss, item, inscription, character and quest, and
  the inter-region connection graph including its ability gates.
- **Generated (deterministically, from a fixed seed):** which template fills
  each node of a region's graph, where that region's doorways are cut, which
  creatures from the region's roster populate it, and where its rest points,
  lore and rewards sit.

The seed is fixed, so the same build always produces the same world — room ids
appear in save files, and a world that reshuffled between sessions would
invalidate every save.

---

## Originality

This is an original work. The setting, characters, creatures, bosses, regions,
items, lore, dialogue, level layouts, mechanics and code are all original to
this project.

There are **no asset files** — no sprites, no textures, no audio, no fonts.
Every pixel is drawn from primitives at runtime and every sound is synthesised
from oscillators, which means there is nothing in this repository that *could*
have been copied from anything. Typography uses generic CSS font families only.

## Licence

MIT.
