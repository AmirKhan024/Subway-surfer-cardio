# Build prompt — Head / Neck-ROM control mode (paste into Claude Code)

You're extending the standalone **Kriya Runner L1** (at `subwaySurfer_kriya`). Add a **third control scheme** alongside `keyboard` and `pose(body)`:

- **Neck extension (look up) → JUMP** (clears hurdles)
- **Neck flexion (look down) → SQUAT** (slides under beams)

This makes the runner a **neck ROM** exercise — the same movement as the **Neck Compass** ROM game — so it should map to the **ROM** category, not Mobility. Full design is in `kriya-runner-head-control-SPEC.md` (read it first).

The good news: the engine already converts two abstract signals — a `drop` (→ `crouch`) and an upward `velocity + rise` (→ `triggerJump()`) — into everything downstream. Body mode derives them from the **hips**; head mode derives the **same two signals** from **head-vs-shoulders**. So you're adding a signal source, not rebuilding the game.

## Do this first (don't skip)
1. Read `kriya-runner-head-control-SPEC.md`.
2. **Open the Neck Compass / ROM-neck game in the kriya-v3 clone** (`…/scratchpad/kriya-v3-latest`) and reuse its neck-pitch computation and calibrated comfortable ranges. That keeps this clinically consistent and saves you tuning from scratch. Only fall back to the SPEC's math if you can't find it.
3. Re-read `runner-engine.ts` `updatePoseSignals()`, `calibrateFrame()`, `fullBodyVisible()`, `getRawData()`; `runner-constants.ts`; and `runner-layer.tsx`'s camera-boot effect + calibration overlay — those are the seams you'll touch.

## Non-negotiables
- Reuse the existing squat/jump FSMs, gates, cue, camera-feel, and metric accumulators — **do not fork** them. Head mode only swaps the signal source.
- Head mode is a **camera mode** (calibrates like `pose`), not instant like keyboard.
- Keep the `getRawData()` **all-finite** invariant (numbers only except `testId`).
- **Safety:** clean ROM thresholds must sit inside a *comfortable, sub-maximal* neck range — never reward end-range forcing. Add the "move gently, don't force your neck, stop if pain/dizziness" copy. Keep the disclaimer.
- Additive; don't break keyboard or body mode or their tests.

## Implementation outline (adapt to repo reality; `// NOTE:` deviations)
- `ControlMode = 'pose' | 'keyboard' | 'head'`.
- Extract `computeControlSignal(landmarks) → { drop, riseRaw, velKPerS }` in the engine: hips for `'pose'`, neck for `'head'` (nose-vs-shoulderMid normalized by `shoulderW0`, minus the calibrated `neckNeutral`; look-down = `drop`, look-up = `rise`+velocity). Everything after stays shared.
- Add a `HEAD` constants block (start from the SPEC values; the real tuning happens on webcam).
- Calibration: add `headVisible()` (nose + both shoulders only — **no ankles**, so it works seated); capture `neckNeutral`. Head-mode calibration copy = "Sit tall, look straight ahead, hold still."
- `runner-layer.tsx`: camera boots for `head` too (`if (controlMode === 'keyboard') return;` + an `isCameraMode` helper); show `TrackingPip` for head; `controlLabel` gains `'Head'`.
- `start-screen.tsx`: third CTA "Head / neck control"; widen the `onPlay` mode union; add the neck-safety line.
- `raw-data.ts`: add `controlScheme: 0|1|2`; recommend `testId: 'KR1' | 'KR1N'` with `getTestCategory('KR1N') → 'rom'` (verify no collision). Optionally add `avgNeckFlexion` / `avgNeckExtension`.
- `report-screen.tsx`: head runs show ROM/Neck framing (flexion range + extension range) instead of squat depth / jump height; musculage still via the local mirror.
- `kr1-local.ts`: head runs score through the same X/Y pipeline; `cleanFormRate` = fraction reaching the `HEAD.*_CLEAN` comfortable ranges.
- Cue relabel to "LOOK UP" / "LOOK DOWN" in head mode (keep colors + timing bar).

## Tests to add (headless — the whole engine is bot-testable)
- Neck-flexion produces a squat rep; neck-extension triggers a jump + re-arms only after return-to-neutral.
- Calibration locks with nose+shoulders visible and **no ankles**; rejects when the head isn't visible.
- **Keyboard/head parity** where applicable (synthetic signals → same reps/gates).
- `getRawData()` all-finite invariant holds for a head-mode run; `controlScheme === 2`.
- If you add `KR1N`: `getTestCategory('KR1N') === 'rom'` and the scoring case exists.

## Milestone & verification
Do it as one focused milestone: `tsc --noEmit` clean + `vitest run` green + a manual keyboard-parity/headless check, then commit & push (`feat: head/neck-ROM control mode`). Real webcam neck tuning needs Amir's physical test — expose the neck bars in the `?debug=1` overlay and flag that tuning honestly.

## Report back
- Whether you found and reused the Neck Compass neck computation (and which values).
- Your final signal choice (offset vs angle/degrees) and the tuned `HEAD` thresholds you started from.
- testId/category decision (`KR1N`→rom vs controlScheme-derived).
- Confirmation the clean ROM thresholds are comfortable/sub-maximal (safety).

> Treat all thresholds as starting values to tune on a real webcam. If the Neck Compass or your own testing suggests better, use it and leave a `// NOTE:`.
