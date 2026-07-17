/**
 * Local mirror of production kriya-v3 scoring constants — copied VERBATIM
 * from src/server/scoring/matrices.ts + age-norm.ts (GitLab kriya-v3,
 * re-diffed cell-by-cell 2026-07-17). Do not "improve" these numbers: they
 * are clinician-audited. At integration time this file is deleted and KR1
 * wires into prod's compute.ts directly.
 */

// Pre-Conditioned Score Matrix: 70/30 weighted.
// Rows = Y-axis band index (0=100%..4=60%), Cols = X-axis band index.
// Cell = (X_band_pct × 0.7) + (Y_band_pct × 0.3) as decimal.
// Lookup convention (prod): MATRIX_70_30[yBandIdx][xBandIdx]
export const MATRIX_70_30: number[][] = [
  /* Y0=100% -> */ [1.0, 0.93, 0.86, 0.79, 0.72],
  /* Y1=90%  -> */ [0.97, 0.9, 0.83, 0.76, 0.69],
  /* Y2=80%  -> */ [0.94, 0.87, 0.8, 0.73, 0.66],
  /* Y3=70%  -> */ [0.91, 0.84, 0.77, 0.7, 0.63],
  /* Y4=60%  -> */ [0.88, 0.81, 0.74, 0.67, 0.6],
];

// Age Normalization Factor Matrix (V3-audited, identical for all activities).
// Rows = pre-conditioned score band, Cols = age cohort.
export const AGE_NORM_MATRIX: number[][] = [
  /* 90-100% */ [1.0, 1.05, 1.1, 1.15, 1.2],
  /* 75-89%  */ [0.9, 1.0, 1.05, 1.1, 1.15],
  /* 50-74%  */ [0.85, 0.9, 1.0, 1.05, 1.1],
  /* 25-49%  */ [0.8, 0.85, 0.9, 1.0, 1.05],
  /* <25%    */ [0.75, 0.8, 0.85, 0.9, 1.0],
];

interface AgeCohort {
  min: number;
  max: number;
}

const AGE_COHORTS: AgeCohort[] = [
  { min: 18, max: 39 },
  { min: 40, max: 49 },
  { min: 50, max: 59 },
  { min: 60, max: 69 },
  { min: 70, max: 150 },
];

/** Get age cohort index (0-4). Mirrors prod exactly (<18 → 0, >150 → 4). */
export function getAgeCohortIdx(age: number): number {
  const idx = AGE_COHORTS.findIndex((c) => age >= c.min && age <= c.max);
  if (idx !== -1) return idx;
  return age < 18 ? 0 : 4;
}

/**
 * Get pre-conditioned score band index (0-4).
 * Comparators are INCLUSIVE >= — verified against the prod clone source
 * (preCond exactly 0.900 → band 0). Silent musculage drift if changed.
 */
export function getPreCondBandIdx(score: number): number {
  if (score >= 0.9) return 0;
  if (score >= 0.75) return 1;
  if (score >= 0.5) return 2;
  if (score >= 0.25) return 3;
  return 4;
}

/** Age normalization factor — prod signature: (age, preCondScore). */
export function getAgeNormFactor(age: number, preCondScore: number): number {
  return AGE_NORM_MATRIX[getPreCondBandIdx(preCondScore)][getAgeCohortIdx(age)];
}
