/**
 * KR1 scoring-mirror validation — Govind's M4 addendum suite.
 * Golden vectors hand-computed against the verbatim clone matrices;
 * comparator confirmed inclusive >= in the prod source.
 */
import { describe, it, expect } from 'vitest';
import {
  bandKR1X,
  bandKR1Y,
  computeKR1Score,
  isIncompleteRun,
} from '../kr1-local';
import { MATRIX_70_30, getAgeNormFactor, getPreCondBandIdx, getAgeCohortIdx } from '../kr1-matrices';
import type { RunnerRawData } from '@/types/raw-data';
import { RunnerEngine } from '@/modules/game/engines/runner-engine';

function makeRaw(overrides: Partial<RunnerRawData>): RunnerRawData {
  return {
    testId: 'KR1',
    distance: 300,
    obstaclesTotal: 20,
    obstaclesCleared: 15,
    obstaclesFailed: 3,
    squatReps: 10,
    jumpReps: 10,
    avgSquatDepth: 0.7,
    avgJumpHeight: 0.7,
    avgReactionMs: 600,
    cleanFormRate: 0.7,
    controlModeKeyboard: 1,
    lowImpact: 0,
    assessmentValid: 1,
    seed: 1337,
    elapsed: 90000,
    ...overrides,
  };
}

// ── matrix corners + weighting direction ───────────────────────────────────

describe('matrix constants (pinned to clone values)', () => {
  it('corners: best 1.000, worst 0.600', () => {
    expect(MATRIX_70_30[0][0]).toBe(1.0);
    expect(MATRIX_70_30[4][4]).toBe(0.6);
  });

  it('70/30 weighting direction: X (columns) is the wide/primary axis', () => {
    // dropping X from best to worst costs 0.28; dropping Y costs 0.12
    expect(MATRIX_70_30[0][4]).toBe(0.72);
    expect(MATRIX_70_30[4][0]).toBe(0.88);
  });

  it('age-norm comparator is inclusive >= (clone-verified)', () => {
    expect(getPreCondBandIdx(0.9)).toBe(0); // exactly 0.90 → top band
    expect(getPreCondBandIdx(0.8999)).toBe(1);
    expect(getPreCondBandIdx(0.75)).toBe(1);
    expect(getPreCondBandIdx(0.5)).toBe(2);
    expect(getPreCondBandIdx(0.25)).toBe(3);
    expect(getPreCondBandIdx(0.2499)).toBe(4);
  });

  it('age cohorts: 18-39 / 40-49 / 50-59 / 60-69 / 70+', () => {
    expect(getAgeCohortIdx(30)).toBe(0);
    expect(getAgeCohortIdx(39)).toBe(0);
    expect(getAgeCohortIdx(40)).toBe(1);
    expect(getAgeCohortIdx(65)).toBe(3);
    expect(getAgeCohortIdx(70)).toBe(4);
    expect(getAgeCohortIdx(12)).toBe(0);
    expect(getAgeCohortIdx(200)).toBe(4);
  });
});

// ── band edges ─────────────────────────────────────────────────────────────

describe('band edges (inclusive sides pinned)', () => {
  it('bandKR1X: 18→0 / 17→1 / 15→1 / 14→2 / 11→2 / 10→3 / 7→3 / 6→4', () => {
    expect(bandKR1X(20)).toBe(0);
    expect(bandKR1X(18)).toBe(0);
    expect(bandKR1X(17)).toBe(1);
    expect(bandKR1X(15)).toBe(1);
    expect(bandKR1X(14)).toBe(2);
    expect(bandKR1X(11)).toBe(2);
    expect(bandKR1X(10)).toBe(3);
    expect(bandKR1X(7)).toBe(3);
    expect(bandKR1X(6)).toBe(4);
    expect(bandKR1X(0)).toBe(4);
  });

  it('bandKR1Y: 0.90→0 / 0.89→1 / 0.75→1 / 0.60→2 / 0.40→3 / 0.39→4', () => {
    expect(bandKR1Y(0.95)).toBe(0);
    expect(bandKR1Y(0.9)).toBe(0);
    expect(bandKR1Y(0.89)).toBe(1);
    expect(bandKR1Y(0.75)).toBe(1);
    expect(bandKR1Y(0.6)).toBe(2);
    expect(bandKR1Y(0.4)).toBe(3);
    expect(bandKR1Y(0.39)).toBe(4);
  });
});

