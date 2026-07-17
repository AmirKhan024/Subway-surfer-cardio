# Kriya Runner — Level 1

A **first-person, body-controlled endless runner** for Kriya.care: the webcam watches you — **squat to slide under the amber beams, jump to clear the cyan hurdles**. One run generates real assessment signal (squat → mobility, jump → power, timing → reflex) and ends in a Kriya-style **musculage** report computed by a local mirror of the production scoring pipeline.

**Standalone by design**: no DB, no auth, no API. Zip it, `npm i && npm run dev`, play.

## Run it

```bash
npm install
npm run dev        # http://localhost:3000
npm test           # 48 vitest tests (engine + scoring, headless)
npm run typecheck  # tsc --noEmit
npm run build
```

- **Body control** needs camera permission + internet on first run (MediaPipe WASM + `pose_landmarker_lite` load from CDN, then cache).
- **Head / neck control** (`KR1N`, ROM category): look **up** to jump, look **down** to duck — a neck-ROM exercise that works **seated** (calibration needs only head + shoulders). Extension→jump is a gentle **position** trigger (no velocity term — nothing rewards fast/jerky neck movement); "clean" is judged on raw neck excursion against comfortable sub-maximal targets. Recorded ranges are a **relative head-movement proxy** (nose-vs-shoulder, normalized), NOT goniometric cervical ROM. Prod's Neck Compass (FA3) measures yaw rotation, so this pitch signal is new; the torso-invariant nose-vs-ear candidate is shown in `?debug=1` for webcam comparison.
- **Keyboard mode**: `↑ / Space / W` jump · `↓ / S (hold)` squat — works offline, also the accessibility/dev path.
- **Diagnostics**: every finished run prints a `===== KRIYA RUN REPORT =====` console group (config, raw data, all scoring intermediates, per-obstacle gate values, health warnings), and the report screen's **"Copy diagnostics"** button copies a paste-ready blob — play, copy, paste to the developer.
- **Coins** (engagement only — provably never scored; a test pins identical musculage for any coin count): seeded ground lines in the obstacle gaps (kept clear of every action plane) + one aerial coin past each hurdle that only a real jump/look-up grabs. Spinning gold rings, collect-pop, HUD/game-over/report counters.
- **Audio** (100% license-free): all sound is **synthesized Web Audio** — no asset files, no attribution. SFX = short procedural blips (coin ping, jump sweep, squat tone, life thud, game-over sting, countdown); music = gentle synthesized ambient pad (Cmaj7→Am7→Fmaj7→G, low-pass filtered, slow fades). Sound toggle on Start, mute chip in-game, prefs persisted. Engine never imports audio (purity pinned by a test) — the layer maps drained engine events to SFX.
- **Game-over screen**: celebratory "Run Complete" / encouraging "Game Over" beat (distance, coins, cleared, hearts) between the run and the clinical report.
- **`?debug=1`** overlays live crouch/jump bars + gate lines for on-device threshold tuning.
- **Low-impact mode** replaces jumps with heel-raises. Camera-bob has Full/Gentle/Off (defaults to Gentle under `prefers-reduced-motion`).

## Architecture (mirrors production kriya-v3)

| Piece | File | Role |
|---|---|---|
| Game truth | `src/modules/game/engines/runner-engine.ts` | Pure TS `GameEngine` — detection FSMs, course, gates, 3 lives, metrics, camera-feel outputs. No DOM/three imports → fully headless-testable. |
| Course | `src/modules/game/engines/runner-timeline.ts` | Seeded, matched-difficulty 20-obstacle generator (10/10 mix, no triples, movement-paced gaps). |
| World | `src/components/games/runner/runner-scene.ts` | Three.js **dumb visualizer** — reads `getSceneState()`, never decides gameplay. Procedural city with `make*()` GLTF-swap seams. |
| Layer | `src/components/games/runner/runner-layer.tsx` | One game rAF (60fps) samples the latest pose landmarks; the pose loop (~30fps) only writes a ref. HUD React state at 10Hz. |
| Scoring | `src/lib/scoring/kr1-{matrices,local}.ts` | Verbatim prod matrices + the KR1 band fns / compute case. |
| Contract | `src/modules/game/engines/types.ts` | Copied verbatim from live kriya-v3. |

Keyboard and pose share **one code path**: keyboard ramps the same `crouch` signal and fires the same `triggerJump()` the pose FSMs do, so gates/reps/metrics are identical downstream — that's what makes the engine bot-testable.

