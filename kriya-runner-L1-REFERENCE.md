# Kriya Runner — Level 1 Reference

**Companion to:** `kriya-runner-L1-SPEC.md`, `kriya-runner-L1-UI.md`
Purpose: everything Claude Code needs *around* the spec — pose indices, thresholds, condensed Kriya architecture, gotchas, glossary — so it doesn't have to guess or re-derive.

> **🧠 Reminder:** everything here is reference material and starting values. Verify against the live repo; prefer the repo's reality over this doc where they disagree. Improve any number you can justify.

---

## 1. MediaPipe / BlazePose landmark index reference (33 pts)

Only the landmarks the runner needs are listed; full set is 0–32.

| Index | Landmark | Used for |
|---|---|---|
| 0  | Nose | full-body-in-frame check |
| 11 | Left shoulder | `shoulderW0` normalization, PiP skeleton |
| 12 | Right shoulder | `shoulderW0` normalization |
| 23 | Left hip | hip center (squat/jump signal) |
| 24 | Right hip | hip center |
| 25 | Left knee | (optional) knee-angle squat depth |
| 26 | Right knee | (optional) |
| 27 | Left ankle | full-body check; (optional) jump air-detection |
| 28 | Right ankle | full-body check |

- **Hip center:** `hipY = (lm[23].y + lm[24].y)/2`, `hipX = (lm[23].x + lm[24].x)/2`.
- **Shoulder width (distance normalizer):** `shoulderW = |lm[11].x − lm[12].x|`.
- Coordinates are normalized 0..1 in image space. Front camera is mirrored — flip x (`1 − x`) if you mirror the video, so "lean left" maps to screen-left (matters in L2, not L1).
- `landmark.visibility` (0..1) gates whether a point is reliable.

---

## 2. Detection threshold table (starting values — tune on device)

All distance thresholds are divided by `k = shoulderW0` for camera-distance invariance.

| Signal | Formula | Start value | Notes |
|---|---|---|---|
| Squat engage floor | `(hipY − hipY0)/k` | `> 0.15` | crouch starts ramping |
| Squat full | same | `≈ 0.50` | `crouch = 1.0` |
| Squat clears beam | `crouch` | `> 0.55` | gate at action plane |
| Jump upward velocity | `hipY_now − hipY_prev` | `< −0.02` | negative = up |
| Jump rise gate | `(hipY0 − hipY)/k` | `> 0.18` | combined with velocity |
| Jump clears hurdle | `jumpY` (game-space) | `> 0.35` | gate at action plane |
| Calibration hold | full-body visible | `≈ 60 frames (~1.5s)` | stable baseline |
| EMA smoothing α | landmark/camera smoothing | `≈ 0.3` | Kriya house value |
| Camera-bob damping | `min(1, dt*18)` | `18` | higher = snappier, riskier for nausea |
| Return-to-neutral gate | `abs(drop) & rise` near 0 | `< 0.08` | re-arm reps |

> **🧠 Your call:** knee-angle squat depth (`angle(hip,knee,ankle)`) may be more robust than hip-drop for some body types/camera heights. If you implement it, `<120°` ≈ a real squat is a reasonable start. Test both, keep the better.

---

## 3. Kriya scoring pipeline (condensed)

```
RawGameData → Plausibility → Band index (0–4, X & Y) → 5×5 Matrix lookup
  → pre-conditioned score (0–1) → Age normalization → conditioned (0–1) → Musculage
```

**Band → percentage canon:** index `[0,1,2,3,4] → [61%,71%,81%,91%,100%]` (`BAND_PCT=[0.61,0.71,0.81,0.91,1.00]`).

**Matrices** (`src/server/scoring/matrices.ts`): `MATRIX_70_30` (primary+secondary, most tests) and `MATRIX_50_50` (equal, e.g. left/right leg). `matrix[xBandIdx][yBandIdx] → preCond`.

**Age normalization** (`src/server/scoring/age-norm.ts`): `AGE_NORM_MATRIX` = 5 score-bands × 5 age-cohorts (18-39, 40-49, 50-59, 60-69, 70+), factors ~0.80–1.20. `getAgeNormFactor(preCond, age)` → multiplier. `conditioned = ageFactor * preCond`.

