/**
 * @file Room registration.
 *
 * The opening regions are hand-authored end to end, because a player's first
 * twenty minutes decide whether they keep playing and are not a place to
 * delegate to a generator. Everything after that is assembled from hand-authored
 * templates by the world builder — see `generator.js` for exactly which
 * decisions are made by hand and which are made by the seed.
 */

import './saltshallows.js';
import { buildWorld } from './generator.js';
import { connectRegions } from './connections.js';

/** Statistics from the build, surfaced by the validation tool. */
export const WORLD_STATS = buildWorld({ seed: 'aetherweir-world-v1' });

// Stitch the generated regions to each other and to the hand-authored opening.
connectRegions();
