/**
 * @file Dialogue: presentation and choice handling.
 *
 * ## Why dialogue is a mode, not an overlay
 * While dialogue is open the player must not be able to walk, attack or take
 * damage. Implementing that as "an overlay plus a lot of `if (!dialogueOpen)`
 * checks" is how input leaks happen. Instead the player is put into the
 * `locked` state and the dialogue system owns input until it closes — one place
 * to be right instead of twenty.
 *
 * ## Typewriter reveal
 * Lines reveal character by character, and pressing confirm during a reveal
 * completes the line instantly rather than advancing. That single rule is worth
 * a surprising amount: it means a player can mash through dialogue they have
 * read before without ever accidentally skipping a line they have not.
 */

import { Events } from '../../engine/core/events.js';
import { Action } from '../../engine/input/input.js';
import { getNpc, selectNode } from '../content/npcs.js';
import { withAlpha } from '../../engine/render/palette.js';
import { clamp } from '../../engine/math/math-utils.js';

/** Characters revealed per second. */
const REVEAL_RATE = 52;

export class DialogueSystem {
  /**
   * @param {Partial<import('../context.js').GameContext>} ctx
   */
  constructor(ctx) {
    this.ctx = ctx;
    this.bus = ctx.bus;

    this.active = false;
    /** @type {any} */
    this.npc = null;
    /** @type {any} */
    this.node = null;
    this.lineIndex = 0;
    this.revealed = 0;
    /** @type {number} Index into the current node's choices, or -1. */
    this.choiceIndex = 0;
    this.showingChoices = false;

    this.bus?.on(Events.DIALOGUE_STARTED, (e) => this.open(e.npc));
  }

  /**
   * @param {string} npcId
   */
  open(npcId) {
    const def = getNpc(npcId);
    if (!def) {
      console.warn(`DialogueSystem: unknown NPC "${npcId}"`);
      return;
    }
    this.npc = def;
    this.node = selectNode(def, this.ctx);
    this.lineIndex = 0;
    this.revealed = 0;
    this.choiceIndex = 0;
    this.showingChoices = false;
    this.active = true;
    this.ctx.player?.lockControl();
    // Discard any buffered inputs, so the button that opened the conversation
    // does not immediately advance it.
    this.ctx.input?.clearAllBuffers();
  }

  close() {
    if (!this.active) return;
    this.active = false;
    const npcId = this.npc?.id;
    this.npc = null;
    this.node = null;
    this.ctx.player?.releaseControl();
    this.bus?.emit(Events.DIALOGUE_ENDED, { npc: npcId });
  }

  /**
   * @param {number} dt
   */
  update(dt) {
    if (!this.active || !this.node) return;
    const input = this.ctx.input;
    const line = this.node.lines[this.lineIndex] ?? '';

    if (this.revealed < line.length) {
      this.revealed = Math.min(line.length, this.revealed + REVEAL_RATE * dt);
    }

    if (!input) return;

    if (this.showingChoices) {
      const choices = this.node.choices ?? [];
      if (input.consume(Action.UP)) {
        this.choiceIndex = (this.choiceIndex - 1 + choices.length) % choices.length;
        this.bus?.emit(Events.SFX, { id: 'menuMove' });
      }
      if (input.consume(Action.DOWN)) {
        this.choiceIndex = (this.choiceIndex + 1) % choices.length;
        this.bus?.emit(Events.SFX, { id: 'menuMove' });
      }
      if (input.consume(Action.CONFIRM) || input.consume(Action.INTERACT)) {
        this._chooseOption(choices[this.choiceIndex]);
      }
      return;
    }

    if (input.consume(Action.CONFIRM) || input.consume(Action.INTERACT)) {
      if (this.revealed < line.length) {
        // First press completes the line rather than advancing past it.
        this.revealed = line.length;
        return;
      }
      this._advance();
    }
  }

  /** @private */
  _advance() {
    if (!this.node) return;
    this.bus?.emit(Events.SFX, { id: 'menuSelect' });

    if (this.lineIndex < this.node.lines.length - 1) {
      this.lineIndex++;
      this.revealed = 0;
      return;
    }

    if (this.node.choices && this.node.choices.length > 0) {
      this.showingChoices = true;
      this.choiceIndex = 0;
      return;
    }

    this._finishNode();
  }

