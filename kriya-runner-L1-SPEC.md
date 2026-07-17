# Kriya Runner — Level 1 Build Spec

**Version:** 1.0 · **Owner:** Govind · **For:** Claude Code (vibe-coding session)
**Companion docs:** `kriya-runner-L1-REFERENCE.md`, `kriya-runner-L1-UI.md`
**Reference prototypes (behavioural source of truth):** `kriya-runner-fpp-v2.html` (latest), `kriya-runner-fpp-level1.html`

---

## 0. How to read this document

This is a **direction**, not a contract. It captures the intent, the math we've reasoned through, and the Kriya wiring you must respect — but it is deliberately non-restrictive on implementation.

> ### 🧠 The "your call" rule (applies to the WHOLE document)
> Wherever you see thresholds, formulas, constants, data shapes, or code snippets, treat them as a **strong starting hypothesis**, not a mandate. If you can see a cleaner, faster, more robust, or more idiomatic way given the *actual* current state of the Kriya repo — **do it, and leave a short `// NOTE:` explaining why you deviated.** You are the engineer in the room. The only things that are genuinely non-negotiable are called out explicitly as **[HARD]**. Everything else is yours to improve.

**[HARD] constraints (do not deviate without flagging to Govind first):**
- Games live under `src/` only. HTML prototypes at repo root are off-limits as build targets — they are *reference*, not code to ship.
- The end-of-run report MUST flow through Kriya's existing scoring pipeline (`/api/score/compute` → `test_sessions` + `score_trends`) — see §9. No parallel/bespoke scoring path.
- Clinical scoring stays deterministic and clinician-authored. The LLM never decides a clinical score.
- Child-safety / medical disclaimers stay intact (§11).
- Additive-only DB changes (never drop/rename existing tables — v2 shares the DB).

---

## 1. What we're building & why

An **endless-runner game controlled by the player's whole body** instead of finger input. The camera watches the user; squatting slides them under barriers, jumping clears hurdles. Level 1 is the foundation.

**Why this belongs in Kriya (keep this framing in mind while building):**
- Kriya's existing games are 30-second *assessments* — precise but test-like. A runner is a **retention/engagement engine**: replayable, scored, streak-able. It's the "spinach in the brownie."
- A runner naturally elicits reps of clinically meaningful movement. Level 1's squat → **Mobility/Strength** signal; jump → **Power**; obstacle timing → **Reflex**. So one game quietly generates multi-category assessment data.
- Strategic payoff: an engagement loop that *also* feeds the assessment battery and Kriya360 composite.

> **🧠 Your call, Claude Code:** if while building you find a framing that markets/measures this better, surface it. This section is the "north star," not a spec to code against.

---

## 2. Locked design decisions (with rationale)

These came out of Govind's product decisions. Rationale is included so you can make consistent micro-decisions.

| Decision | Rationale |
|---|---|
| **First-person view (FPP) only.** No third-person avatar/skeleton in the world. | A flat 2D avatar composited into a 3D scene looked wrong (billboarding, scale mismatch). FPP removes the hardest asset entirely. |
| **Camera bobs with the body.** View dips on squat, rises on jump. | Turns the FPP camera itself into the "mirror" — proprioceptive feedback with no avatar. **Drive camera-Y continuously from detected hip height, not from a scripted animation.** |
| **Level-wise progression.** L1 = jump + squat only. | Isolates the two vertical detections (the clinically richest moves) before adding lateral/balance in L2. De-risks the CV work. |
| **Single lane in L1** (center lane). Three-lane structure exists in code but unused. | No lean/steer detection needed yet. FPP in the center lane reads best. |
| **On-screen icon cue + timing indicator** for upcoming obstacles. | Movement is slow (~0.8–1.2s per rep) vs a finger swipe. Telegraph ~1.5–2s ahead so the body has time to load. Pair icon with the approaching obstacle so the user learns *timing*, not just reaction. |
| **Low-impact toggle** (heel-raise instead of jump). | Kriya's audience skews older / MSK-affected. Jump is the higher-impact move. |
| **Corner tracking thumbnail (PiP).** Small raw-camera view + "STEP BACK" state. | Camera-bob doesn't tell the user when tracking is lost. This is the only self-view; it's not the rejected 2D-avatar. |
| **Procedural / CC0 art.** | Keeps it a single shippable unit and license-clean. Flat-shaded low-poly is the correct Subway-Surfers aesthetic anyway. |

