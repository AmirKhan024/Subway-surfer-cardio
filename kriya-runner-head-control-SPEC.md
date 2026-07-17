# Kriya Runner — Head / Neck-ROM Control Mode (Spec)

**Adds a THIRD control scheme** to the existing `keyboard` + `pose(body)` modes:
- **Neck extension (look up) → JUMP**
- **Neck flexion (look down) → SQUAT**

Purpose: turn the runner into a **neck range-of-motion (ROM)** exercise, the same movement your **Neck Compass** ROM game targets — but wrapped in the runner loop. Look-up clears hurdles, look-down slides under beams. The FPP camera already dips/rises with the `crouch`/`jumpY` signals, so the view will naturally nod with the user's head.

> **🧠 Your call, Claude Code:** everything below is a starting design grounded in the actual repo. Where you find a cleaner signal or a better fit with the existing Neck Compass code, take it and leave a `// NOTE:`. Only the safety items are firm.

---

## 1. Why this reuses almost everything

The engine already turns two abstract signals — a `drop` (→ `crouch`, a *hold* signal) and an upward *velocity + rise* (→ `triggerJump()`) — into gates, reps, camera-feel, and metrics. Body mode derives those from the **hips**. Head mode derives the *same two signals* from the **head vs shoulders**. So the whole downstream pipeline (FSMs, gates, lives, cue, camera bob, metrics) is unchanged — you only add a new signal source.

**Best move first:** open the **Neck Compass / ROM-neck game in the kriya-v3 clone** and reuse its neck-pitch computation and calibrated comfortable ranges. That keeps this clinically consistent with the existing neck ROM test. The math below is the fallback if you can't find it.

---

## 2. Detection design (fallback math)

Landmarks available (from `src/modules/pose/landmarks.ts`): `NOSE(0)`, `LEFT_EAR(7)/RIGHT_EAR(8)`, `LEFT_SHOULDER(11)/RIGHT_SHOULDER(12)`.

```
noseY        = lm[NOSE].y
shoulderMidY = (lm[LEFT_SHOULDER].y + lm[RIGHT_SHOULDER].y) / 2
shoulderW    = |lm[LEFT_SHOULDER].x − lm[RIGHT_SHOULDER].x|      // = k, the distance normalizer (already used)

neckPitch    = (shoulderMidY − noseY) / k     // larger = head higher above shoulders
```
Capture `neckNeutral` (mean `neckPitch` while looking straight ahead) during calibration. Then:
```
neckDelta = neckPitch − neckNeutral           // + = looking UP (extension), − = looking DOWN (flexion)

flex = max(0, −neckDelta)   // look-down magnitude  → feeds the SQUAT path (as `drop`)
ext  = max(0, +neckDelta)   // look-up magnitude    → feeds the JUMP path (as `rise`)
```

- **Squat (hold):** `crouch = clamp01((flex − HEAD.FLEX_ENGAGE)/HEAD.FLEX_SPAN)`, then run the **existing** `stepSquatFsm(flexAsDrop, now)`. Beam clears at the existing `crouch > SQUAT_CLEAR`.
- **Jump (velocity):** trigger when the upward velocity of `neckDelta` exceeds `HEAD.EXT_VEL` **and** `ext > HEAD.EXT_RISE` → call the **existing** `triggerJump(now)`. Reuse the raw-window velocity trick already in `updatePoseSignals` (nose history instead of hip history, to avoid EMA takeoff lag).
- **Re-arm:** return-to-neutral when `|neckDelta| < HEAD.NEUTRAL_BAND` (same hysteresis pattern).

