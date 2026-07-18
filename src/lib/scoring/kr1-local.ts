/**
 * KR1 local scoring — mirrors the prod pipeline shape exactly:
 *   band fns → MATRIX_70_30[y][x] (preCond) → getAgeNormFactor →
 *   conditioned = ageFactor × preCond → musculage = round(age / conditioned)
 *
 * Age-only, like every prod test: gender is collected for integration parity
 * but NEVER branches scoring.
 *
 * At integration time: bandKR1X/bandKR1Y move to prod's bands.ts, the
 * `case 'KR1'` below becomes a case in prod's computeScore switch, and this
 * file is deleted.
 */
import type { RunnerRawData } from '@/types/raw-data';
import { MATRIX_70_30, getAgeNormFactor } from './kr1-matrices';

export interface KR1ScoreResult {
  /** KR1N (head/neck runner, ROM category) scores through the SAME X/Y
   *  pipeline — cleanFormRate there reflects comfortable neck-ROM adequacy. */
  testId: 'KR1' | 'KR1N';
  preCond: number;
  ageFactor: number;
  /** 0..~1.2 — CAN exceed 1.0 (older cohorts get >1 factors). Cap at 100%
   *  for display only. */
  conditioned: number;
  /** "Muscle age" — lower is better; equals chronological age at 1.0. */
  musculage: number;
  xBandIdx: number;
  yBandIdx: number;
  /** true when the run had zero meaningful activity (DNF rule). */
  incomplete: boolean;
}

// NOTE: bands follow PROD convention (0 = best .. 4 = worst). The SPEC's
// draft bandKR1X returned 4 for best — inverted vs the audited matrices
// where MATRIX[0][0] = 1.000 is the maximum. Prod wins.
// X (primary, 70%): thresholds calibrated on the original 20-obstacle scale.
export function bandKR1X(cleared: number): number {
  if (cleared >= 18) return 0;
  if (cleared >= 15) return 1;
  if (cleared >= 11) return 2;
  if (cleared >= 7) return 3;
  return 4;
}

// Y (secondary, 30%): clean-form rate. "Clean" thresholds sit strictly above
// the clear gates (see runner-constants), so this axis measures movement
// quality beyond merely clearing — a rep can be cleared-but-not-clean.
export function bandKR1Y(cleanFormRate: number): number {
  if (cleanFormRate >= 0.9) return 0;
  if (cleanFormRate >= 0.75) return 1;
  if (cleanFormRate >= 0.6) return 2;
  if (cleanFormRate >= 0.4) return 3;
  return 4;
}

/**
 * DNF rule: a 3-lives DNF with real reps/clears scores normally through the
 * matrix (the matrix path can never produce conditioned = 0; its floor is
 * 0.60 × 0.75 = 0.45). The age×3 fallback fires ONLY on zero meaningful
 * activity — no reps AND no clears — i.e. the user never actually played.
 */
export function isIncompleteRun(raw: Pick<RunnerRawData, 'squatReps' | 'jumpReps' | 'obstaclesCleared'>): boolean {
  return raw.squatReps + raw.jumpReps === 0 && raw.obstaclesCleared === 0;
}

/**
 * ENDLESS-mode X input — duration-independent by construction:
 *
 *   effectiveCleared = (cleared / attempted) × 20
 *
 * With endless obstacles the raw cleared-count scales with the chosen
 * session length (30/60/90s), which would make the SAME user's Muscle Age
 * depend on the duration they picked. The clear-FRACTION of obstacles
 * actually attempted does not: the denominator scales with whatever the
 * world served, so a given accuracy maps to the same X band regardless of
 * duration. ×20 projects the fraction onto the scale the (unchanged)
 * bandKR1X thresholds (≥18/15/11/7) were calibrated for. A time-rate was
 * rejected: obstacle arrival rate depends on the speed ramp, which would
 * penalize short sessions. Deliberate metric choice (owner-approved):
 * accuracy over volume. Small samples are flagged by assessmentValid.
 * The user always SEES the honest raw count — only scoring gets this.
 */
export function effectiveCleared(
  raw: Pick<RunnerRawData, 'obstaclesCleared' | 'obstaclesFailed'>,
): number {
  const attempted = raw.obstaclesCleared + raw.obstaclesFailed;
  if (attempted <= 0) return 0;
  return (raw.obstaclesCleared / attempted) * 20;
}

export function computeKR1Score(raw: RunnerRawData, age: number): KR1ScoreResult {
  if (isIncompleteRun(raw)) {
    return {
      testId: raw.testId,
      preCond: 0,
      ageFactor: 0,
      conditioned: 0,
      musculage: age * 3,
      xBandIdx: 4,
      yBandIdx: 4,
      incomplete: true,
    };
  }

  const xBandIdx = bandKR1X(effectiveCleared(raw));
  const yBandIdx = bandKR1Y(raw.cleanFormRate);
  // prod lookup convention: matrix[yBandIdx][xBandIdx] — X is the 70% axis
  // (columns spread 0.28/row; rows spread 0.12/col)
  const preCond = MATRIX_70_30[yBandIdx][xBandIdx];
  const ageFactor = getAgeNormFactor(age, preCond);
  const conditioned = ageFactor * preCond;
  const musculage = conditioned > 0 ? Math.round(age / conditioned) : age * 3;

  return {
    testId: raw.testId,
    preCond,
    ageFactor,
    conditioned,
    musculage,
    xBandIdx,
    yBandIdx,
    incomplete: false,
  };
}
