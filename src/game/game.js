/**
 * @file The game: system ownership, the update order, and the render order.
 *
 * ## Why the update order is explicit and commented
 * In an action game, *when* each system runs relative to the others is not an
 * implementation detail — it is the difference between a hit registering on the
 * frame you saw it and one frame later. This file is the single authoritative
 * statement of that order, and every entry has a reason.
 *
 * ## The frame
 *   1. input        — fold raw events into action state
 *   2. player       — read input, write velocity
 *   3. world/AI     — enemies read the world as it was, write velocity
 *   4. physics      — integrate everything, resolve collisions
 *   5. lateUpdate   — react to collision results (landing, walls)
 *   6. combat       — resolve hitboxes against the *resolved* positions
 *   7. projectiles  — move and test, after combat so a hit lands this frame
 *   8. particles/fx — purely reactive
 *   9. camera       — follow the final positions, so it never lags a frame
 *  10. bus.flush    — deferred structural changes, at a point where nothing is iterating
 *
 * Steps 4 and 6 are the important pairing: resolving combat *before* physics
 * would test hitboxes against last frame's positions, which is the classic
 * "I clearly hit it" bug.
 */

import { EventBus, Events } from '../engine/core/events.js';
import { GameLoop } from '../engine/core/loop.js';
import { PhysicsWorld } from '../engine/physics/physics-world.js';
import { CombatSystem } from './combat/hitbox.js';
import { ParticleSystem } from '../engine/fx/particles.js';
import { InputManager, Action } from '../engine/input/input.js';
import { Camera } from '../engine/render/camera.js';
import { Renderer, INTERNAL_WIDTH, INTERNAL_HEIGHT } from '../engine/render/renderer.js';
import { Rng } from '../engine/core/rng.js';
import { AudioManager } from '../engine/audio/audio-manager.js';
import { SaveSystem } from '../engine/save/save-system.js';
import { Player, PlayerState } from './player/player.js';
import { World } from './world/world.js';
import { ProjectileSystem } from './world/projectile.js';
import { TilePainter } from './render/tile-painter.js';
import { ParallaxBackground } from './render/parallax.js';
import { drawPlayer, drawEnemy } from './render/actor-painter.js';
import { HUD } from './ui/hud.js';
import { GRAVITY } from './player/movement-config.js';
import { getBiome } from './content/biomes.js';
import { spawnEffect } from './render/effects.js';
import { InteractionSystem } from './world/interaction.js';
import { MapSystem } from './map/map-system.js';
import { Progression } from './progression/progression.js';
import { drawInteractable } from './render/prop-painter.js';
import { DialogueSystem } from './npc/dialogue.js';
import { QuestSystem, allQuests } from './content/quests.js';
import { clamp } from '../engine/math/math-utils.js';
import { wrapText } from './npc/dialogue.js';
import { withAlpha as withAlphaLocal } from '../engine/render/palette.js';

/**
 * Top-level modes. Menus are modes, not overlays, so input never leaks.
 * @type {Readonly<Record<string, string>>}
 */
export const GameMode = Object.freeze({
  TITLE: 'title',
  PLAYING: 'playing',
  PAUSED: 'paused',
  MAP: 'map',
  DIALOGUE: 'dialogue',
  DEAD: 'dead',
  ENDING: 'ending',
});