// ── swap-detection (x/y transposition guard) ───────────────────────────────

describe('swap detection', () => {
  it('strong clears + mediocre form → matrix[3][0]=0.910, NOT transposed 0.790', () => {
    const r = computeKR1Score(makeRaw({ obstaclesCleared: 20, cleanFormRate: 0.45 }), 45);
    expect(r.xBandIdx).toBe(0);
    expect(r.yBandIdx).toBe(3);
    expect(r.preCond).toBe(0.91); // matrix[3][0] — clears are primary
  });
});

// ── golden vectors (hand-computed against clone values) ────────────────────

describe('golden vectors', () => {
  const vectors: Array<{
    name: string;
    cleared: number;
    cfr: number;
    age: number;
    preCond: number;
    ageFactor: number;
    musculage: number;
  }> = [
    { name: 'A perfect/young', cleared: 20, cfr: 0.95, age: 30, preCond: 1.0, ageFactor: 1.0, musculage: 30 },
    { name: 'B perfect/older', cleared: 20, cfr: 0.95, age: 65, preCond: 1.0, ageFactor: 1.15, musculage: 57 },
    { name: 'C mid/mid-age', cleared: 13, cfr: 0.62, age: 52, preCond: 0.8, ageFactor: 1.05, musculage: 62 },
    { name: 'D poor/young', cleared: 6, cfr: 0.3, age: 25, preCond: 0.6, ageFactor: 0.85, musculage: 49 },
    { name: 'E clears/weak form', cleared: 20, cfr: 0.45, age: 45, preCond: 0.91, ageFactor: 1.05, musculage: 47 },
  ];

  for (const v of vectors) {
    it(`${v.name}: (${v.cleared}, ${v.cfr}, age ${v.age}) → musculage ${v.musculage}`, () => {
      const r = computeKR1Score(makeRaw({ obstaclesCleared: v.cleared, cleanFormRate: v.cfr }), v.age);
      expect(r.preCond).toBeCloseTo(v.preCond, 10);
      expect(r.ageFactor).toBeCloseTo(v.ageFactor, 10);
      expect(r.conditioned).toBeCloseTo(v.preCond * v.ageFactor, 10);
      expect(r.musculage).toBe(v.musculage);
      expect(r.incomplete).toBe(false);
    });
  }

  it('F zero-run (DNF rule): no reps + no clears → age×3 = 120', () => {
    const r = computeKR1Score(
      makeRaw({ obstaclesCleared: 0, obstaclesFailed: 3, squatReps: 0, jumpReps: 0, cleanFormRate: 0 }),
      40,
    );
    expect(r.incomplete).toBe(true);
    expect(r.conditioned).toBe(0);
    expect(r.musculage).toBe(120);
  });

  it('a 3-lives DNF WITH real activity scores normally through the matrix', () => {
    const raw = makeRaw({ obstaclesCleared: 5, obstaclesFailed: 3, squatReps: 4, jumpReps: 4, cleanFormRate: 0.5 });
    expect(isIncompleteRun(raw)).toBe(false);
    const r = computeKR1Score(raw, 40);
    expect(r.incomplete).toBe(false);
    expect(r.conditioned).toBeGreaterThan(0.4); // matrix floor path, never 0
    expect(r.musculage).toBeLessThan(120);
  });

  it('A vs B: identical perfect run gives the OLDER user a musculage below their age', () => {
    const young = computeKR1Score(makeRaw({ obstaclesCleared: 20, cleanFormRate: 0.95 }), 30);
    const older = computeKR1Score(makeRaw({ obstaclesCleared: 20, cleanFormRate: 0.95 }), 65);
    expect(older.musculage).toBeLessThan(65); // 57 — impressive-for-age credit
    expect(older.conditioned).toBeGreaterThan(1.0); // legal — display caps at 100%
    expect(young.musculage).toBe(30);
  });
});

// ── boundary: preCond exactly 0.900 (comparator drift trap) ────────────────

describe('inclusive-comparator boundary', () => {
  it('preCond exactly 0.900 (x1,y1) at age 35 → R0 factor 1.00 → musculage 39, not 43', () => {
    const r = computeKR1Score(makeRaw({ obstaclesCleared: 15, cleanFormRate: 0.8 }), 35);
    expect(r.preCond).toBeCloseTo(0.9, 10);
    expect(r.ageFactor).toBe(1.0); // inclusive >= 0.90 → top band
    expect(r.musculage).toBe(39); // round(35/0.900) — exclusive would give 43
  });
});

