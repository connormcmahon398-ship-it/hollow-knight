/**
 * @file Entry point.
 *
 * Content modules are imported for their registration side effects. The import
 * order matters only in that biomes must be registered before rooms reference
 * them, which the module graph guarantees because rooms do not import biomes
 * directly — the world resolves biomes at load time.
 */

import { Game } from './game/game.js';

// --- content registration ---
import './game/content/biomes.js';
import './game/content/enemies.js';
import './game/content/bosses.js';
import './game/content/items.js';
import './game/content/inscriptions.js';
import './game/content/npcs.js';
import './game/content/quests.js';
import './game/content/rooms/index.js';

/**
 * Boot the game against a canvas element.
 * @param {HTMLCanvasElement} canvas
 * @param {object} [options]
 * @returns {Game}
 */
export function boot(canvas, options = {}) {
  const game = new Game(canvas, options);
  game.start();
  // Exposed for debugging from the console; harmless in production and
  // invaluable when diagnosing a report.
  /** @type {any} */ (globalThis).AETHERWEIR = game;
  return game;
}

// Auto-boot when loaded as a page script.
if (typeof document !== 'undefined') {
  const start = () => {
    const canvas = /** @type {HTMLCanvasElement|null} */ (document.getElementById('game'));
    if (!canvas) return;
    try {
      boot(canvas);
      const loading = document.getElementById('loading');
      if (loading) loading.remove();
    } catch (err) {
      console.error('AETHERWEIR failed to start', err);
      const loading = document.getElementById('loading');
      if (loading) {
        loading.textContent = `Failed to start: ${err instanceof Error ? err.message : String(err)}`;
        loading.classList.add('error');
      }
    }
  };
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
}