> **🧠 Your call, Claude Code:** the *implementation* of each of these is open. E.g. how exactly you damp the camera bob, how you structure the cue component, whether the PiP is a `<canvas>` or a video element — your judgment.

---

## 3. Level 1 scope & non-goals

**In scope (L1):**
- FPP tunnel: sky, scrolling ground, city corridor, roadside props.
- Two obstacle types: **jump-over hurdle**, **squat-under beam**.
- Center lane locked. Coins optional (nice-to-have for feel).
- Calibration → play → end.
- Hip-driven camera bob, icon+timing cue, low-impact toggle, tracking PiP.
- End-of-run metrics → Kriya scoring pipeline (§9).

**Explicit non-goals (defer to L2+):**
- Lane changing / lean-steer / balance detection.
- Reach/coin-grab reflex mechanic requiring arm targets.
- Multiplayer, cosmetics, power-ups.
- Real GLTF models (procedural is fine for L1; leave a clean seam — see UI doc).

> **🧠 Your call, Claude Code:** if a "non-goal" turns out trivial to include cleanly and it improves feel, you may — but don't let scope creep block a shippable L1. Prefer shipping L1 solid.

---

## 4. Game architecture

### 4.1 Fit into the existing game shell
Kriya games implement a **GameEngine**-style interface and run their **calibration internally** (Ninja has no separate calibration shell — each game calibrates itself). Match whatever the current interface in the repo actually is. As of this writing it is roughly:

```ts
interface GameEngine {
  reset(): void;
  processCalibration(landmarks: NormalizedLandmark[]): CalibrationState;
  processFrame(landmarks: NormalizedLandmark[], dt: number): void;
  render(ctx /* or three renderer */): void;
  getRawData(): RawGameData;   // called on game end
  isComplete(): boolean;
}
```

> **🧠 Your call, Claude Code:** **Read the real GameEngine interface in the repo — that is the source of truth, not this snippet.** My interface may be stale. Conform to the current one; if the runner needs a capability the interface lacks (e.g. an endless `playing` phase that ends on collision rather than a fixed timer), extend the shell minimally and note it.

### 4.2 Loop decoupling (critical for latency)
- **Game loop** runs on a fixed timestep (e.g. 1/60) and *samples* the latest available pose state. It NEVER blocks on inference.
- **Pose inference** runs ~30fps, ideally in a Web Worker.
- **Render** at 60fps via `requestAnimationFrame`.

```
[camera frame] → [worker: MediaPipe infer @30fps] → posts landmarks
                                                     ↓ (latest sampled)
[rAF 60fps] → update(dt) reads latest pose → render()
```

> **🧠 Your call, Claude Code:** worker vs main-thread inference, and whether the render is Three.js (prototype uses it) or something lighter — your judgment based on measured performance. Three.js FPP is proven in the prototype; keep it unless you have a better call.

---

## 5. Pose detection & calibration

Kriya's stack: **MediaPipe Pose / BlazePose (33 landmarks)**, MoveNet as fallback, EMA smoothing (~α 0.3), mirrored x for front camera. See REFERENCE doc for the landmark index table.

### 5.1 Calibration (per-session, runs inside the game)
Capture a standing baseline so thresholds are height- and distance-invariant:
- `hipY0` = baseline mean of `(lm[23].y + lm[24].y)/2` while standing still.
- `shoulderW0` = `|lm[11].x − lm[12].x|` (used to normalize thresholds for camera distance).
- Require full body in frame (ankles `lm[27]/lm[28]` + nose `lm[0]` visible) before accepting.
- Hold ~1.5s (≈60 frames) of stable "full body visible" to lock baseline.

### 5.2 The detection principle (low latency)
**Do not wait to classify the whole movement — detect *initiation* and commit.** Threshold/velocity crossings on a single landmark are ~1 frame of latency; full-pose classification is far slower.

