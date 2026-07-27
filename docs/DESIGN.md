# AETHERWEIR — Design Document

---

## 1. Premise

**Aetherweir** was a sky-continent. It fell into an endless salt basin, and what
remains of the aether that held it aloft is now dammed behind a series of
failing **weirs**. The last of them is not expected to hold.

You are **Nib**, a small ink-and-brass automaton of the **Scrivener** order — a
*Quill* — woken in the salt flats with one instruction: **record the testimony**.

Nobody agrees what that means. Half of Quillrest believes the record must be
kept faithfully whatever it costs. The other half — the **Choir of the
Unwritten** — believes the record is a weight the world would be better off
setting down.

## 2. The central idea

**Lore is a verb.**

The failure mode of "environmental storytelling" is a long text box attached to
a wall, which is exposition wearing a hat. Here, reading is an *act*:

- Inscriptions are physical objects in the world with their own light.
- **Transcribing** one is a channelled action — a beat of stillness and
  vulnerability, not a button press.
- Everything transcribed accumulates into your record, visible on the pause
  screen and counted toward completion.
- **What you record determines the ending.**

So the game's story is not delivered *to* the player. It is assembled *by* them,
and their thoroughness is a mechanical choice with a mechanical consequence.

The same idea runs through the resource economy: **ink** is your magic, your
healing, your record and what you drop when you die. One substance, four roles,
all of them thematically the same thing.

## 3. Core loop

```
explore → find an inscription or an ability → a previously refused door opens
   ↑                                                          ↓
   └───────── new region: new creatures, new hazard vocabulary ┘
```

Combat feeds it: **ink is earned only by landing hits**, and healing costs ink.
The only way to heal is to have fought well, which ties aggression to survival
and is the central risk/reward of the combat design. Focusing locks you in place
entirely — healing always costs you your positioning.

## 4. Resources

| | |
|---|---|
| **Filaments** | Health. Integral, starts at 5, discrete pips. In a five-hit game the exact count matters and a bar makes you estimate. |
| **Ink** | Earned by hitting things. Spent on healing and scripts. Bar with per-heal threshold ticks, because the only reading that matters mid-fight is "how many heals do I have". |
| **Glyphs** | Currency. Dropped on death, recoverable. |
| **Wax** | The budget that equipped Seals consume. |

## 5. Progression

Three deliberately separate kinds:

1. **Abilities** (16) — permanent movement verbs. Few, so each is an event.
2. **Etchings** (24) — permanent stat increases. Always strictly good, so
   finding one is never a decision.
3. **Seals** (26) — equippable modifiers costing **wax**, from a limited budget.
   This is where build expression lives, because equipping one means *not*
   equipping another.

Keeping them separate matters: if stat upgrades competed for slots, players
would hoard rather than experiment; if Seals were permanent there would be no
build at all. Seals may only be changed at a Wellspring, so the choice costs
something.

**Seal design rule:** every Seal must change *how you play*, not just a number.
"+15% damage" is not a Seal. "Your damage rises the longer you go untouched" is,
because it changes what you do in a fight.

### Ability gating rules

- Each ability must open **more than one** region. An ability that unlocks one
  door is a key, and keys teach the player nothing about how to move.
- At most three regions are gated behind any single ability, so finding one
  always leaves somewhere new to go.
- **Every gate's ability is obtainable in a region reachable without it.** This
  is verified by machine (`npm run validate`), not by hope.

### The critical path

| Region | Gate | Grants |
|---|---|---|
| Salt Shallows | — | **Skim**, Mantle |
| Quillrest (hub) | — | — |
| Sunken Archive | — | **Gripscript**, **Palimpsest** |
| Verdigris Waterworks | Skim | **Updraft Sail** |
| Glasswake | Gripscript | **Paperwing**, **Skyskim** |
| Weeping Gallery | Paperwing | **Plumbstrike** |
| Cinderloom | Updraft Sail | Emberskin |
| Marrow Terraces | Palimpsest | **Anchorbreak** |
| Ashen Spire | Skyskim | Driftleaf |
| Umbral Fen | Anchorbreak | **Blotstep** |
| Clockspill | Plumbstrike | **Linecast** |
| Auric Deep | Linecast | Meniscus, **Deepwell** |
| The Last Weir | Deepwell | Tidemark |
| *Ink Below* (hidden) | Blotstep | — |
| *Blank Margin* (hidden) | Blotstep + Palimpsest | — |
| *Trial of Nine Strokes* | Skim + Paperwing + Gripscript | — |

## 6. The regions

Each carries a palette, an ambience, a **hazard vocabulary** (which tile types it
may use), a tempo and an idea. The hazard vocabulary is enforced by data, so a
Cinderloom room cannot accidentally contain frost.

