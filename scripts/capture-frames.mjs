/**
 * Dev-only frame + perf capture. Never imported by app code.
 *
 *   node scripts/capture-frames.mjs before
 *   node scripts/capture-frames.mjs after
 *
 * Boots `next dev`, drives the game through `?debug&kbd=1&sec=90` (the
 * keyboard test path — no camera, no calibration), screenshots one frame per
 * act plus the HUD preview panels, and scrapes every FRAME_STATS line the
 * layer logs into a JSON summary.
 *
 * WHAT THIS PROVES: the art, and the frame budget on this machine.
 * WHAT IT DOES NOT PROVE: detection, calibration or feel — keyboard mode has
 * no key listener, so the runner never acts. Real play needs a webcam.
 */
import { spawn, spawnSync } from 'node:child_process';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

const LABEL = process.argv[2] ?? 'run';
/** --hud skips the 90s run and captures only the HUD chrome panels */
const HUD_ONLY = process.argv.includes('--hud');
/** --home skips everything else and captures the landing page on two phones */
const HOME_ONLY = process.argv.includes('--home');
const OUT = path.resolve('.capture', LABEL);
const PORT = 3311;
const ORIGIN = `http://127.0.0.1:${PORT}`;
const SESSION_SEC = 90;

/** where in the 90s run to grab each frame, and what it is evidence for */
const SHOTS = [
  { at: 14, name: '01-act1-kaho', why: 'dark act — silhouette form, mist depth' },
  { at: 38, name: '02-act2-crossing', why: 'the footbridge railing' },
  { at: 58, name: '03-act2-late', why: 'railing + planted trail marker' },
  { at: 74, name: '04-act3-saffron', why: 'coin scale, chip contrast' },
  { at: 86, name: '05-act3-gold', why: 'gold finale — legibility + coin scale' },
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForServer(url, timeoutMs = 180_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      /* not up yet */
    }
    await sleep(700);
  }
  throw new Error(`dev server never came up at ${url}`);
}

async function main() {
  await rm(OUT, { recursive: true, force: true });
  await mkdir(OUT, { recursive: true });

  const dev = spawn('npx', ['next', 'dev', '-p', String(PORT)], {
    stdio: 'ignore',
    shell: process.platform === 'win32',
  });

  const browser = await chromium.launch({
    args: ['--use-gl=angle', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
  });

  try {
    await waitForServer(ORIGIN);

    const page = await browser.newPage({
      viewport: { width: 430, height: 860 }, // a phone, the target device
      deviceScaleFactor: 2,
    });

    const frameStats = [];
    // a scene throw shows up as "canvas never appeared" three steps later —
    // surface it where it happens
    page.on('pageerror', (e) => process.stdout.write(`  PAGE ERROR: ${e.message}\n`));
    page.on('console', (msg) => {
      if (msg.type() === 'error') process.stdout.write(`  console.error: ${msg.text()}\n`);
      const t = msg.text();
      if (!t.includes('FRAME_STATS')) return;
      const m = t.match(/\{.*\}/s);
      if (m) {
        try {
          frameStats.push(JSON.parse(m[0].replace(/(\w+):/g, '"$1":').replace(/'/g, '"')));
          return;
        } catch {
          /* fall through to the raw line */
        }
      }
      frameStats.push({ raw: t });
    });

    // ---- the landing page ---------------------------------------------
    // two viewports on purpose: 430 is the design target, 360x640 is the
    // smallest phone the layout has to survive — the hero must not push the
    // mode cards off the bottom there.
    if (HOME_ONLY) {
      for (const vp of [
        { w: 430, h: 860, name: '00-home-430' },
        { w: 360, h: 640, name: '00-home-360' },
      ]) {
        const home = await browser.newPage({
          viewport: { width: vp.w, height: vp.h },
          deviceScaleFactor: 2,
        });
        home.on('pageerror', (e) => process.stdout.write(`  PAGE ERROR: ${e.message}\n`));
        // which candidate actually served — proves the webp is being used
        home.on('response', (r) => {
          if (r.url().includes('hero-soldier')) {
            process.stdout.write(`  served ${r.url().split('/').pop()} → ${r.status()}\n`);
          }
        });
        await home.goto(ORIGIN, { waitUntil: 'networkidle' });
        await home.waitForTimeout(600);
        await home.screenshot({ path: path.join(OUT, `${vp.name}.png`) });
        process.stdout.write(`  ${vp.name}\n`);
        await home.close();
      }
    }

    // ---- the live run -------------------------------------------------
    if (!HUD_ONLY && !HOME_ONLY) {
      await page.goto(`${ORIGIN}/?debug=1&kbd=1&sec=${SESSION_SEC}`, {
        waitUntil: 'domcontentloaded',
      });
      // `next dev` compiles lazily, and the first hit can land mid-build and
      // 404 its own chunks — one reload after the compile settles fixes it
      try {
        await page.waitForSelector('canvas', { timeout: 45_000 });
      } catch {
        process.stdout.write('  first load raced the dev compile — reloading\n');
        await page.reload({ waitUntil: 'domcontentloaded' });
        await page.waitForSelector('canvas', { timeout: 60_000 });
      }

      const t0 = Date.now();
      for (const shot of SHOTS) {
        const wait = shot.at * 1000 - (Date.now() - t0);
        if (wait > 0) await sleep(wait);
        await page.screenshot({ path: path.join(OUT, `${shot.name}.png`) });
        process.stdout.write(`  ${shot.name}  (${shot.why})\n`);
      }
      // let the last FRAME_STATS window close out
      await sleep(6000);
    }

    // ---- HUD chrome panels --------------------------------------------
    // phone-width viewport: the cluster's 38vw wrap and the sm: breakpoint are
    // viewport-driven, so a wide window would show a layout no player sees
    if (HOME_ONLY) return;
    const hud = await browser.newPage({ viewport: { width: 430, height: 900 }, deviceScaleFactor: 2 });
    await hud.goto(`${ORIGIN}/dev/hud`, { waitUntil: 'networkidle' });
    await hud.waitForTimeout(800);
    await hud.screenshot({ path: path.join(OUT, '06-hud-panels.png'), fullPage: true });
    // close-up of the top-left cluster on the dark act and on gold
    for (const [i, sel] of ['Act I', 'Act III · GOLD'].entries()) {
      const el = hud.locator(`[data-hud-panel^="${sel}"]`).first();
      await el.screenshot({
        path: path.join(OUT, `0${7 + i}-hud-closeup-${i === 0 ? 'dark' : 'gold'}.png`),
      });
    }
    process.stdout.write('  06-hud-panels / 07-08 close-ups\n');

    await writeFile(
      path.join(OUT, 'frame-stats.json'),
      JSON.stringify({ label: LABEL, sessionSec: SESSION_SEC, frameStats }, null, 2),
    );
    const fps = frameStats.map((f) => f.fps).filter((n) => typeof n === 'number');
    process.stdout.write(
      `\nFRAME_STATS windows: ${frameStats.length}` +
        (fps.length ? `  fps: ${fps.join(', ')}  (min ${Math.min(...fps)})\n` : '\n'),
    );
    process.stdout.write(`artifacts → ${OUT}\n`);
  } finally {
    await browser.close();
    // `next dev` spawns a child that actually holds the port, so killing the
    // wrapper leaves it listening and the NEXT run can't bind. Kill the tree.
    if (process.platform === 'win32' && dev.pid) {
      spawnSync('taskkill', ['/PID', String(dev.pid), '/T', '/F'], { stdio: 'ignore' });
    } else {
      dev.kill();
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