export class Game {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {object} [options]
   * @param {string} [options.startRoom]
   * @param {string} [options.seed]
   */
  constructor(canvas, options = {}) {
    this.canvas = canvas;
    this.renderer = new Renderer(canvas);
    this.bus = new EventBus();
    this.input = new InputManager();
    this.camera = new Camera(INTERNAL_WIDTH, INTERNAL_HEIGHT);
    this.physics = new PhysicsWorld({ gravity: GRAVITY });
    this.combat = new CombatSystem(this.bus);
    this.particles = new ParticleSystem(2400);
    this.rng = new Rng(options.seed ?? 'aetherweir');
    this.audio = new AudioManager();
    this.saves = new SaveSystem();

    /** @type {Partial<import('./context.js').GameContext>} */
    this.ctx = {
      bus: this.bus,
      physics: this.physics,
      combat: this.combat,
      particles: this.particles,
      input: this.input,
      camera: this.camera,
      rng: this.rng,
      audio: this.audio,
      saves: this.saves,
      elapsed: 0,
      paused: false,
      debug: false,
    };

    this.player = new Player(this.ctx);
    this.ctx.player = this.player;
    this.player.attach();

    this.world = new World(this.ctx);
    this.ctx.world = this.world;

    this.projectiles = new ProjectileSystem(this.ctx);
    this.interaction = new InteractionSystem(this.ctx);
    this.progression = new Progression(this.ctx);
    this.ctx.progression = this.progression;
    this.mapSystem = new MapSystem(this.ctx);
    this.ctx.mapSystem = this.mapSystem;
    this.dialogue = new DialogueSystem(this.ctx);
    this.ctx.dialogue = this.dialogue;
    this.quests = new QuestSystem(this.ctx);
    this.ctx.quests = this.quests;

    this.tilePainter = new TilePainter();
    this.parallax = new ParallaxBackground();
    this.hud = new HUD();

    this.mode = GameMode.PLAYING;
    this.startRoom = options.startRoom ?? 'shallows_01';
    /** Room the player respawns at, set by Wellsprings. */
    this.checkpointRoom = this.startRoom;
    /** @type {{x: number, y: number}|null} */
    this.checkpointPos = null;

    this.deathTimer = 0;
    this.time = 0;
    /** Combat intensity, drives adaptive music. */
    this._intensity = 0;

    this.loop = new GameLoop(
      {
        update: (dt) => this.update(dt),
        render: (alpha, frameDt) => this.render(alpha, frameDt),
      },
      { tickRate: 60 },
    );

    this._wireEvents();
    this._installResizeHandling();
  }

  /** @private */
  _wireEvents() {
    const bus = this.bus;

    // Presentation systems subscribe to gameplay events rather than gameplay
    // calling into them, so combat has no idea audio or particles exist.
    bus.on(Events.SFX, (e) => this.audio.play(e.id, e));
    bus.on(Events.SCREEN_SHAKE, (e) => this.camera.addTrauma(e.amount));
    bus.on(Events.HITSTOP, (e) => this.loop.requestHitstop(e.frames));
    bus.on(Events.FLASH, (e) => this.renderer.flash(e.color, e.amount));
    bus.on(Events.SPAWN_PARTICLES, (e) => spawnEffect(this.particles, e, this.renderer.palette));

    bus.on(Events.ATTACK_CONNECTED, (e) => {
      this.audio.play('hit', { pitch: 0.8 + Math.random() * 0.4 });
      spawnEffect(this.particles, {
        kind: 'impact', x: e.impactX, y: e.impactY,
      }, this.renderer.palette);
    });

    bus.on(Events.DAMAGE_TAKEN, (e) => {
      if (e.target === this.player) this.audio.play('playerHurt');
    });

    bus.on(Events.PLAYER_DIED, () => {
      this.mode = GameMode.DEAD;
      this.deathTimer = 0;
      this.audio.setIntensity(0);
    });

    bus.on(Events.ROOM_ENTERED, (e) => {
      const biome = e.biome;
      this.renderer.palette = biome.palette;
      this.tilePainter.invalidate();
      this.tilePainter.buildCache(e.room.map, biome.palette, `${e.room.id}:${this.world.flags.size}`);
      this.parallax.build(
        biome.parallax ?? 'flats', biome.palette, e.room.id,
        e.room.bounds.w, e.room.bounds.h,
      );
      this.renderer.vignetteStrength = 0.35 + (1 - biome.ambient) * 0.5;
      this.audio.playMusic(e.room.music ?? biome.music);
      this.audio.playAmbience(biome.ambience);
      this.mapSystem.visit(e.room);
    });

    bus.on(Events.BIOME_ENTERED, (e) => {
      if (this._lastBiome === e.biome.id) return;
      this._lastBiome = e.biome.id;
      this.hud.showTitleCard(e.biome.name, e.biome.subtitle);
    });

    bus.on(Events.BOSS_ENCOUNTER_STARTED, (e) => {
      this.audio.playMusic('boss');
      this.audio.setIntensity(1);
      this.hud.toast(e.def.name, e.def.title, 3.5);
    });

    bus.on(Events.BOSS_DEFEATED, (e) => {
      this.audio.setIntensity(0);
      const biome = getBiome(e.def.biome);
      this.audio.playMusic(biome.music);
      this.hud.toast(`${e.def.name} felled`, '', 3.5);
      if (e.def.rewardAbility) this.progression.grantAbilityById(e.def.rewardAbility);
    });

    bus.on(Events.ABILITY_UNLOCKED, (e) => {
      this.audio.play('unlock');
      this.loop.timeScale = 1;
    });

    bus.on(Events.FLAG_SET, () => this.quests.evaluate());

    bus.on(Events.DIALOGUE_ENDED, (e) => {
      // Talking to a quest giver is what starts their quest.
      for (const quest of allQuests()) {
        if (quest.giver === e.npc) this.quests.start(quest.id);
      }
      this.quests.evaluate();
    });

    bus.on(Events.UPGRADE_ACQUIRED, (e) => {
      this.hud.toast(e.def.name, e.def.description, 4);
    });

    bus.on(Events.INSCRIPTION_TRANSCRIBED, (e) => {
      this.hud.toast('Transcribed', '', 2.4);
    });

    bus.on('quest:started', (e) => this.hud.toast(`New charge: ${e.def.name}`, e.def.summary, 4.5));
    bus.on('quest:completed', (e) => this.hud.toast(`Charge fulfilled: ${e.def.name}`, '', 4));

    bus.on(Events.CHECKPOINT_REACHED, (e) => {
      this.checkpointRoom = e.roomId;
      this.checkpointPos = { x: e.x, y: e.y };
      this.saveGame(0);
      this.hud.toast('Recorded', 'The Wellspring remembers this moment.', 2.6);
    });
  }

