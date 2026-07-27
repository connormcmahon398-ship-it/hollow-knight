# AETHERWEIR — Architecture

This document explains **why** the systems are built the way they are. Every
file also carries its own rationale at the top; this is the map that connects
them.

---

## 1. Platform choice

**Vanilla ES modules, Canvas2D, Web Audio. No build step, no runtime deps.**

The alternatives considered were a Python/pygame build and a WebGL renderer.

- **Why not pygame:** it needs a Python environment, SDL, and working audio and
  video drivers on the player's machine. A browser game needs a browser.
- **Why not WebGL:** the art direction is procedural vector-and-shape drawing —
  silhouettes, gradients, strokes, soft glows — which Canvas2D does natively in
  a few lines per shape. WebGL would mean writing a batching sprite pipeline, a
  shader set and a text renderer *before drawing anything*, to accelerate a
  workload that is not GPU-bound. The scene is a few hundred draw calls.
- **Why no bundler:** the game is a few hundred small modules and browsers load
  ES modules natively. A bundler would add a build step, a config file and a
  dependency tree in exchange for a marginal request-count improvement on a
  local server.

The one place Canvas2D is genuinely slow is per-pixel post-processing, and the
renderer deliberately uses composite-mode approximations there instead
(`renderer.js`, `applyPostFX`).

**Types without a compiler.** Everything is annotated with JSDoc and checked by
`tsc --noEmit` with `checkJs`. Full type checking, zero compile step, and the
source that runs is the source you read.

---

## 2. The layer boundary

```
engine/  ──▶  (nothing)
game/    ──▶  engine/
tools/   ──▶  engine/ + game/
```

`engine/` never imports from `game/`. This is not architectural hygiene for its
own sake — it is what makes the physics, combat and save systems testable
without loading 308 rooms and 83 creature definitions, and it is what let the
level editor import the game's real tile registry rather than duplicating it.

---

## 3. The frame

Stated authoritatively in `src/game/game.js`, repeated here because the ordering
*is* the design:

| # | Step | Why here |
|---|---|---|
| 1 | Input | Fold async DOM events into action state at a fixed point |
| 2 | Player | Read input, write velocity |
| 3 | World / AI | Enemies read the world as it was, write velocity |
| 4 | Physics | Integrate and resolve **everything** at once |
| 5 | `lateUpdate` | React to collision results (landing, walls) |
| 6 | Combat | Resolve hitboxes against **resolved** positions |
| 7 | Projectiles | After combat, so a hit lands this frame |
| 8 | Particles / FX | Purely reactive |
| 9 | Camera | Follow final positions, so it never lags a frame |
| 10 | `bus.flush()` | Deferred structural changes, when nothing is iterating |

Steps 4 and 6 are the important pairing. Resolving combat *before* physics tests
hitboxes against last frame's positions, which is the classic "I clearly hit it"
bug.

### Fixed timestep

The simulation runs at exactly 60Hz with an accumulator; rendering interpolates
between steps via an `alpha` factor. This is not fussiness:

1. **Determinism.** Jump height must not change with frame rate. Under a
   variable timestep it does, because gravity integration error scales with step
   size.
2. **Collision stability.** A 500ms frame after an alt-tab would teleport the
   player across three rooms.
3. **Testability.** Tests advance N discrete steps and assert exact positions.

Catch-up is capped at 5 steps per frame; beyond that the backlog is discarded.
Dropping simulation time is the lesser evil against an unrecoverable hang.

---

## 4. Physics

### Collision resolution

Substepped, axis-separated resolution with a dedicated slope pass
(`tilemap-collider.js`).

Motion is split into substeps no larger than half a tile, so a body can never
skip a collider regardless of speed. Within each substep, X is resolved, then
slopes, then Y — the standard platformer ordering, which yields sliding along
walls rather than sticking, and no catching on the seams between floor tiles.

**Slopes are a height function, not a shape.** Each tile declares its surface
height at its left and right edges as a fraction of tile height. A full block is
`[1,1]`; a 45° ramp is `[0,1]`; a two-tile shallow ramp is `[0,0.5]` then
`[0.5,1]`. One abstraction covers every angle the game needs, keeps the
collision code branch-light, and makes adding a slope a data change.

Ramps are deliberately **not** blockers during the X pass. Instead the body is
lifted onto the highest ramp surface beneath it afterwards, which is what makes
walking up a slope continuous rather than like climbing stairs.

**Ground snapping** after the Y pass keeps a body walking downhill glued to the
surface. Without it, downhill walking is a series of little arcs.

### Why AABB only

Every collider that matters is a rectangle. Supporting convex polygons would
cost an order of magnitude more code and runtime for no gameplay benefit, and
would make *feel* harder to tune — platformer feel depends on predictable, boxy
responses. Slopes, the one genuinely awkward case, are handled as a tile type
rather than by generalising the whole system.

---

## 5. Combat

