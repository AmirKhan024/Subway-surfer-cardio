# Build prompt — Browser diagnostics & console logging (paste into Claude Code)

Add **structured console diagnostics** to the standalone Kriya Runner so that, when a run finishes and the report shows, the browser console (and a one-click copy button) contains everything needed to diagnose a bug. Workflow: Govind/Amir plays a run → opens DevTools console → copies the diagnostics → pastes into Claude Code to identify and fix issues. **Make that copy-paste give you the whole picture in one block.**

## Goals
- A single **end-of-run "KRIYA RUN REPORT"** dump that is comprehensive and self-contained (config + full raw data + scoring math + per-obstacle + per-rep + warnings). This is the primary artifact.
- A **rolling event log** of the important moments (phases, calibration, detection reps, obstacle resolves, tracking loss, drift, errors) so the sequence leading to a bug is visible.
- A **"Copy diagnostics" button on the report screen** so the user doesn't hand-scrape the console — one click copies a paste-ready text blob to the clipboard.
- **No performance hit:** never log inside the 60fps loop unconditionally — only on discrete events, or throttled, or behind `?debug=1`.

## 1. Add a tiny logger — `src/lib/debug/run-logger.ts`
- A ring buffer (cap ~500 entries) on `window.__KR_LOGS` plus `klog(tag: string, data?: unknown)` that pushes `{ t: performance.now(), tag, data }` and, when `?debug=1`, also `console.log`s it.
- `getDiagnosticsText()` → returns a formatted, paste-ready string (header + config + the RUN REPORT object + the event log). JSON-stringify with a replacer that rounds floats to keep it readable.
- Capture crashes into the same buffer: `window.addEventListener('error', …)` and `'unhandledrejection'`, and wrap `console.error` so engine/scene errors land in the log too.
- SSR-safe (`typeof window !== 'undefined'` guards); all logger code is client-only.

## 2. Instrument these events (low-volume, event-driven)
Emit `klog(...)` at:
- **Boot/camera/pose:** `BOOT`, `CAMERA_START/FAIL`, `POSE_INIT/FAIL` (in `runner-layer.tsx` pose-boot effect + `use-pose`/`use-camera`).
- **Phase transitions** (`runner-layer.tsx`): `PHASE calibrating→countdown→playing→done`.
- **Calibration** (`runner-engine.ts` `calibrateFrame`): `CALIB_START`, `CALIB_REJECT {reason}`, `CALIB_WOBBLE_RESET`, `CALIB_LOCK { hipY0, shoulderW0, neckNeutral? }`, `CALIB_TIMEOUT`.
- **Detection reps** (engine): on each finished squat/jump/heel/neck rep → `REP { kind, peak, clean, controlScheme }`. On jump trigger → `JUMP_TRIGGER { velKPerS, rise }`.
- **Obstacle resolve** (engine `resolveObstacle`): `OBSTACLE { id, type, cleared, crouchAtGate, jumpYAtGate, livesLeft }` — this is the money log for "why did I fail that one".
- **Tracking/drift** (engine/layer): `TRACKING_LOST` / `TRACKING_OK` (edge-triggered, not per-frame), `DRIFT_ON` / `DRIFT_OFF`.
- Keep per-frame signal logging **only** behind `?debug=1`, and even then throttle to ~5Hz.

> **🧠 Your call:** exact tag names/shape are yours — optimize for "a human pasting this can see the story." Don't log secrets (there are none here) and don't log every frame.

## 3. The end-of-run RUN REPORT (the important one)
When the run completes and the report is computed (in `page.tsx` `handleComplete`, or when `ReportScreen` mounts — wherever the score is available), emit one `console.log` group titled **`===== KRIYA RUN REPORT =====`** and store the same object in the buffer. It must include:

- **Config:** controlScheme (keyboard/body/head), lowImpact, seed, attempt, bobScale, age, gender, `?debug` on/off, app version, timestamp, userAgent, viewport size.
- **Full `RunnerRawData`** exactly as `getRawData()` returned it (all fields).
- **Scoring breakdown** from the local mirror — call the same `computeKR1Score()` path and log every intermediate: `xBand, yBand, preCond, ageCohort, preCondBand, ageFactor, conditioned, musculage`, plus `assessmentValid`. This is where a wrong musculage will be obvious on paste.
- **Per-obstacle table:** id, type, cleared/failed, crouch/jumpY at the gate (from the OBSTACLE logs).
- **Per-rep summary:** counts, avg/peak depth & height (or neck flexion/extension), cleanReps, cleanFormRate, avgReactionMs — and for head mode the neck ranges.
- **Run health warnings:** tracking-lost count, drift events, calibration retries, `assessmentValid===0` (low reps), any captured errors, min/avg FPS if you track it, and frames where landmarks were missing.

Log it with `console.log` (not only the buffer) so it's visible immediately, and use a `console.groupCollapsed`/`console.table` where it helps readability.

## 4. "Copy diagnostics" button (report screen)
- Add a small **"Copy diagnostics"** button to `report-screen.tsx` that calls `navigator.clipboard.writeText(getDiagnosticsText())` and shows a "Copied ✓" state.
- The copied blob = the RUN REPORT + the event log (last N entries) as readable text, ready to paste straight into Claude Code.
- Also fine to add a tiny "Copy diagnostics" affordance during play behind `?debug=1` for mid-run crashes.

## 5. Gating & hygiene
- **Always** emit the end-of-run RUN REPORT and the low-volume event logs (they're cheap and are the whole point).
- **Only** emit verbose per-frame/signal logs when `?debug=1`.
- Guard everything for SSR; keep the logger import out of any hot path allocation.
- Don't change game logic — this is observation only. If adding a log requires exposing an engine value, add a small getter rather than logging from inside the engine's tick where possible (keeps the engine pure); the engine may keep a lightweight internal event list that the layer drains and forwards to `klog`.

## Verify & report back
- `tsc --noEmit` clean, existing `vitest` green (no logic change).
- Manual: play a keyboard run → confirm the `KRIYA RUN REPORT` prints and the copy button yields a complete paste-ready blob; force a failed obstacle and confirm the OBSTACLE log shows the gate values; trigger tracking loss and confirm it's logged.
- Commit & push (`feat: browser diagnostics + copy-to-clipboard run report`).

> Optimize the output for one thing: when Govind pastes it here, Claude Code should be able to see the config, the exact numbers, the per-obstacle outcomes, and any errors — enough to pinpoint a bug without a screen recording. Shape the logs toward that.
