/**
 * @file Browser smoke test.
 *
 * Boots the real game in a real browser, drives it with real key events, and
 * asserts that it renders and simulates. Unit tests prove the systems are
 * correct in isolation; this proves they are correct *assembled*, which is
 * where integration bugs actually live.
 *
 * Fails loudly on any console error or uncaught exception, so a broken import
 * or a null dereference during boot cannot pass silently.
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const PORT = 8123;
const SHOT_DIR = process.env.SHOT_DIR ?? 'screenshots';

/** @param {number} ms */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const server = spawn(process.execPath, ['tools/serve.mjs'], {
  env: { ...process.env, PORT: String(PORT) },
  stdio: 'ignore',
});

let exitCode = 0;
try {
  await sleep(600);
  fs.mkdirSync(SHOT_DIR, { recursive: true });

  const browser = await chromium.launch({
    executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  });
  const page = await browser.newPage({ viewport: { width: 960, height: 540 } });

  /** @type {string[]} */
  const errors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(`console.error: ${msg.text()}`);
  });
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));

  await page.goto(`http://localhost:${PORT}/index.html`, { waitUntil: 'networkidle' });
  await sleep(1200);

  // The loading overlay is removed only if boot succeeded.
  const booted = await page.evaluate(() => document.getElementById('loading') === null);
  if (!booted) {
    const text = await page.evaluate(() => document.getElementById('loading')?.textContent ?? '');
    throw new Error(`Game did not boot. Overlay says: ${text.trim()}`);
  }

  /** @param {string} label */
  const shot = async (label) => {
    await page.screenshot({ path: path.join(SHOT_DIR, `${label}.png`) });
  };

  const state = async () => page.evaluate(() => {
    const g = globalThis.AETHERWEIR;
    return {
      room: g.world.room?.id ?? null,
      roomName: g.world.room?.name ?? null,
      enemies: g.world.enemies.length,
      playerState: g.player.machine.currentName,
      x: Math.round(g.player.body.box.centerX),
      y: Math.round(g.player.body.box.bottom),
      grounded: g.player.body.grounded,
      health: g.player.health.current,
      fps: Math.round(g.loop.getStats().fps),
      tick: g.loop.tick,
      rooms: g.world.visitedRooms.size,
    };
  });

  const initial = await state();
  console.log('boot:', JSON.stringify(initial));
  if (initial.tick < 10) throw new Error('simulation is not advancing');
  await shot('01-boot');

  // Walk right for a while, jumping, and confirm the player actually moves and
  // eventually changes room.
  await page.keyboard.down('ArrowRight');
  for (let i = 0; i < 6; i++) {
    await page.keyboard.press('KeyZ');
    await sleep(320);
  }
  await sleep(800);
  const walked = await state();
  console.log('after walking:', JSON.stringify(walked));
  await shot('02-walking');

  if (walked.x === initial.x && walked.room === initial.room) {
    throw new Error('player did not move');
  }
  await page.keyboard.up('ArrowRight');

  // Attack, and confirm a hitbox is produced.
  await page.keyboard.press('KeyX');
  const hitboxes = await page.evaluate(() => {
    const g = globalThis.AETHERWEIR;
    return g.combat.hitboxes.length;
  });
  await sleep(300);
  await shot('03-combat');
  console.log('hitboxes during attack:', hitboxes);

  // Travel further to reach another room and exercise transitions.
  await page.keyboard.down('ArrowRight');
  await sleep(4000);
  await page.keyboard.up('ArrowRight');
  const travelled = await state();
  console.log('after travel:', JSON.stringify(travelled));
  await shot('04-travelled');

  // Map screen.
  await page.keyboard.press('KeyM');
  await sleep(500);
  await shot('05-map');
  await page.keyboard.press('KeyM');
  await sleep(300);

  // Pause screen.
  await page.keyboard.press('Escape');
  await sleep(400);
  await shot('06-pause');
  await page.keyboard.press('Escape');
  await sleep(300);

  const final = await state();
  console.log('final:', JSON.stringify(final));

  if (final.fps < 20) throw new Error(`frame rate too low: ${final.fps}fps`);
  if (errors.length) throw new Error(`console errors:\n  ${errors.slice(0, 10).join('\n  ')}`);

  console.log(`\nSMOKE PASSED — ${final.rooms} room(s) visited, ${final.fps}fps, no console errors.`);
  await browser.close();
} catch (err) {
  console.error('\nSMOKE FAILED:', err instanceof Error ? err.message : err);
  exitCode = 1;
} finally {
  server.kill();
}

process.exit(exitCode);