// ── monotonicity property sweep ────────────────────────────────────────────

describe('monotonicity', () => {
  it('improving either raw metric never decreases conditioned (full sweep)', () => {
    const ages = [20, 35, 45, 55, 65, 75];
    for (const age of ages) {
      // sweep cleared 0..20 at fixed cfr
      for (const cfr of [0.1, 0.5, 0.8, 0.95]) {
        let prev = -1;
        for (let cleared = 0; cleared <= 20; cleared++) {
          const r = computeKR1Score(
            makeRaw({ obstaclesCleared: cleared, cleanFormRate: cfr, squatReps: 5, jumpReps: 5 }),
            age,
          );
          expect(r.conditioned, `age ${age} cfr ${cfr} cleared ${cleared}`).toBeGreaterThanOrEqual(prev);
          prev = r.conditioned;
        }
      }
      // sweep cfr 0..1 at fixed cleared
      for (const cleared of [4, 10, 16, 20]) {
        let prev = -1;
        for (let cfr = 0; cfr <= 1.001; cfr += 0.05) {
          const r = computeKR1Score(
            makeRaw({ obstaclesCleared: cleared, cleanFormRate: cfr, squatReps: 5, jumpReps: 5 }),
            age,
          );
          expect(r.conditioned, `age ${age} cleared ${cleared} cfr ${cfr}`).toBeGreaterThanOrEqual(prev);
          prev = r.conditioned;
        }
      }
    }
  });

  it('gender never enters the scoring path (signature is (raw, age) only)', () => {
    // compile-time: computeKR1Score takes exactly raw + age
    expect(computeKR1Score.length).toBe(2);
  });
});

// ── xBand saturation check (fixed-course + 3-lives trap) ───────────────────

/**
 * Skill-sweep bot: responds to each cue with probability p. With 3 lives a
 * weak player DNFs early (low cleared), a strong one clears 18-20 — this
 * checks the X axis actually discriminates across a skill spectrum instead
 * of saturating in band 0.
 * NOTE for Govind: synthetic population. Re-check against real-user
 * telemetry after launch; if real runs cluster ≥18, widen the X bands
 * (≥20→0, ≥18→1, ≥15→2, ≥12→3, else 4).
 */
function skillRun(p: number, seed: number): number {
  const engine = new RunnerEngine({ controlMode: 'keyboard', seed });
  engine.startPlaying();
  // deterministic per-obstacle "skill roll" via the obstacle id
  const respond = (id: number) => ((id * 2654435761 + Math.floor(p * 1e6)) % 1000) / 1000 < p;
  let t = 1000;
  let jumpedFor = -1;
  let frames = 0;
  while (!engine.isComplete() && frames < 12000) {
    frames++;
    t += 33;
    const s = engine.getSceneState();
    const cue = s.cue;
    if (cue && respond(cue.obstacleId)) {
      engine.setControlInput({ crouchHeld: cue.type === 'beam' });
      if (cue.type === 'hurdle' && cue.progress >= 0.8 && jumpedFor !== cue.obstacleId) {
        jumpedFor = cue.obstacleId;
        engine.setControlInput({ jumpPressed: true });
      }
    } else {
      engine.setControlInput({ crouchHeld: false });
    }
    engine.processFrame([], t);
  }
  return engine.getRawData().obstaclesCleared;
}

describe('xBand distribution across a skill sweep', () => {
  it('bands do not saturate: a weak→strong population spreads across ≥4 bands, <70% in band 0', () => {
    const histogram = [0, 0, 0, 0, 0];
    const skills = [0.1, 0.2, 0.3, 0.4, 0.5, 0.55, 0.6, 0.65, 0.7, 0.75, 0.8, 0.85, 0.9, 0.92, 0.95, 0.97, 1.0];
    let runs = 0;
    for (const p of skills) {
      for (const seed of [1337, 2861]) {
        const cleared = skillRun(p, seed);
        histogram[bandKR1X(cleared)]++;
        runs++;
      }
    }
    // eslint-disable-next-line no-console
    console.log('[KR1 saturation check] xBand histogram (skill sweep 0.1→1.0):', histogram);
    const bandsHit = histogram.filter((n) => n > 0).length;
    expect(bandsHit).toBeGreaterThanOrEqual(4);
    expect(histogram[0] / runs).toBeLessThan(0.7);
  });
});