All thresholds below are **normalized by `shoulderW0`** so they hold across users/distances. `k = shoulderW0`.

**Squat (hold-based):**
```
drop = (hipY_now − hipY0) / k        // hips move DOWN => y increases
crouch = clamp01((drop − 0.15) / 0.35)   // starts engaging past ~0.15, full by ~0.50
isSquatting = crouch > 0.55
```

**Jump (velocity-triggered on takeoff):**
```
hipVel = hipY_now − hipY_prev         // negative = moving up
rise   = (hipY0 − hipY_now) / k
if (hipVel < −0.02 && rise > 0.18) triggerJump()   // fire on takeoff, not apex
```
Add **hysteresis + a return-to-neutral gate**: don't allow a second jump/squat rep until hips return near baseline. This kills double-triggers AND enforces a full, clean rep (better exercise + better data).

### 5.3 Hip-bob camera mapping (feedback)
```
cameraTargetY = EYE − 0.75*crouch + jumpY      // dip on squat, rise on jump
camera.y += (cameraTargetY − camera.y) * min(1, dt*18)   // EMA damp → no motion sickness
cameraPitch → slight look-down proportional to crouch (≈0.12*crouch)
```
Keep amplitude modest and damped; expose a sensitivity/off setting.

> **🧠 Your call, Claude Code:** these constants (0.15, 0.35, 0.02, 0.18, damping 18, pitch 0.12) are **hand-tuned guesses from the prototype.** Re-tune against real device testing. If a different signal is more robust (e.g. knee-angle from `lm[25/26]` for squat depth, or ankle-Y for jump), evaluate it and pick the better one. You are explicitly authorized to replace the detection math if yours tests better — just document the final thresholds.

---

## 6. Level design & obstacle system

### 6.1 Fixed-length course (recommendation) vs pure endless
For **assessment validity**, sessions should be comparable. A pure endless run produces variable-length, hard-to-compare data. **Recommend L1 be a fixed course** — e.g. a set number of obstacles (~18–22) or a fixed distance/time — with a defined end. This yields stable metrics (obstacles cleared out of N, form averages over a known count).

> **🧠 Your call, Claude Code:** fixed-course vs endless-with-cap is a real design fork with scoring implications (§9). Pick based on what makes the metrics cleanest and the game fun. If you go endless, define how you normalize metrics into comparable bands. Flag your choice clearly for Govind.

### 6.2 Pacing (movement-paced, NOT reaction-paced)
- Telegraph each obstacle ~1.5–2s before the action point.
- Generous spacing so a full squat/jump rep can complete before the next.
- Difficulty ramps gently (speed + spacing), but never faster than a human can cleanly execute a rep.

### 6.3 Obstacle types (L1)
| Type | Player action | Detection gate at the action plane |
|---|---|---|
| **Hurdle** (low, on ground) | Jump | cleared if `jumpY > ~0.35` at crossing |
| **Beam** (overhead, gap beneath) | Squat | cleared if `crouch > ~0.55` at crossing |

Colour-code + label the cue (see UI doc): jump = cyan, squat = amber. On a miss → run ends (or lose a life if you choose a lives model).

> **🧠 Your call, Claude Code:** collision model (instant-fail vs 3-lives), exact clearance thresholds, and whether "partial credit" is tracked for a *late but attempted* movement — all yours. Tracking "attempted but mistimed" is useful assessment signal; consider capturing it.

---

## 7. Metrics capture → RawGameData

Accumulate per-rep during play; assemble on end. **Proposed** shape for the new test (see §9 for the testId decision):

```ts
interface RunnerRawData {
  testId: 'KR1';              // Kriya Runner, Level 1  (see §9 — could also be a KS* id)
  distance: number;           // meters covered (engagement/endurance proxy)
  obstaclesTotal: number;     // for fixed course
  obstaclesCleared: number;   // cleared with correct movement
  obstaclesFailed: number;    // hit / mistimed
  squatReps: number;
  jumpReps: number;
  avgSquatDepth: number;      // 0..1, mean normalized hip drop over squat reps
  avgJumpHeight: number;      // 0..1, mean normalized peak hip rise over jump reps
  avgReactionMs: number;      // mean (cue-shown → movement-initiation) latency
  cleanFormRate: number;      // 0..1, fraction of reps meeting depth/height threshold
  elapsed: number;            // ms
}
```

