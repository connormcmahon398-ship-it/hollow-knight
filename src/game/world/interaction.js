/**
 * @file Interaction: what happens when the player presses Interact.
 *
 * Kept as its own system rather than living on the props themselves, so that
 * the *rules* of interaction (range, one-shot vs repeatable, what locks it) are
 * stated once and every prop type obeys them.
 */

import { Events } from '../../engine/core/events.js';
import { Action } from '../../engine/input/input.js';
import { PlayerState } from '../player/player.js';
import { getInscription } from '../content/inscriptions.js';
import { getItem } from '../content/items.js';

export class InteractionSystem {
  /**
   * @param {Partial<import('../context.js').GameContext>} ctx
   */
  constructor(ctx) {
    this.ctx = ctx;
    this.bus = ctx.bus;
    /** Prop currently being read, if any. @type {any} */
    this.reading = null;
    this.readTimer = 0;
  }

  /**
   * @param {number} dt
   */
  update(dt) {
    const player = this.ctx.player;
    const world = this.ctx.world;
    const input = this.ctx.input;
    if (!player || !world || !input) return;

    if (this.reading) {
      this._updateReading(dt);
      return;
    }

    if (!player.hasControl) return;
    if (!input.consume(Action.INTERACT)) return;

    const target = world.nearestInteractable();
    if (!target) return;
    this._activate(target);
  }

  /**
   * @param {any} item
   * @private
   */
  _activate(item) {
    const player = /** @type {import('../player/player.js').Player} */ (this.ctx.player);
    const world = /** @type {import('./world.js').World} */ (this.ctx.world);

    switch (item.kind) {
      case 'checkpoint':
        player.machine.force(PlayerState.SIT);
        this.bus?.emit(Events.CHECKPOINT_REACHED, {
          roomId: world.room?.id,
          x: item.x,
          y: item.y,
        });
        break;

      case 'gate':
        if (!item.used) {
          item.used = true;
          world.setFlag(`interact:${world.room?.id}:${item.id}`);
          world.setFlag(`gatestone:${item.id}`);
        }
        this.bus?.emit(Events.FAST_TRAVEL_USED, { gate: item.id });
        this.bus?.emit(Events.SFX, { id: 'unlock' });
        break;

      case 'inscription':
        this._beginReading(item);
        break;

      case 'item':
        if (item.used) return;
        this._takeItem(item);
        break;

      case 'npc':
        this.bus?.emit(Events.DIALOGUE_STARTED, { npc: item.id, prop: item });
        break;

      case 'shop':
        this.bus?.emit('shop:open', { shop: item.id });
        break;

      case 'secret':
        if (item.used) return;
        item.used = true;
        world.setFlag(`interact:${world.room?.id}:${item.id}`);
        player.stats.secretsFound++;
        this.bus?.emit(Events.SECRET_FOUND, { id: item.id });
        this.bus?.emit(Events.SFX, { id: 'pickup' });
        this.bus?.emit(Events.SPAWN_PARTICLES, { kind: 'pickup', x: item.x, y: item.y - 10 });
        break;

      default:
        break;
    }
  }

  /**
   * Transcription: the player's core narrative verb. Reading an inscription is
   * a short channelled action rather than instant, because the fiction is that
   * you are *copying it down* — and because a beat of stillness is what turns a
   * wall of text into a moment.
   * @param {any} item
   * @private
   */
  _beginReading(item) {
    const player = /** @type {import('../player/player.js').Player} */ (this.ctx.player);
    this.reading = item;
    this.readTimer = 0;
    player.lockControl();
    this.bus?.emit(Events.SFX, { id: 'transcribe' });
    this.bus?.emit(Events.SPAWN_PARTICLES, { kind: 'transcribe', x: item.x, y: item.y - 12 });
  }

  /**
   * @param {number} dt
   * @private
   */
  _updateReading(dt) {
    const input = this.ctx.input;
    const player = /** @type {import('../player/player.js').Player} */ (this.ctx.player);
    const world = /** @type {import('./world.js').World} */ (this.ctx.world);
    this.readTimer += dt;

    // A minimum dwell prevents mashing past the text, then any input dismisses.
    if (this.readTimer < 0.4) return;
    if (!input?.consume(Action.INTERACT) && !input?.consume(Action.JUMP)
      && !input?.consume(Action.CANCEL) && this.readTimer < 30) {
      return;
    }

    const item = this.reading;
    this.reading = null;
    player.releaseControl();

    if (!item.used) {
      item.used = true;
      world.setFlag(`interact:${world.room?.id}:${item.id}`);
      world.setFlag(`transcribed:${item.id}`);
      player.stats.inscriptionsRead++;
      this.bus?.emit(Events.INSCRIPTION_TRANSCRIBED, {
        id: item.id,
        text: getInscription(item.id)?.text ?? '',
      });
    }
  }

  /**
   * @param {any} item
   * @private
   */
  _takeItem(item) {
    const player = /** @type {import('../player/player.js').Player} */ (this.ctx.player);
    const world = /** @type {import('./world.js').World} */ (this.ctx.world);
    item.used = true;
    world.setFlag(`interact:${world.room?.id}:${item.id}`);

    const def = getItem(item.id);
    this.bus?.emit(Events.ITEM_ACQUIRED, { id: item.id, def, x: item.x, y: item.y });
    this.bus?.emit(Events.SFX, { id: def?.ability ? 'unlock' : 'pickup' });
    this.bus?.emit(Events.SPAWN_PARTICLES, {
      kind: def?.ability ? 'unlock' : 'pickup',
      x: item.x,
      y: item.y - 12,
    });
  }

  /** @returns {any|null} the inscription currently on screen */
  get activeInscription() {
    return this.reading ? getInscription(this.reading.id) : null;
  }
}