**Musculage:** `musculage = conditioned > 0 ? round(age / conditioned) : age * 3`. Lower is better; 1.0 conditioned ⇒ musculage = chronological age.

**Compute skeleton** (`src/server/scoring/compute.ts`):
```ts
const { xBandFn, yBandFn, matrix } = getTestConfig(input.testId);
const preCond = matrix[xBandFn(input.xMetric)][yBandFn(input.yMetric)];
const ageFactor = getAgeNormFactor(preCond, age);
const conditioned = ageFactor * preCond;
const musculage = conditioned > 0 ? Math.round(age / conditioned) : age * 3;
```

**Adding a new test — the 6 canonical steps** (this is exactly the KR1 work):
1. Raw interface → `src/types/raw-data.ts`
2. Plausibility maxima → `getTestMaxValues()` / `validators.ts`
3. Band fns → `src/server/scoring/bands.ts`
4. Switch case → `computeScore()` in `compute.ts`
5. Payload mapping → `transformRawDataToApiPayload()` in `src/hooks/useScore.ts`
6. Metadata → `TEST_METADATA` + `TEST_IDS_BY_CATEGORY` in `src/lib/constants.ts` (and `getCategoryForTest`)

---

## 4. Data pipeline & persistence (condensed)

**Endpoint:** `POST /api/score/compute`, body `{ testId, rawData, age, gender }`, wrapped by `withAuth` (JWT + rate limit; ~1 per testId per 10s). Steps: Zod validate → rate limit → plausibility → compute → persist → invalidate cache → activity log → return `{ conditioned, musculage, attemptNumber, personalBest, sessionId, … }`.

**Tables (additive-only):**
```
test_sessions:  userId, testId, category, rawData(jsonb), scoreData(jsonb), startedAt, completedAt
score_trends:   userId, testId, attemptNumber, conditionedScore(numeric 5,3), musculage, personalBest, deltaPct, recordedAt
activity_logs:  userId, action, metadata(jsonb), createdAt
daily_streaks:  userId, currentStreak, longestStreak, lastActiveDate
```

**Reports/dashboard:** single-game summary `GET /api/results/summary?testId=KR1`; dashboard `GET /api/score/dashboard` aggregates by category (reflex/balance/rom/mobility) → overall score, overall musculage, per-category averages + trend, streak, recent activity. Kriya360 = equal-weighted composite of one test per category.

### Non-negotiable gotchas (production-learned)
- **`sessionId` vs `reportId`:** navigate to report with `sessionId`. Report page queries `reports.sessionId`. Using `reportId` → 404. **#1 new-game bug.**
- **`customMetrics` Zod filter:** server validates `z.record(z.string(), z.number())`. Strings/booleans/arrays (like `testId`, `swayHistory`) fail validation. Filter to finite numbers before submit:
  ```ts
  const customMetrics: Record<string, number> = {};
  for (const [key, value] of Object.entries(rawData)) {
    if (typeof value === 'number' && Number.isFinite(value)) customMetrics[key] = value;
  }
  ```
- **Redis graceful fallback:** cache helpers must no-op when Redis env is absent; never let `cacheDelete` crash a successful write with a 500.
- **Anonymous flow:** pre-auth plays are stored client-side (Zustand `PendingRawData`) and claimed post-login if `playedAt` within 1 hour. Reuse the shell's existing claim logic.
- **Numeric precision:** conditioned scores are `numeric(5,3)`; Postgres returns them as strings — `parseFloat(String(x))` on read.
- **Immutable history:** `test_sessions` never modified; `score_trends` append-only; personal best recomputed against all prior on insert.

---

## 5. Backend conventions cheat-sheet

