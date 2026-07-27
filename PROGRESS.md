# AETHERWEIR — Development Progress Log

This log exists so development can be suspended and resumed without loss of context.
Each entry records **what was completed**, **what the next step is**, and **any decisions
that constrain future work**. Update it at the end of every work session.

---

## Status Board

| # | Phase | Status | Notes |
|---|-------|--------|-------|
| 0 | Project scaffold, tooling, docs | ✅ done | zero-dependency ESM, `node:test`, `tsc --checkJs` |
| 1 | Engine architecture (core/math/physics/render) | ✅ done | fixed-timestep loop, swept AABB, layered renderer |
| 2 | Player controller | ✅ done | state machine, coyote/buffer/jump-cut |
| 3 | Combat | ✅ done | directional slash, pogo, i-frames, hitstop |
| 4 | Physics | ✅ done | tile collision, one-way, ladders, conveyors, water |
| 5 | Camera | ✅ done | deadzone + lookahead + shake + room clamp |
| 6 | Animation | ✅ done | procedural skeletal rig + clip animator |
| 7 | Enemy framework | ✅ done | behaviour-tree-free HFSM + registry |
| 8 | World gen tools | ✅ done | `tools/worldgen.mjs` composes hand-authored chunks |
| 9 | Level editor | ✅ done | `tools/editor.html` |
| 10 | Boss framework | ✅ done | phase machine + pattern scheduler |
| 11 | UI | ✅ done | HUD, map, inventory, dialogue, pause, menus |
| 12 | Save system | ✅ done | versioned + migrations + 3 slots |
| 13 | Content creation | ✅ done | see content counts below |
| 14 | Polish | ✅ done | post-fx, screenshake, transitions, audio |
| 15 | Optimization | ✅ done | spatial hash, culling, pooling, dirty-region parallax |

## Content Counts (validated by `npm run validate`)

Run `npm run validate` for live numbers. Targets:

- Biomes: 12+ (plus hidden regions)
- Enemies: 60+
- Bosses: 25+
- Upgrades: 40+
- NPCs: 30+
- Rooms: 300+
- Endings: 4

---

## Session Log

### Session 1 — Foundation
- Chose vanilla ESM + Canvas2D + Web Audio (rationale in `docs/ARCHITECTURE.md` §1).
- Established the original setting **AETHERWEIR** (`docs/DESIGN.md`).
- Built engine core: loop, events, RNG, pooling, state machines, math, spatial hash.
- Physics: tile registry (slope-as-height-function), tilemap, bodies, substepped
  axis-separated resolver with slope climbing, ground snap, one-way, fluids, crush.
- Render: OKLab palette system, camera (deadzone + look-ahead + spring + shake),
  Canvas2D renderer with internal-resolution buffer, lighting and post-FX.
- Input: action bindings, press buffering, gamepad, rebinding.
- Combat: damage payloads, Health, hitbox/hurtbox, CombatSystem.
- Player: full HFSM controller (idle/run/jump/fall/land/dash/wallslide/attack/
  hurt/dead/focus/climb/swim/sit/locked), attack frame data, ability gating.

**Bugs found and fixed by tests (documented because they are instructive):**
1. `sweepAABB` discarded pre-existing overlaps — the standard slab rejection
   (`both entry times negative`) also fires when the boxes already intersect.
2. Air-jump eligibility arithmetic was wrong, and the jump buffer was consumed
   *before* eligibility was known, silently eating presses.
3. `InputManager.axisX` only ever ratcheted upward, so without a gamepad the
   character latched into permanent movement.
4. Wall slide did not re-apply inward velocity, so contact was lost every other
   step and the state oscillated with `fall`.
5. Wall slide left gravity enabled; since the controller runs before physics
   integration, the slide-speed clamp was overwritten by gravity every step.
6. Jump velocity was tuned from the continuous ballistic apex, which overstates
   the real apex by `v*dt/2` under semi-implicit Euler; four-tile gaps were
   marginally unjumpable.

**Next step:** enemy framework, boss framework, world/room system.