**Hitboxes are separate from physics bodies.** A body answers "where can I
stand"; a hitbox answers "what did my blade sweep through". Conflating them
forces attack ranges to match collision sizes and makes multi-hit attacks
impossible.

**Every hitbox activation tracks who it has already struck.** Without this, a
hitbox live for eight frames deals eight instances of damage — the single most
common source of "why did that enemy die instantly". Multi-hit attacks opt in
explicitly via `hitInterval`.

**Frame data is in frames, not seconds.** Combat is tuned and communicated as "6
frames startup, 4 active, 10 recovery". The system converts once.

**Damage is a payload, not a number.** The same 2 points behave differently from
a spike (fixed recoil direction, no knockback), a boss slam (heavy knockback,
unblockable) and a poison pool (ticks, bypasses i-frames). Health stays simple
and each new damage source is data.

**Health is integral.** With five hit points, fractional damage is unreadable.
Modifiers accumulate as a multiplier and round *once*, with a floor of 1 so
stacked resistances can never accidentally produce immunity — true immunity must
be declared as resistance 0.

---

## 6. Character controller

A hierarchical state machine over a physics body, with 17 states. The
alternative — one `update` with flags — is where platformer controllers rot,
because each new ability must be excluded from every existing branch.

Responsibilities are split three ways so tuning feel and tuning looks never
fight over one file:

- `player.js` — state, resources, the states themselves
- `movement-config.js` — every tuning number, each with its reason
- `actor-painter.js` — how the character is drawn

### The feel guarantees, and why each exists

| Mechanism | Without it |
|---|---|
| Coyote time (0.1s) | Ledges feel slippery; jumps "don't register" |
| Jump buffering (0.12s) | Pressing slightly early does nothing; input feels dropped |
| Variable jump height | Precise platforming is impossible |
| Asymmetric gravity (1.32× falling) | The arc feels weightless — this is the single biggest contributor to a jump feeling good |
| Apex softening (0.72×) | No hang time to aim in |
| Reduced air control | Jumps are freely correctable; commitment disappears |
| Wall-jump lockout (0.16s) | Holding toward the wall cancels the jump; you stick |
| Hit-stop on impact | Hits have no weight; particles cannot substitute for a freeze |

All of these are asserted by tests in `tests/player.test.js`, because they are
easy to break accidentally and hard to notice.

---

## 7. Enemies and bosses

### Data-defined over an archetype library

83 creatures from 16 archetypes. Each archetype is chosen because it demands a
*different player response* — walker, charger, flyer, turret, lobber, jumper,
burrower, shielded, swarm, ambusher, spinner, tether, mirror, splitter, drifter,
stalker. Anything that would be a re-skin is data instead.

Aggro uses **line of sight plus range**, not raw distance. An enemy that notices
you through a wall reads as cheating. Once alerted they keep a memory timer, so
breaking line of sight does not instantly reset them either.

### The boss fairness contract

Bosses use a phase machine over a *weighted pattern scheduler* rather than a
fixed state machine, so fights do not become memorised choreography. Four rules
make "challenging but fair" a mechanical property rather than a hope:

1. **No unavoidable damage.** Every pattern declares a telegraph; the scheduler
   refuses one shorter than the phase's minimum.
2. **No repeats without rest.** A pattern cannot be chosen twice consecutively
   unless it is the only legal option.
3. **Guaranteed recovery windows.** Every pattern ends in a recovery state.
   Removing these makes a boss unbeatable, not hard.
4. **Range gating.** Patterns declare where they make sense, so a boss never
   uses a close-range slam across the arena.

**These are enforced at load time.** `defineBoss` throws on a pattern with no
recovery window or a phase whose every pattern is below the telegraph floor. An
unfair encounter fails the build rather than shipping.

---

## 8. World

### Rooms, not one continuous map

A seamless tilemap sounds ideal and is a trap: it makes streaming, culling,
save-state, the map screen and respawn all *global* problems. A room is a
natural boundary for each. The world feels continuous because transitions
preserve momentum and take ~0.17s — the player sees a doorway, not a load.

### Persistence, in three tiers

| Tier | Contents | Lifetime |
|---|---|---|
| Volatile | Enemy positions and health | Discarded on room exit |
| Run state | Opened shortcuts, broken walls | Session + save |
| World flags | Bosses felled, items taken, quests, NPCs | Save, forever |

Enemies respawning on re-entry is a *design* decision as much as a technical
one — it keeps traversal meaningful — mediated by the fact that everything
consequential persists.

### The authoring format

Rooms are ASCII art with a marker layer. Deliberately, because:

- A room's shape is legible in a diff, so level design is reviewable.
- It is editable by hand *and* by the editor, which writes the same format back.
- Unknown glyphs are **rejected at load**, not silently turned into empty space.

Markers (`@` spawn, `e` enemy, `B` boss, `W` Wellspring, `?` inscription…) are
stripped from the collision layer, so an enemy marker can never leave a hole in
a floor.