| Region | The idea |
|---|---|
| **The Salt Shallows** | Teaches movement without saying so. Nothing here can kill you quickly. |
| **Quillrest** | A hub whose warmth is the measure of everything outside it. |
| **The Sunken Archive** | Vertical stacks and flooded aisles. Teaches wall work. |
| **Verdigris Waterworks** | The first region that *moves while you do*. |
| **The Glasswake** | Brittle terrain. The ground is a resource you spend. |
| **The Weeping Gallery** | Wide vertical faces under permanent rain. The double jump's playground. |
| **The Cinderloom** | Wind columns and heat. Movement becomes three-dimensional. |
| **The Marrow Terraces** | Layered floors that must be broken through. Progress is downward. |
| **The Umbral Fen** | Near-total darkness. *Seeing* is the challenge. |
| **The Clockspill** | Rooms on timers. The region that will not wait. |
| **The Ashen Spire** | One enormous vertical climb. |
| **The Auric Deep** | Fully submerged. Movement rules change entirely. |
| **The Last Weir** | Every verb at once, under pressure. |
| *The Blank Margin* | A white void of unwritten geometry — the rules, visible. |
| *The Ink Below* | The optional abyss. Hardest platforming, no checkpoints. |
| *The Trial of Nine Strokes* | A pure combat gauntlet. |

## 7. Combat

**Nib's moveset is small and readable.** Three attacks — forward, up, down —
plus a dash. Depth comes from *when* and *from where*, not from a long combo
list.

| Attack | Frames | Role |
|---|---|---|
| Slash | 3 / 5 / 7 | The baseline. Everything else reads relative to it. |
| Up-slash | 3 / 5 / 7 | 15% weaker. Covers space nothing else reaches; the answer to flyers. |
| Plumbstrike | 3 / 5 / 7 | 20% weaker, but bounces and refunds the double jump. Its value is mobility, and pricing it as damage would make every fight a pogo fight. |

The up-slash being *worse* is deliberate. Giving it equal damage would make it
strictly better than the forward slash against anything approachable from below.

**Movement continues during attacks.** Stopping the player dead makes combat a
series of pauses rather than a flow. Jumping and dashing cancel recovery frames,
which rewards timing and keeps aerial combat mobile.

**Attacking out of a dash** keeps the dash's momentum and is the core of the
offensive movement game.

### Feel

Hit-stop (4-6 frames) does more for impact than any particle effect. Screen
shake uses trauma-squared so a flurry of small hits stays subtle while a boss
slam is violent. Striking terrain produces a spark and a recoil, so the blade
feels like it occupies space.

## 8. Bosses

35 encounters, 22 optional, 4 secret. Each is a sequence of phases; each phase
is a weighted pool of patterns. Distinctness comes from composition and pacing:

- **Early:** two phases, 0.6-0.9s telegraphs, long recoveries. They teach the
  vocabulary of reading a wind-up.
- **Mid:** three phases, mixed ranges, so no single distance is safe.
- **Late and secret:** three or four phases, telegraphs near the 0.28s fairness
  floor, patterns that punish the standard answers.

Phase thresholds are spaced so no phase ends before the player has seen its whole
pattern pool. A phase that lasts eight seconds is scenery, not design.

## 9. Death

You drop your carried **Glyphs** and respawn at the last **Wellspring**. Health
and ink are restored; the ink you were carrying is not.

Falling into a pit or spikes costs a filament and returns you to the last
position where you were *genuinely settled* — grounded, slow, with ground under
both feet and no hazard overlapping. Hazard knockback pushes you toward safety
rather than in a physical direction, because physical knockback off a spike
frequently launches you into another spike, which is the definition of unfair.

## 10. The endings

Determined by how you treated the record: what you transcribed, what you
redacted, and the final choice at the Last Weir.

| Ending | Condition |
|---|---|
| **The Faithful Record** | Record truthfully. The world ends, and is remembered exactly as it was. |
| **The Redaction** | Side with the Choir. The record is erased. Nothing that happened here happened. |
| **The Forgery** | Write a kinder history than the true one. Everyone is remembered better than they were. |
| **The Blank Page** *(secret)* | Refuse to record, having found both the First Page and the Last. Somebody left room. |

The alignment value moves with every transcription (+1) and every redaction, so
the ending you qualify for is the accumulated shape of a hundred small choices,
not a menu at the end.

## 11. Original civilizations

- **The Scriveners** — automaton scribes built to record. Nib's order. Split
  between the Faithful Record and the Choir of the Unwritten.
- **The Weirwrights** — the engineer caste who built the dams, and who signed
  the plans rating them for a century some time ago.
- **The Glasskin** — nomads of the Glasswake who walk fused glass barefoot and
  navigate by the sound of thinness.
- **The Marrowfolk** — subterranean farmers who terrace the ribs of a fossil so
  large they call each vertebra a county.
- **The Sootwrights** — the Cinderloom's mill-hands, who wove the sky its colour
  and have not managed to explain to the looms that the sky is gone.

## 12. Content

| | |
|---|---|
| Regions | 16 (14 required, 2 hidden) |
| Rooms | 308 |
| Creatures | 83 across 16 AI archetypes |
| Bosses | 35 (85 phases, 253 pattern instances) |
| Items | 70 — 16 abilities, 24 etchings, 26 seals, 4 keys/relics |
| Characters | 32 |
| Inscriptions | 47 |
| Quests | 12 |
| Endings | 4 |

## 13. Originality

Every element is original to this project: the setting, the characters, the
creatures, the bosses, the regions, the items, the lore, the dialogue, the level
layouts, the mechanics and the code.

There are no asset files. All art is drawn from canvas primitives at runtime and
all audio is synthesised from oscillators, so there is nothing in the repository
that could have been copied from anything. Typography uses generic CSS font
families only.