Neck displacements normalized by shoulder width are **smaller** than hip displacements, so head mode needs its **own** thresholds (don't reuse the hip `DETECT` values). Starting guesses to tune on a real webcam via `?debug=1`:

```ts
// runner-constants.ts — NEW block
export const HEAD = {
  FLEX_ENGAGE: 0.06,   // look-down starts engaging crouch
  FLEX_SPAN:   0.18,   // crouch reaches 1.0 at ENGAGE+SPAN
  FLEX_CLEAN:  0.16,   // flexion depth (k units) for a CLEAN look-down rep
  EXT_VEL:     1.2,    // upward neckDelta velocity (k/s) to trigger a jump
  EXT_RISE:    0.08,   // min extension (k units) with the velocity
  EXT_CLEAN:   0.14,   // extension height (k units) for a CLEAN look-up rep
  NEUTRAL_BAND: 0.04,  // |neckDelta| below this re-arms both FSMs
  EMA_ALPHA:   0.25,   // slight smoothing on neckPitch
} as const;
```

> **🧠 Your call:** ear-midpoint may track head pitch more stably than the nose; or an actual neck *angle* (vector shoulderMid→head vs vertical) may be a better ROM measure than a normalized offset. Front-camera can't see sagittal rotation perfectly — pick whatever the Neck Compass uses, or whatever tests cleanest, and record it in degrees if you can (clinically nicer than normalized units).

---

## 3. Exact integration seams (in THIS repo)

1. **`src/modules/game/engines/runner-engine.ts`**
   - `export type ControlMode = 'pose' | 'keyboard' | 'head';`
   - Refactor the signal extraction in `updatePoseSignals()` so the source is pluggable: a small `computeControlSignal(landmarks) → { drop, riseRaw, velKPerS }` that reads **hips** for `'pose'` and **neck** for `'head'`; the rest of `updatePoseSignals` (FSMs, drift guard, baseline adapt) stays shared. `'head'` is a camera mode → same calibration path as `'pose'`.
   - Calibration: add a `headVisible(landmarks)` check (needs **only** `NOSE` + both shoulders — **not** ankles) and use it when `controlMode === 'head'`. Capture `neckNeutral` in `calibrateFrame` for head mode. (This makes head mode work **seated** — an accessibility + clinical win.)
   - `reset()`: `'head'` is NOT instantly calibrated (unlike keyboard) — it calibrates like `'pose'`.
   - `getRawData()`: set `testId` and `controlScheme` (see §4); reuse `avgSquatDepth`←flexion depth, `avgJumpHeight`←extension height (or add explicit neck fields — your call).

2. **`src/components/games/runner/runner-constants.ts`** — add the `HEAD` block above.

3. **`src/components/games/runner/runner-layer.tsx`**
   - Camera-boot guard currently `if (controlMode !== 'pose') return;` → make it fire for head too, e.g. `if (controlMode === 'keyboard') return;` (add an `isCameraMode` helper).
   - Show `TrackingPip` for `'head'` as well as `'pose'`.
   - Calibration overlay copy: conditional — head mode says *"Sit tall, look straight ahead, hold still"* (not "full body / stand back").
   - `controlLabel`: `'Keys' | 'Body' | 'Head'`.

4. **`src/components/games/runner/start-screen.tsx`** — add a third CTA / control picker: **"Head / neck control"**. Update the `onPlay` mode union to include `'head'`. Add the neck-safety line (see §6).

5. **`src/app/page.tsx`** — `mode` is already `ControlMode`; just flows through. No structural change.

6. **`src/types/raw-data.ts`**
   - Add `controlScheme: 0 | 1 | 2` (0 keyboard, 1 body, 2 head). Keep `controlModeKeyboard` derivable for back-compat, or migrate — your call, but keep the all-finite invariant.
   - Consider `testId: 'KR1' | 'KR1N'` and branch `getTestCategory`: **`KR1N → 'rom'`** (neck ROM), `KR1 → 'mobility'`. (Check `KR1N` for collisions first — the plan verified KR1 is free.)
   - Optional explicit fields: `avgNeckFlexion`, `avgNeckExtension` (both finite) for a clearer report.

7. **`src/components/games/runner/report-screen.tsx`** — when the run is head mode, relabel: category **ROM / Neck**, and present *flexion range* (look-down) and *extension range* (look-up) instead of squat depth / jump height. Musculage still computes via the same local mirror.

8. **`src/lib/scoring/kr1-local.ts`** — head runs score through the **same** KR1 X/Y pipeline (obstaclesCleared 70% / cleanFormRate 30%). The only difference is `cleanFormRate` now reflects **neck ROM adequacy** (flexion/extension reached the `HEAD.*_CLEAN` ranges), and the category label is ROM. If you add `KR1N`, give it the same compute case.

9. **Tests** (`__tests__/runner-engine.test.ts`): add head-mode cases mirroring the body ones — neck-flexion squat rep, neck-extension jump trigger + re-arm, calibration locks on nose+shoulders only (no ankles), and **keyboard/head parity** (feed synthetic neck signals, assert reps/gates match). Keep the all-finite `getRawData` invariant test passing for head runs.

---

## 4. Metrics & category

- `controlScheme` distinguishes the three modes numerically (finite-invariant safe).
- Head mode's assessment signal is **neck ROM**, so it belongs to the **ROM** category, not Mobility. Recommend `testId: 'KR1N' → getTestCategory 'rom'`. (Standalone: this only affects the report label + README integration notes; in prod it routes to the ROM category aggregation.)
- `cleanFormRate` for head mode = fraction of reps that reached the **comfortable clean ROM** (`HEAD.FLEX_CLEAN` / `HEAD.EXT_CLEAN`), strictly above the clear gate — so Y still measures quality beyond merely clearing, consistent with the body-mode principle.

> **🧠 Your call:** `KR1` + `controlScheme`-derived category vs a distinct `KR1N` testId. Distinct testId is cleaner clinically (one test = one signal); deriving is fewer moving parts. Pick one, keep `getTestCategory` consistent, and `// NOTE:` it.

---

## 5. UI / UX

- **Cue relabel (recommended):** in head mode show **"LOOK UP"** (extension → jump) and **"LOOK DOWN"** (flexion → squat) instead of JUMP/SQUAT, keeping the cyan/amber colors and the timing bar.
- **Calibration:** seated-friendly, "look straight ahead" copy; ring behaves the same.
- **Camera bob:** unchanged — looking down dips the view, looking up raises it (the existing `crouch`/`jumpY` → camera mapping already does this). It'll feel like the head *is* the camera.
- **PiP:** show it (tracking-awareness matters just as much here).

---

## 6. Safety (firm — the neck is delicate)

- Add copy on START and/or a first-run tip: **"Move your head gently, only as far as is comfortable — never force your neck. Stop if you feel pain or dizziness."**
- Keep the persistent disclaimer.
- Set the CLEAN ranges to **comfortable, sub-maximal** neck movement — do NOT reward end-range cranking. The clean threshold should be reachable well within a healthy comfortable range so the game never incentivizes forcing.
- Consider a **reduced-range** sensitivity (smaller `FLEX_SPAN`/`EXT_RISE`) toggle for users with limited/ sensitive necks — reuse the existing bob-scale settings pattern.
- Keep pacing movement-paced (the existing cue window is fine; neck reps are quick, but the cue prevents panic-jerking).

> **🧠 Your call:** if the Neck Compass has established safe comfortable-range values, prefer those over my guesses — they're already clinician-reviewed.

---

## 7. Open decisions (recommend, don't stall)
1. **Signal:** nose-vs-shoulder offset (simple) vs ear-based vs true neck angle in degrees (clinically nicer). Prefer whatever Neck Compass uses.
2. **testId:** `KR1N`→rom vs `KR1`+controlScheme. Recommend `KR1N`.
3. **Explicit neck fields** vs reusing `avgSquatDepth`/`avgJumpHeight` slots.
4. **Seated-only calibration** for head mode (drop ankle requirement) — recommend yes.

Make a reasoned choice on each, implement it, `// NOTE:` it for Govind.