  /** @private */
  _installResizeHandling() {
    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const rect = this.canvas.parentElement?.getBoundingClientRect()
        ?? { width: window.innerWidth, height: window.innerHeight };
      this.renderer.resize(rect.width, rect.height, dpr);
    };
    window.addEventListener('resize', resize);
    resize();
    this._resize = resize;
  }

  /** Begin a new run. */
  start() {
    this.input.attach();
    // The AudioContext can only be created from a user gesture, so the first
    // key press or click is what actually turns the sound on.
    const unlock = () => {
      this.audio.unlock();
      window.removeEventListener('keydown', unlock);
      window.removeEventListener('pointerdown', unlock);
    };
    window.addEventListener('keydown', unlock);
    window.addEventListener('pointerdown', unlock);

    this.world.loadRoom(this.startRoom);
    this.mode = GameMode.PLAYING;
    this.loop.start();
  }

  stop() {
    this.loop.stop();
    this.input.detach();
  }

  // ==========================================================================
  // Update
  // ==========================================================================

  /**
   * @param {number} dt
   */
  update(dt) {
    this.time += dt;
    this.ctx.elapsed = (this.ctx.elapsed ?? 0) + dt;

    // 1. Input is always folded, so menus respond even while paused.
    this.input.update(dt);

    if (this.input.consume(Action.PAUSE)) this._togglePause();
    if (this.input.consume(Action.DEBUG)) this.ctx.debug = !this.ctx.debug;

    if (this.mode === GameMode.PAUSED) {
      this.input.endStep();
      return;
    }

    if (this.mode === GameMode.MAP) {
      this.mapSystem.updateScreen(dt, this.input);
      if (this.input.consume(Action.MAP) || this.input.consume(Action.CANCEL)) {
        this.mode = GameMode.PLAYING;
      }
      this.input.endStep();
      return;
    }

    if (this.mode === GameMode.DEAD) {
      this._updateDeath(dt);
      this.input.endStep();
      return;
    }

    if (this.mode === GameMode.PLAYING && this.input.consume(Action.MAP)) {
      this.mode = GameMode.MAP;
      this.input.endStep();
      return;
    }

    // Dialogue owns input while open; the player is already in `locked`, so
    // physics and rendering continue but nothing reads the controls.
    if (this.dialogue.active) {
      this.dialogue.update(dt);
      this.player.update(dt);
      this.physics.step(dt);
      this.player.lateUpdate(dt);
      this.camera.update(dt);
      this.bus.flush();
      this.input.endStep();
      return;
    }

    // The world's transition state suspends gameplay without pausing rendering.
    this.world.update(dt);
    if (this.world.transitioning) {
      this.input.endStep();
      this.bus.flush();
      return;
    }

    // 2. Player reads input and writes velocity.
    this.player.update(dt);

    // 3. Enemies read the world and write velocity. (Inside world.update above
    //    for AI; positions are integrated next.)

    // 4. Physics integrates and resolves everything at once.
    this.physics.step(dt);

    // 5. React to collision results.
    this.player.lateUpdate(dt);
    this.world.lateUpdate(dt);

    // 6. Combat resolves against resolved positions.
    this.combat.update(dt);

    // 7. Projectiles.
    this.projectiles.update(dt);

    // 8. Interaction, effects.
    this.interaction.update(dt);
    this.particles.update(dt, this.ctx.map);
    this.quests.evaluate();

    // 9. Camera follows the final positions.
    this.camera.follow(
      { x: this.player.body.box.centerX, y: this.player.body.box.centerY },
      {
        facing: this.player.facing,
        velocityX: this.player.body.velocity.x,
        velocityY: this.player.body.velocity.y,
        grounded: this.player.body.grounded,
      },
    );
    this.camera.update(dt);

    this._updateAudioIntensity(dt);
    this.hud.update(dt, this.player, this.world.boss);

    // 10. Deferred structural events, at the one point nothing is iterating.
    this.bus.flush();
    this.input.endStep();
  }

  /**
   * @param {number} dt
   * @private
   */
  _updateDeath(dt) {
    this.deathTimer += dt;
    this.player.update(dt);
    this.physics.step(dt);
    this.particles.update(dt, this.ctx.map);
    this.camera.update(dt);
    this.bus.flush();

    if (this.deathTimer > 2.4) {
      this.respawn();
    }
  }

  /**
   * @param {number} dt
   * @private
   */
  _updateAudioIntensity(dt) {
    // Intensity is driven by nearby live threats, so the score swells as a fight
    // develops and settles when it is over — without any explicit "combat mode".
    let threat = 0;
    if (this.world.boss?.encounterActive) {
      threat = 1;
    } else {
      for (const enemy of this.world.enemies) {
        if (enemy.isDead || !enemy.alerted) continue;
        if (enemy.distanceToPlayer < 200) threat += 0.25;
      }
    }
    this._intensity = clamp(threat, 0, 1);
    this.audio.setIntensity(this._intensity);
    this.audio.update(dt);
  }

  /** @private */
  _togglePause() {
    if (this.mode === GameMode.PLAYING) {
      this.mode = GameMode.PAUSED;
      this.audio.play('menuSelect');
    } else if (this.mode === GameMode.PAUSED) {
      this.mode = GameMode.PLAYING;
      this.input.clearAllBuffers();
    }
  }

  /** Return the player to their last Wellspring. */
  respawn() {
    this.player.health.reset();
    this.player.ink = 0;
    this.player.machine.force(PlayerState.FALL);
    this.mode = GameMode.PLAYING;
    this.world.loadRoom(this.checkpointRoom, this.checkpointPos ?? undefined);
    this.bus.emit(Events.PLAYER_RESPAWNED, { player: this.player });
    this.hud.toast('You are recovered', 'The ink you were carrying is not.', 3);
  }

  // ==========================================================================
  // Render
  // ==========================================================================

  /**
   * @param {number} alpha
   * @param {number} frameDt
   */
  render(alpha, frameDt) {
    const r = this.renderer;
    const map = this.ctx.map;
    const palette = r.palette;

    r.beginFrame(palette.sky);

    r.beginWorld(this.camera);

    // Background layers first: parallax, then terrain, then actors, then FX.
    this.parallax.render(r, this.camera, frameDt);

    if (map) {
      this.tilePainter.render(r, map, palette, this.camera, frameDt);
    }

    for (const item of this.world.interactables) {
      drawInteractable(r, item, this.time, palette);
    }

    for (const enemy of this.world.enemies) {
      if (enemy.dormant && !enemy.isBoss) continue;
      if (!this.camera.isVisible(enemy.body.box, 48)) continue;
      drawEnemy(r, enemy, alpha, this.time, palette);
    }

    this.projectiles.render(r);

    if (this.mode !== GameMode.TITLE) {
      drawPlayer(r, this.player, alpha, this.time);
    }

    this.particles.render(r);

    if (this.ctx.debug) {
      this.combat.debugRender(r);
      this._renderDebugCollision(r, map);
    }

    r.endWorld();

    // Lighting and post-processing apply to the world only.
    r.applyLighting();
    r.applyPostFX(frameDt);

    // Room-transition fade, drawn over the world but under the HUD so the
    // interface never blinks out during a doorway.
    if (this.world.fadeAmount > 0) {
      r.g.globalAlpha = this.world.fadeAmount;
      r.g.fillStyle = '#000000';
      r.g.fillRect(0, 0, r.width, r.height);
      r.g.globalAlpha = 1;
    }

    // UI in screen space, crisp.
    if (this.mode === GameMode.MAP) {
      this.mapSystem.renderScreen(r);
    } else {
      this.hud.render(r, this.player, this.world.boss, this.world);
    }

    this.dialogue.render(r);
    this._renderInscription(r);

    if (this.mode === GameMode.PAUSED) this._renderPauseScreen(r);
    if (this.mode === GameMode.DEAD) this._renderDeathScreen(r);
    if (this.ctx.debug) this._renderDebugOverlay(r);

    r.present();
  }

  /**
   * @param {import('../engine/render/renderer.js').Renderer} r
   * @param {any} map
   * @private
   */
  _renderDebugCollision(r, map) {
    const b = this.player.body.box;
    r.strokeRect(b.x, b.y, b.w, b.h, 'rgba(120,255,180,0.7)', 1);
    for (const enemy of this.world.enemies) {
      const eb = enemy.body.box;
      r.strokeRect(eb.x, eb.y, eb.w, eb.h, 'rgba(255,160,160,0.5)', 1);
    }
  }

  /**
   * @param {import('../engine/render/renderer.js').Renderer} r
   * @private
   */
  _renderDebugOverlay(r) {
    const stats = this.loop.getStats();
    const lines = [
      `fps ${stats.fps.toFixed(0)}  upd ${stats.updateMs.toFixed(2)}ms  rnd ${stats.renderMs.toFixed(2)}ms`,
      `draws ${r.drawCalls}  particles ${this.particles.alive}  proj ${this.projectiles.active.length}`,
      `room ${this.world.room?.id ?? '-'}  enemies ${this.world.enemies.length}`,
      `state ${this.player.machine.currentName}  vel ${this.player.body.velocity.toString()}`,
      `grounded ${this.player.body.grounded}  coyote ${this.player.coyoteTimer.toFixed(2)}`,
    ];
    if (this.world.boss) {
      lines.push(`boss ${this.world.boss.phase.name} / ${this.world.boss.currentPatternName}`);
    }
    r.g.fillStyle = 'rgba(0,0,0,0.55)';
    r.g.fillRect(0, r.height - lines.length * 8 - 4, 250, lines.length * 8 + 4);
    lines.forEach((line, i) => {
      r.text(line, 4, r.height - lines.length * 8 - 1 + i * 8, { color: '#9fe8a0', size: 7 });
    });
  }

  /**
   * The inscription reading panel. Rendered here rather than inside the
   * interaction system so that all screen-space UI is drawn in one place, in a
   * known order.
   * @param {import('../engine/render/renderer.js').Renderer} r
   * @private
   */
  _renderInscription(r) {
    const entry = this.interaction.activeInscription;
    if (!entry) return;
    const g = r.g;
    const w = r.width - 60;
    const x = 30;
    const h = 100;
    const y = (r.height - h) / 2;

    g.fillStyle = 'rgba(6,8,12,0.94)';
    g.fillRect(x, y, w, h);
    g.strokeStyle = withAlphaLocal(r.palette.accent, 0.55);
    g.lineWidth = 1;
    g.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);

    r.text(`— ${entry.author} —`, r.width / 2, y + 9, {
      color: withAlphaLocal(r.palette.accent, 0.75), size: 6, align: 'center',
    });

    const lines = wrapText(r, entry.text, w - 24, 7);
    lines.slice(0, 7).forEach((line, i) => {
      r.text(line, x + 12, y + 24 + i * 10, { color: '#e8e0d0', size: 7 });
    });

    if (entry.deeper && this.player.readsDeeply) {
      r.text(entry.deeper, x + 12, y + h - 20, {
        color: withAlphaLocal('#8fd0ff', 0.8), size: 6,
      });
    }

    r.text('E to close', r.width / 2, y + h - 10, {
      color: 'rgba(244,234,214,0.4)', size: 6, align: 'center',
    });
  }

  /**
   * @param {import('../engine/render/renderer.js').Renderer} r
   * @private
   */
  _renderPauseScreen(r) {
    r.g.fillStyle = 'rgba(6,8,12,0.78)';
    r.g.fillRect(0, 0, r.width, r.height);

    r.text('PAUSED', r.width / 2, 44, {
      color: '#f4ead6', size: 14, align: 'center', letterSpacing: 3,
    });

    const s = this.player.stats;
    const mins = Math.floor(s.timePlayed / 60);
    const secs = Math.floor(s.timePlayed % 60);
    const lines = [
      ['Region', this.world.room ? getBiome(this.world.room.biome).name : '—'],
      ['Time', `${mins}:${String(secs).padStart(2, '0')}`],
      ['Glyphs', `${this.player.glyphs}`],
      ['Felled', `${s.enemiesFelled}`],
      ['Deaths', `${s.deaths}`],
      ['Transcribed', `${s.inscriptionsRead}`],
      ['Secrets', `${s.secretsFound}`],
      ['Abilities', `${this.player.abilities.count()}`],
    ];
    lines.forEach(([k, v], i) => {
      const y = 74 + i * 12;
      r.text(k, r.width / 2 - 70, y, { color: 'rgba(244,234,214,0.6)', size: 7 });
      r.text(String(v), r.width / 2 + 70, y, { color: '#f4ead6', size: 7, align: 'right' });
    });

    r.text('ESC resume    M map    save is automatic at Wellsprings', r.width / 2, r.height - 22, {
      color: 'rgba(244,234,214,0.45)', size: 6, align: 'center',
    });
  }

  /**
   * @param {import('../engine/render/renderer.js').Renderer} r
   * @private
   */
  _renderDeathScreen(r) {
    const a = clamp(this.deathTimer / 1.4, 0, 1);
    r.g.fillStyle = `rgba(4,4,6,${a * 0.85})`;
    r.g.fillRect(0, 0, r.width, r.height);
    r.text('THE INK SPILLS', r.width / 2, r.height / 2 - 8, {
      color: '#c8b0b0', size: 13, align: 'center', alpha: a, letterSpacing: 2,
    });
    r.text('and the record goes on without you', r.width / 2, r.height / 2 + 10, {
      color: 'rgba(200,176,176,0.6)', size: 7, align: 'center', alpha: a,
    });
  }

  // ==========================================================================
  // Save / load
  // ==========================================================================

  /**
   * @param {number} slot
   * @returns {boolean}
   */
  saveGame(slot = 0) {
    const biome = this.world.room ? getBiome(this.world.room.biome) : null;
    return this.saves.save(slot, {
      player: this.player.toJSON(),
      world: this.world.toJSON(),
      progression: this.progression.toJSON(),
      checkpoint: { room: this.checkpointRoom, pos: this.checkpointPos },
      meta: {
        roomName: this.world.room?.name ?? '',
        biome: biome?.name ?? '',
        completion: this.progression.completionPercent(),
      },
    });
  }

  /**
   * @param {number} slot
   * @returns {boolean}
   */
  loadGame(slot = 0) {
    const data = this.saves.load(slot);
    if (!data) return false;
    this.player.load(data.player);
    this.world.load(data.world);
    this.progression.load(data.progression);
    this.checkpointRoom = data.checkpoint?.room ?? this.startRoom;
    this.checkpointPos = data.checkpoint?.pos ?? null;
    this.world.loadRoom(this.checkpointRoom, this.checkpointPos ?? undefined);
    this.bus.emit(Events.GAME_LOADED, { slot });
    return true;
  }
}