### Detection (tunables in `runner-constants.ts`)
- Calibration: ~1.5s stable full-body hold → `hipY0` + `shoulderW0` (all thresholds normalized by shoulder width).
- Squat: EMA-smoothed hip drop → `crouch`; clears a beam at `crouch > 0.55`, **clean** at `≥ 0.75`.
- Jump: **raw-hip window-diff velocity** (EMA lag would miss takeoff) + rise gate → fires a game-space ballistic arc; clears a hurdle at `jumpY > 0.35`, clean at measured rise `≥ 0.50`.
- Hysteresis: both FSMs re-arm only after return-to-neutral (`|drop| < 0.08`).
- Drift guard: slow-adapting standing baseline (updates only while neutral) + sustained-scale-drift → **RECENTER** nudge on the PiP instead of silent misfires.

## Scoring — decision log (for Govind)

1. **Fixed 20-obstacle course** (comparable metrics) with **3 lives** (one mistimed rep shouldn't end an older/MSK user's run).
2. **Seed policy**: first run of a session = fixed assessment seed `1337`; "Run again" rotates a matched-difficulty pool → no course memorization inflating trends. Seed recorded in raw data.
3. **testId `KR1`**, category mobility, but surfaced as a separate **"Runner Fitness"** card — it must NOT be averaged into the calibrated Mobility musculage.
4. **X (70%) = obstaclesCleared** (`≥18/15/11/7` → bands 0-3), **Y (30%) = cleanFormRate** (`≥.90/.75/.60/.40`). Bands use **prod convention 0=best** (the SPEC draft was inverted vs the audited matrices). Lookup `MATRIX_70_30[y][x]`.
5. **Clean ≠ cleared**: clean thresholds sit strictly above the clear gates, so Y measures quality beyond clearing.
6. **Age-norm comparator is inclusive `>=`** (verified in the prod clone): preCond exactly 0.900 → factor band 0 → musculage 39 at age 35 (exclusive would drift it to 43).
7. **DNF rule**: `age × 3` fires only on zero meaningful activity (no reps AND no clears); a 3-lives DNF with real activity scores normally through the matrix.
8. **Saturation check**: skill-sweep bot histogram over 34 headless runs = `[12, 0, 2, 8, 12]` across xBands — 35% in band 0, no saturation. **Re-check against real-user telemetry post-launch**; if real runs cluster ≥18 cleared, widen X bands to `≥20/18/15/12`.
9. **Golden vectors** (cleared/cfr/age → musculage): 20/0.95/30→**30** · 20/0.95/65→**57** · 13/0.62/52→**62** · 6/0.30/25→**49** · 20/0.45/45→**47** · zero-run/40→**120**. All pinned in `kr1-local.test.ts`.
10. `avgReactionMs` is **not comparable across control modes** (keypress vs movement-initiation latency) — `controlModeKeyboard` flags it and the report labels it.
11. Conditioned can legally exceed 1.0 (older cohorts) — display caps at 100, musculage is the hero.

## Porting into production kriya-v3 (the integration seam)

The engine + scoring were built to drop in with minimal rework:

1. Copy `runner-engine.ts`, `runner-timeline.ts` → `src/modules/game/engines/`; add `case 'KR1'` to `createGameEngine()`.
2. Copy `components/games/runner/` (scene/layer/HUD/PiP). The runner needs a **bespoke playing layer** (precedent: balance/reflex) because the world is the main view and the camera is a PiP.
3. Move `bandKR1X/Y` → `src/server/scoring/bands.ts`; add the `case 'KR1'` from `kr1-local.ts` to `computeScore()` (`MATRIX_70_30`, x=obstaclesCleared, y=cleanFormRate); then **delete the local mirror** — score via `POST /api/score/compute` and navigate with **`sessionId`** (not `reportId`).
4. Register in all 6 places listed in `src/config/games/runner.config.ts` (`getCategoryForTestId` needs the `KR` prefix or it falls back to `balance`).
5. Add plausibility maxima (`getTestMaxValues`: hits n/a, `maxDuration ≈ 300`; cleared ≤ 20, reps ≤ 200).
6. **`three` is the one new dependency** (~150KB gzip; prod is otherwise Canvas-2D only).
7. Reuse the shell's anonymous → login-wall → claim flow as-is; keep the low-impact toggle + disclaimer.

## Honestly unverified (needs a human)

- **Real-webcam thresholds**: all detection values are prototype-derived and headless-verified; a physical webcam run (use `?debug=1`) is required to tune `SQUAT_*`/`JUMP_*`/drift bands on real bodies.
- **Mid-range phone perf**: Lambert-only/no-shadow/pooled scene + lite model should hold 30fps inference + 60fps render, but it is unmeasured on device.
- Three.js visuals verified via build + keyboard flow, not pixel-checked on every GPU.

## License

Prototype/internal. All art procedural (CC0-equivalent); swap in Kenney/Quaternius GLTFs via the `make*()` factories in `runner-scene.ts`.