  /**
   * @param {any} choice
   * @private
   */
  _chooseOption(choice) {
    if (!choice) {
      this._finishNode();
      return;
    }
    this.bus?.emit(Events.SFX, { id: 'menuSelect' });
    this.bus?.emit(Events.DIALOGUE_CHOICE, {
      npc: this.npc?.id, choice: choice.text, effect: choice.effect,
    });
    if (choice.record && this.ctx.progression) {
      this.ctx.progression.record += choice.record;
    }
    if (choice.effect) this.ctx.world?.setFlag(`choice:${choice.effect}`);

    if (choice.next && this.npc) {
      const next = this.npc.nodes.find((/** @type {any} */ n) => n.id === choice.next);
      if (next) {
        this.node = next;
        this.lineIndex = 0;
        this.revealed = 0;
        this.showingChoices = false;
        return;
      }
    }
    this._finishNode();
  }

  /** @private */
  _finishNode() {
    if (this.node?.setsFlag) this.ctx.world?.setFlag(this.node.setsFlag);
    if (this.node?.givesItem) this.ctx.progression?.acquire(this.node.givesItem);
    // Record that this conversation happened, so quests and later nodes can
    // depend on it.
    if (this.npc && this.node) {
      this.ctx.world?.setFlag(`talked:${this.npc.id}:${this.node.id}`);
      this.ctx.world?.setFlag(`talked:${this.npc.id}`);
    }
    this.close();
  }

  /**
   * @param {import('../../engine/render/renderer.js').Renderer} r
   */
  render(r) {
    if (!this.active || !this.node) return;
    const g = r.g;
    const boxH = 64;
    const y = r.height - boxH - 8;
    const x = 16;
    const w = r.width - 32;

    g.fillStyle = 'rgba(8,10,16,0.92)';
    g.fillRect(x, y, w, boxH);
    g.strokeStyle = withAlpha(r.palette.accent, 0.6);
    g.lineWidth = 1;
    g.strokeRect(x + 0.5, y + 0.5, w - 1, boxH - 1);

    // Speaker.
    r.text(`${this.npc.name}`, x + 8, y + 7, {
      color: r.palette.accent, size: 8, shadow: '#000000',
    });
    r.text(this.npc.title, x + 8 + r.measureText(this.npc.name, 8) + 6, y + 8, {
      color: withAlpha('#f4ead6', 0.45), size: 6,
    });

    if (this.showingChoices) {
      const choices = this.node.choices ?? [];
      choices.forEach((/** @type {any} */ c, /** @type {number} */ i) => {
        const selected = i === this.choiceIndex;
        r.text(`${selected ? '>' : ' '} ${c.text}`, x + 12, y + 22 + i * 11, {
          color: selected ? '#ffffff' : 'rgba(244,234,214,0.55)',
          size: 7,
        });
      });
      return;
    }

    // Word-wrapped, progressively revealed text.
    const line = this.node.lines[this.lineIndex] ?? '';
    const shown = line.slice(0, Math.floor(this.revealed));
    const wrapped = wrapText(r, shown, w - 20, 7);
    wrapped.forEach((row, i) => {
      r.text(row, x + 10, y + 22 + i * 10, { color: '#e8e0d0', size: 7 });
    });

    if (this.revealed >= line.length) {
      const more = this.lineIndex < this.node.lines.length - 1;
      r.text(more ? '▼' : '●', x + w - 14, y + boxH - 14, {
        color: withAlpha(r.palette.accent, 0.5 + 0.5 * Math.sin(Date.now() / 200)),
        size: 7,
      });
    }
  }
}

/**
 * Greedy word wrap against the renderer's actual measured width.
 * @param {import('../../engine/render/renderer.js').Renderer} r
 * @param {string} text
 * @param {number} maxWidth
 * @param {number} size
 * @returns {string[]}
 */
export function wrapText(r, text, maxWidth, size) {
  const words = text.split(' ');
  /** @type {string[]} */
  const lines = [];
  let current = '';
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (r.measureText(candidate, size) > maxWidth && current) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  return lines;
}