### What the world builder does and does not do

**Not generated:** any room interior. All 24 templates are designed by hand —
platform spacing, sightlines, hazard placement, enemy positions.

**Generated:** the region graph. Each region is a grid connected first by a
random spanning tree (guaranteeing every room is reachable) and then given extra
edges to create **loops**. Loops are what make a map feel like a place rather
than a flowchart.

Everything derives from a fixed seed. Room ids appear in save files.

---

## 9. Rendering

No asset files. Two consequences shape the whole renderer:

**Colour does the work of art direction.** The palette system
(`engine/render/palette.js`) mixes in **OKLab**, not sRGB. Interpolating two
saturated colours in RGB passes through a muddy grey; a deep blue and a warm
ochre blend to grey-brown. Since biome cross-fades and damage flashes are both
colour blends, this matters. A biome is a structured palette — a terrain ramp, an
accent, a fluid tint, a fog and a light — and every drawing routine reads from
the *active* palette, so a new region is a data entry.

**Animation is procedural.** No sprite sheets, so limbs are placed by trig
functions of a phase clock and squash-and-stretch is a transform driven by the
controller's state. Unlike frame animation this responds *continuously* to
velocity, so motion always matches what the physics is doing.

### Performance

- **Terrain is cached per room.** Drawing thousands of path operations per frame
  would be absurd; static tiles render once into an offscreen canvas the size of
  the room and blit in one `drawImage`. Only genuinely dynamic tiles (fluids,
  crumbling platforms, arena gates) draw live.
- **Particles are structure-of-arrays.** At peak (~600 on a boss death) an
  object-per-particle design allocates thousands of short-lived objects per
  second — exactly the GC hitches the fixed timestep exists to avoid.
- **Two-pass blend sorting.** `globalCompositeOperation` is an expensive Canvas2D
  state change; iterating the particle array twice beats toggling it 600 times.
- **Fixed internal resolution, integer upscale.** Identical composition on every
  display, consistent procedural line weights, and crisp geometry.

---

## 10. Audio

Everything is synthesised. Beyond guaranteeing originality, this buys two real
advantages: sounds are **parameterised** (a hit pitched by damage, a footstep by
surface, with no authored variants), and the music can respond *continuously* to
game state rather than crossfading between fixed stems.

Music is procedural — a chord progression, a scale and a tempo, sequenced live
with sample-accurate lookahead scheduling. Melody density and percussion are
driven by a combat-intensity value derived from nearby alerted enemies, so the
score swells as a fight develops and settles when it ends, with no explicit
"combat mode".

Browsers refuse to start an `AudioContext` without a user gesture, so the
manager constructs lazily on first input. Sounds before that are **discarded**,
not queued — a burst of stale audio on unlock is worse than silence.

---

## 11. Save system

Versioned from the first commit, because a save format always changes and
guessing its shape later is not possible. Migrations are pure functions from
version N to N+1, chained forward on load, so each only has to understand one
step and old saves keep working indefinitely.

Saves are **validated after parsing, not trusted**. Browser storage can be
truncated by a crash mid-write, and a partially written save that throws deep
inside boot is far worse than one rejected at the door. Writes go to a temporary
key and are then swapped, so an interrupted write never destroys the previous
good save. `localStorage` being unavailable (private browsing, disabled cookies)
falls back to memory: the game still runs, the save just does not persist.

---

## 12. Verification

| Layer | What it proves |
|---|---|
| `npm test` (115) | Systems are correct in isolation and assembled |
| `npm run validate` | **The game can be finished** |
| `npm run smoke` | The real game boots and runs in a real browser |
| `npm run typecheck` | Types are consistent across ~90 modules |

The reachability check is the most valuable thing in the repository. It walks
the world graph from the opening room with no abilities, collects everything
reachable, and repeats to a fixed point. If the final region is not reachable,
it fails.

It has already earned its place: it caught a fatal progression bug where Skim
gated the door to the boss who granted Skim, and three region gates required
abilities found only inside the region they gated. That is the one bug in this
genre that playtesting finds late and costs most to fix.

---

## 13. Known limits

Stated plainly rather than left to be discovered:

- **Vertical room connections** are built by carving a shaft with a one-way
  platform ladder. Reliable, but less interesting than a hand-authored climb.
- **The grapple (`Linecast`)** is defined as an ability and gates content, but
  its swing physics are not implemented; it currently behaves as a gate only.
- **Generated room names** come from region-appropriate word lists. Better than
  `sunkenarchive_14`, well short of hand-written.
- **Combat balance is unplayed.** Numbers follow a deliberate curve and are
  asserted by tests, but no amount of static analysis substitutes for playing it.
- **The four endings** are wired through `determineEnding` and the narrative
  alignment value, but the final choice sequence at the Last Weir is scaffolded
  rather than fully authored.