**Every field is a finite number** except `testId` — this matters for the `customMetrics` Zod filter (§9, REFERENCE doc). Filter to finite numbers before submission.

> **🧠 Your call, Claude Code:** add/rename/drop fields to match what actually produces good clinical signal and what your band functions (§9) need. If `avgReactionMs` proves noisy, demote it. Keep the union in `src/types/raw-data.ts` consistent.

---

## 8. Performance budget

- Target: **30fps inference + 60fps render on mid-range Android**, alongside the 3D scene.
- Keep the 3D scene cheap: flat/Lambert materials, **no dynamic shadows**, object pooling, short fog distance, capped `pixelRatio` (≤2).
- Model tier by device: MediaPipe complexity 1 default; drop to lite / MoveNet Lightning on `hardwareConcurrency < 4`.
- Dead-reckon one frame ahead from landmark velocity to hide inference lag if needed.

> **🧠 Your call, Claude Code:** measure first. If the scene + inference blows the budget on a real phone, cut scene complexity before cutting inference quality (the game must feel responsive). You decide the exact knobs.

---

## 9. Kriya integration — the end-of-run report (the important part)

The run must end by flowing through Kriya's **existing** pipeline so the user gets a real report, musculage, trend, streak, and dashboard credit. **List of Kriya pieces to integrate (touch these):**

### 9.1 Data + types
1. **`src/types/raw-data.ts`** — add `RunnerRawData` to the `RawGameData` discriminated union.

### 9.2 Scoring (deterministic, clinician-authored)
2. **`src/server/scoring/bands.ts`** — add X/Y band functions. Starting hypothesis (fixed ~20-obstacle course):
   ```ts
   // PRIMARY (X, 70%): performance = obstacles cleared
   export function bandKR1X(cleared: number): number {
     if (cleared >= 18) return 4;
     if (cleared >= 15) return 3;
     if (cleared >= 11) return 2;
     if (cleared >= 7)  return 1;
     return 0;
   }
   // SECONDARY (Y, 30%): movement quality = clean-form rate (depth+height adequacy)
   export function bandKR1Y(cleanFormRate: number): number {
     if (cleanFormRate >= 0.90) return 4;
     if (cleanFormRate >= 0.75) return 3;
     if (cleanFormRate >= 0.60) return 2;
     if (cleanFormRate >= 0.40) return 1;
     return 0;
   }
   ```
3. **`src/server/scoring/compute.ts`** — add a `case 'KR1'` mapping X=obstaclesCleared, Y=cleanFormRate, matrix = `MATRIX_70_30`. Then the standard chain runs unchanged: `preCond → getAgeNormFactor(preCond, age) → conditioned → musculage = round(age / conditioned)`.
4. **`src/server/scoring/validators.ts`** — add plausibility maxima (e.g. `distance ≤ 3000`, `obstaclesCleared ≤ 100`, `squatReps ≤ 200`, `jumpReps ≤ 200`, depth/height ∈ [0,1], `elapsed ≤ 300000`). Plausibility failure ≠ error: still store, flag `plausible:false`.

### 9.3 Metadata + category mapping
5. **`src/lib/constants.ts`** — add `KR1` to `TEST_METADATA` (name: "Kriya Runner — Level 1", description, category) and to `TEST_IDS_BY_CATEGORY`. **Category decision:** primary = **mobility** (squat-dominant), so dashboard aggregation folds it under Mobility.
6. **`getCategoryForTest()`** — map `KR1 → 'mobility'`.