- Next.js 14, single project (not a monorepo). API routes: `export const dynamic = 'force-dynamic'`, Zod `safeParse`, `withAuth('name', limit, windowMs, handler)`, string error codes (`validation_error`, `internal_error`, `auth_required`).
- Drizzle lazy singleton `db`; schema in `src/server/db/schema.ts`; `npx drizzle-kit generate` then `push` after schema changes.
- Zustand stores: `use{Name}Store`, persisted with `partialize`.
- Client calls via `apiClient()` (auto token refresh).
- Deps already present — **do not add** new ORM/auth/state libs: `drizzle-orm 0.45`, `zod 4.3`, `zustand 5.0`, `jose`, `bcryptjs`, `@upstash/redis`, `recharts`, `@sentry/nextjs`.
- Naming: DB snake_case; response fields camelCase; files kebab-case; components PascalCase; constants UPPER_SNAKE_CASE.

---

## 6. Existing-game patterns to mirror

- **`src/` only** — root HTML prototypes are reference, never build targets.
- **Internal calibration** — no separate calibration shell; the game calibrates itself (Ninja pattern).
- **Scoring canon** — `BAND_PCT=[0.61,0.71,0.81,0.91,1.00]`, 70/30 primary/secondary weighting, shared age-norm via the compute path. Reuse `computeCDE()`-style shared logic rather than re-implementing.
- **Build-prompt discipline** (how Govind's other games were built): exact changesets, pre-verified test vectors, `tsc --noEmit` gate, explicit DO-NOT lists. You may keep that rigor, but you're also trusted to think.

---

## 7. Suggested file map for KR1 (adapt to repo reality)

```
src/
├── components/games/runner/          ← new: FPP scene, cue, PiP, engine
│   ├── RunnerEngine.ts               ← GameEngine impl (loop, detection, metrics)
│   ├── RunnerScene.ts                ← Three.js world (sky/ground/city/obstacles)
│   ├── RunnerHUD.tsx                 ← cue + chips + PiP
│   └── runner-constants.ts           ← thresholds, obstacle spacing, tunables
├── types/raw-data.ts                 ← add RunnerRawData
├── server/scoring/bands.ts           ← bandKR1X / bandKR1Y
├── server/scoring/compute.ts         ← case 'KR1'
├── server/scoring/validators.ts      ← KR1 plausibility maxima
├── hooks/useScore.ts                 ← KR1 payload mapping + customMetrics filter
├── lib/constants.ts                  ← TEST_METADATA + TEST_IDS_BY_CATEGORY + getCategoryForTest
└── config/games/                     ← runner game config entry
```

> **🧠 Your call:** the exact folder layout is a suggestion. Match the repo's existing game folder convention.

---

## 8. Glossary

- **Musculage** — "muscle age"; `age / conditioned`. Lower is better.
- **Conditioned score** — final 0–1 score after age normalization.
- **Pre-conditioned (preCond)** — matrix lookup output before age norm.
- **Band index** — 0–4 tier a raw metric falls into.
- **EMA** — exponential moving average smoothing (α≈0.3).
- **Hysteresis** — separate on/off thresholds + return-to-neutral gate to prevent flicker/double-fires.
- **Telegraph** — showing an obstacle/cue early enough to react with a full movement.
- **Hip-bob** — FPP camera Y driven by detected hip height for proprioceptive feedback.
- **Movement-paced** — obstacle cadence set by human rep time, not finger-swipe time.
- **Plausibility** — server check rejecting impossible values (flags, doesn't error).
- **Kriya360** — composite assessment across the four categories.

---

## 9. Open questions for Claude Code / Govind / clinician to settle

1. **Fixed course vs endless-with-cap** (assessment comparability vs replay feel). §6.1.
2. **Does KR1 update the formal Mobility musculage, or stand as a separate "Runner Fitness" card?** §9.6. Conservative default: separate + engagement, not overwriting calibrated Mobility.
3. **testId:** new `KR1` prefix vs a `KS*` Mobility id. §9.
4. **Collision model:** instant-fail vs 3-lives (affects `obstaclesFailed` semantics + scoring).
5. **Squat-depth source:** hip-drop vs knee-angle.
6. **Primary band metric:** obstaclesCleared vs a blended performance score.

> **🧠 These are genuinely open.** Make a reasoned choice, implement it cleanly, and leave a one-line note on each decision so Govind can review. Don't block the build waiting for answers — pick sensible defaults.
