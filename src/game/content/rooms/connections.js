/**
 * @file Inter-region connections.
 *
 * The world builder produces each region as a self-contained graph. This file
 * states how those regions attach to one another, which is a *design* decision
 * and therefore authored by hand rather than generated.
 *
 * ## The gating order
 * Each connection carries the ability the player needs to pass it. Read as a
 * list, this is the game's critical path, and it is deliberately shallow: at
 * most three regions are ever gated behind the same ability, so a player who
 * finds one ability always has somewhere new to go.
 */

import { ROOM_DEFS } from '../../world/room.js';
import { parseAbilityMask } from '../../player/abilities.js';

/**
 * Each entry links the first room of one region to the first room of another.
 * `gate` names the ability required to traverse it in the *forward* direction;
 * the return trip is always free, so a region can never trap the player.
 * @type {Array<{from: string, to: string, gate?: string, oneWay?: boolean}>}
 */
export const REGION_LINKS = [
  // The gate on each link is an ability obtainable in a region that is already
  // reachable without it. That property is what `tools/validate-content.mjs`
  // verifies by fixed-point flood fill, and violating it makes the game
  // unwinnable rather than merely hard.
  { from: 'quillrest_01', to: 'sunkenarchive_00' },
  { from: 'sunkenarchive_00', to: 'verdigris_00', gate: 'skim' },
  { from: 'sunkenarchive_01', to: 'glasswake_00', gate: 'gripscript' },
  { from: 'glasswake_00', to: 'weepinggallery_00', gate: 'paperwing' },
  { from: 'verdigris_00', to: 'cinderloom_00', gate: 'updraftsail' },
  { from: 'sunkenarchive_02', to: 'marrowterraces_00', gate: 'palimpsest' },
  { from: 'glasswake_01', to: 'ashenspire_00', gate: 'skyskim' },
  { from: 'marrowterraces_00', to: 'umbralfen_00', gate: 'anchorbreak' },
  { from: 'weepinggallery_00', to: 'clockspill_00', gate: 'plumbstrike' },
  { from: 'clockspill_00', to: 'auricdeep_00', gate: 'linecast' },
  { from: 'auricdeep_00', to: 'lastweir_00', gate: 'deepwell' },
  { from: 'umbralfen_01', to: 'inkbelow_00', gate: 'blotstep' },
  { from: 'umbralfen_02', to: 'blankmargin_00', gate: 'blotstep|palimpsest' },
  { from: 'cinderloom_00', to: 'ninestrokes_00', gate: 'skim|paperwing|gripscript' },
];

/**
 * Apply the links. Missing rooms are reported rather than thrown, so a partial
 * content build still produces a playable world for testing.
 * @returns {{linked: number, missing: string[]}}
 */
export function connectRegions() {
  let linked = 0;
  /** @type {string[]} */
  const missing = [];

  for (const link of REGION_LINKS) {
    const from = ROOM_DEFS.get(link.from);
    const to = ROOM_DEFS.get(link.to);
    if (!from || !to) {
      missing.push(`${link.from} -> ${link.to}`);
      continue;
    }
    const gate = link.gate ? parseAbilityMask(link.gate) : 0;

    from.exits = from.exits ?? [];
    to.exits = to.exits ?? [];

    // Forward link is gated; the return is not, so no region is a one-way trap.
    from.exits.push({ edge: 'bottom', offset: 14, span: 3, to: link.to, gate });
    if (!link.oneWay) {
      to.exits.push({ edge: 'top', offset: 14, span: 3, to: link.from, gate: 0 });
    }
    linked++;
  }

  return { linked, missing };
}