### 9.4 Client submission
7. **`src/hooks/useScore.ts`** — extend `transformRawDataToApiPayload()` to map `RunnerRawData` → the flat API schema, and **filter `customMetrics` to finite numbers only** (strings/bools/arrays cause Zod `validation_error`).
8. Game-end calls `submitScore('KR1', rawData)` exactly like existing games. Handle the **anonymous → login-wall → claim** flow the shell already implements (don't reinvent it).

### 9.5 Persistence + report (mostly automatic once above is wired)
- `/api/score/compute` writes `test_sessions` (rawData + scoreData JSONB) and `score_trends` (attemptNumber, conditionedScore, musculage, personalBest, deltaPct), logs `activity_logs`, updates the daily streak, invalidates dashboard cache.
- **[HARD gotcha]** Navigate to the report using **`sessionId`**, not `reportId`: `router.push('/app/report/' + result.sessionId)`. Using `reportId` → 404. This is the #1 new-game bug.

### 9.6 The clinical-noise caveat (important judgment call)
Runner metrics are **noisier** than the dedicated 30s calibrated assessments (full-body framing, motion blur, gross gating). So:
- It is safe to give the runner its **own conditioned score + musculage** for *its own* report card and for **activity/streak/engagement**.
- **Open question for clinician + Claude Code:** should `KR1` *update the formal Mobility category musculage* on the dashboard, or should it be surfaced as a distinct "Runner Fitness" score that feeds engagement/trend but is weighted lightly (or excluded) from the clinical category average? Defaulting to **"counts for engagement + its own card, but does NOT overwrite the calibrated Mobility musculage"** is the conservative, architecture-respecting choice.

> **🧠 Your call, Claude Code (and Govind/clinician):** decide the weighting. If you make `KR1` update the Mobility category, do it explicitly and document it. When in doubt, keep the calibrated assessment games as the source of clinical truth and let the runner drive engagement + its own progress card. Either way, it must still pass through `/api/score/compute` — that's [HARD].

> **🧠 Your call on testId:** I propose `KR1` (new prefix, clearest semantics). If reusing an existing prefix (e.g. a new `KS*` Mobility id) is cleaner for the current category-aggregation code, do that instead — just keep `getCategoryForTest`, `TEST_IDS_BY_CATEGORY`, and `TEST_METADATA` consistent.

---

## 10. Build sequence (suggested milestones)

1. **M1 — Feel:** port the FPP scene + keyboard controls + hip-bob + cue from `kriya-runner-fpp-v2.html` into a `src/` GameEngine. Prove the loop feels good.
2. **M2 — Pose:** wire MediaPipe, calibration, squat/jump detection with hysteresis. Tune on a real phone.
3. **M3 — Metrics:** accumulate `RunnerRawData` correctly; verify `getRawData()` on end.
4. **M4 — Scoring:** bands + compute case + validators + metadata; `submitScore('KR1', …)`; confirm a valid non-zero `conditionedScore` and a `score_trends` row.
5. **M5 — Report:** navigate via `sessionId`; report page renders musculage/delta/breakdown; streak + dashboard update.
6. **M6 — Polish/safety:** low-impact toggle, tracking PiP + "STEP BACK", disclaimer, perf pass.

> **🧠 Your call, Claude Code:** reorder or parallelize as you see fit. If you'd rather land scoring against a stubbed rawData before the CV is perfect, that's a smart de-risk.

---

## 11. Safety & accessibility (keep intact)

- Persistent disclaimer: **"Avoid if you have active pain. Consult a physician first."**
- **Low-impact mode** (heel-raise instead of jump) available from the start screen.
- Never push pace beyond clean-rep capability.
- Age-appropriate, friendly copy. No dark patterns to extend play.

---

## 12. Definition of done (L1)

- Runs at target fps on a mid-range Android with camera control.
- Squat/jump detected reliably post-calibration; hip-bob feels 1:1; cues give enough lead time.
- A completed run produces a valid `KR1` `test_sessions` + `score_trends` row via `/api/score/compute`, and the report page loads via `sessionId`.
- Streak + dashboard reflect the session per the chosen weighting.
- Low-impact toggle, tracking PiP, and disclaimer all present.
- `tsc --noEmit` clean; no changes to root HTML prototypes; DB changes additive with a generated migration.

> **🧠 Final note, Claude Code:** if any instruction here fights the *actual* repo reality, the repo wins — adapt and leave a note. Build the version a senior Kriya engineer would be proud of, not a literal transcription of this doc.
