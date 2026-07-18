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
  effectiveCleared,
  isIncompleteRun,
} from '../kr1-local';
import { MATRIX_70_30, getAgeNormFactor, getPreCondBandIdx, getAgeCohortIdx } from '../kr1-matrices';
import { getTestCategory, type RunnerRawData } from '@/types/raw-data';
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
    avgNeckFlexion: 0,
    avgNeckExtension: 0,
    avgReactionMs: 600,
    cleanFormRate: 0.7,
    controlScheme: 0,
    controlModeKeyboard: 1,
    coinsCollected: 0,
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
    const r = computeKR1Score(
      makeRaw({ obstaclesCleared: 20, obstaclesFailed: 0, cleanFormRate: 0.45 }),
      45,
    );
    expect(r.xBandIdx).toBe(0);
    expect(r.yBandIdx).toBe(3);
    expect(r.preCond).toBe(0.91); // matrix[3][0] — clears are primary
  });
});

// ── ENDLESS-mode X input: fraction of attempted, duration-independent ──────

describe('effectiveCleared — the duration-normalized X input', () => {
  it('is clear-fraction × 20 (accuracy over volume — owner-approved)', () => {
    expect(effectiveCleared({ obstaclesCleared: 20, obstaclesFailed: 0 })).toBe(20);
    expect(effectiveCleared({ obstaclesCleared: 10, obstaclesFailed: 10 })).toBe(10);
    expect(effectiveCleared({ obstaclesCleared: 13, obstaclesFailed: 3 })).toBeCloseTo(16.25, 10);
    expect(effectiveCleared({ obstaclesCleared: 0, obstaclesFailed: 0 })).toBe(0);
    expect(effectiveCleared({ obstaclesCleared: 0, obstaclesFailed: 3 })).toBe(0);
  });

  it('the SAME accuracy maps to the SAME band regardless of session volume', () => {
    // 90% accuracy at 30s-ish volume vs 90s-ish volume → identical band
    const short = effectiveCleared({ obstaclesCleared: 9, obstaclesFailed: 1 });
    const long = effectiveCleared({ obstaclesCleared: 36, obstaclesFailed: 4 });
    expect(bandKR1X(short)).toBe(bandKR1X(long));
    expect(short).toBeCloseTo(long, 10);
  });

  it('higher clear-fraction never maps to a worse band', () => {
    let prevBand = 4;
    for (let cleared = 0; cleared <= 20; cleared++) {
      const band = bandKR1X(effectiveCleared({ obstaclesCleared: cleared, obstaclesFailed: 20 - cleared }));
      expect(band).toBeLessThanOrEqual(prevBand);
      prevBand = band;
    }
  });
});

// ── golden vectors (hand-computed against clone values) ────────────────────

describe('golden vectors', () => {
  // RE-DERIVED for the endless fraction-of-attempted X input (owner-approved):
  // X = (cleared/attempted)×20 → bandKR1X (thresholds + matrix + age-norm all
  // byte-identical). Perfect (A/B/E, failed 0) and zero (F) anchors unchanged.
  // C: 13 cleared / 3 failed (lives-ended) → effective 16.25 → xBand 1 →
  //    matrix[2][1] = 0.87, cohort 50-59 factor band ≥.75 → 1.05 →
  //    conditioned 0.9135 → musculage round(52/0.9135) = 57 (was 62).
  // D: "poor" now = poor ACCURACY: 1 cleared / 3 failed → effective 5 →
  //    xBand 4 → matrix[4][4] = 0.60, factor 0.85 → musculage 49 (unchanged).
  const vectors: Array<{
    name: string;
    cleared: number;
    failed: number;
    cfr: number;
    age: number;
    preCond: number;
    ageFactor: number;
    musculage: number;
  }> = [
    { name: 'A perfect/young', cleared: 20, failed: 0, cfr: 0.95, age: 30, preCond: 1.0, ageFactor: 1.0, musculage: 30 },
    { name: 'B perfect/older', cleared: 20, failed: 0, cfr: 0.95, age: 65, preCond: 1.0, ageFactor: 1.15, musculage: 57 },
    { name: 'C mid/mid-age', cleared: 13, failed: 3, cfr: 0.62, age: 52, preCond: 0.87, ageFactor: 1.05, musculage: 57 },
    { name: 'D poor/young', cleared: 1, failed: 3, cfr: 0.3, age: 25, preCond: 0.6, ageFactor: 0.85, musculage: 49 },
    { name: 'E clears/weak form', cleared: 20, failed: 0, cfr: 0.45, age: 45, preCond: 0.91, ageFactor: 1.05, musculage: 47 },
  ];

  for (const v of vectors) {
    it(`${v.name}: (${v.cleared}/${v.cleared + v.failed}, ${v.cfr}, age ${v.age}) → musculage ${v.musculage}`, () => {
      const r = computeKR1Score(
        makeRaw({ obstaclesCleared: v.cleared, obstaclesFailed: v.failed, cleanFormRate: v.cfr }),
        v.age,
      );
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
    const young = computeKR1Score(
      makeRaw({ obstaclesCleared: 20, obstaclesFailed: 0, cleanFormRate: 0.95 }),
      30,
    );
    const older = computeKR1Score(
      makeRaw({ obstaclesCleared: 20, obstaclesFailed: 0, cleanFormRate: 0.95 }),
      65,
    );
    expect(older.musculage).toBeLessThan(65); // 57 — impressive-for-age credit
    expect(older.conditioned).toBeGreaterThan(1.0); // legal — display caps at 100%
    expect(young.musculage).toBe(30);
  });
});

// ── boundary: preCond exactly 0.900 (comparator drift trap) ────────────────

describe('inclusive-comparator boundary', () => {
  it('preCond exactly 0.900 (x1,y1) at age 35 → R0 factor 1.00 → musculage 39, not 43', () => {
    // effective = 15/20 × 20 = 15 → xBand 1 (same cell as the old input)
    const r = computeKR1Score(
      makeRaw({ obstaclesCleared: 15, obstaclesFailed: 5, cleanFormRate: 0.8 }),
      35,
    );
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

// ── coins are engagement only — provably unscored ──────────────────────────

describe('coins never affect the score', () => {
  it('identical raw data with different coinsCollected → identical conditioned + musculage', () => {
    for (const age of [25, 45, 68]) {
      const zero = computeKR1Score(makeRaw({ coinsCollected: 0 }), age);
      const many = computeKR1Score(makeRaw({ coinsCollected: 999 }), age);
      expect(many.conditioned).toBe(zero.conditioned);
      expect(many.musculage).toBe(zero.musculage);
      expect(many.preCond).toBe(zero.preCond);
    }
  });
});

// ── KR1N (head/neck-ROM variant) ───────────────────────────────────────────

describe('KR1N head-mode scoring', () => {
  it('KR1N maps to the ROM category; KR1 stays mobility', () => {
    expect(getTestCategory('KR1N')).toBe('rom');
    expect(getTestCategory('KR1')).toBe('mobility');
  });

  it('KR1N scores through the same X/Y pipeline and keeps its testId', () => {
    const r = computeKR1Score(
      makeRaw({ testId: 'KR1N', controlScheme: 2, obstaclesCleared: 16, cleanFormRate: 0.8 }),
      50,
    );
    expect(r.testId).toBe('KR1N');
    expect(r.preCond).toBeCloseTo(MATRIX_70_30[1][1], 10);
    expect(Number.isFinite(r.musculage)).toBe(true);
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
function skillRun(p: number, seed: number, sessionMs = 60_000): RunnerRawData {
  const engine = new RunnerEngine({ controlMode: 'keyboard', seed });
  engine.setSessionMs(sessionMs); // endless mode: session bounds the run
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
  return engine.getRawData();
}

describe('xBand distribution across a skill sweep', () => {
  it('bands do not saturate: a weak→strong population spreads across ≥4 bands, <70% in band 0', () => {
    const histogram = [0, 0, 0, 0, 0];
    const skills = [0.1, 0.2, 0.3, 0.4, 0.5, 0.55, 0.6, 0.65, 0.7, 0.75, 0.8, 0.85, 0.9, 0.92, 0.95, 0.97, 1.0];
    let runs = 0;
    for (const p of skills) {
      for (const seed of [1337, 2861]) {
        const raw = skillRun(p, seed);
        histogram[bandKR1X(effectiveCleared(raw))]++;
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

// ── endless duration-independence (the critical Muscle-Age protection) ─────

describe('endless mode: Muscle Age is duration-independent', () => {
  it('perfect play at 30s vs 90s → same X band, same musculage', () => {
    const short = skillRun(1.0, 1337, 30_000);
    const long = skillRun(1.0, 1337, 90_000);
    // raw counts differ (more obstacles served in 90s)…
    expect(long.obstaclesCleared).toBeGreaterThan(short.obstaclesCleared);
    // …but the scoring input and result do not
    const rShort = computeKR1Score(short, 40);
    const rLong = computeKR1Score(long, 40);
    expect(rShort.xBandIdx).toBe(rLong.xBandIdx);
    expect(rShort.xBandIdx).toBe(0);
    expect(rShort.musculage).toBe(rLong.musculage);
  });

  it('high-but-imperfect play at 30s vs 90s → same X band', () => {
    const short = skillRun(0.95, 1337, 30_000);
    const long = skillRun(0.95, 1337, 90_000);
    const rShort = computeKR1Score(short, 40);
    const rLong = computeKR1Score(long, 40);
    expect(rShort.xBandIdx).toBe(rLong.xBandIdx);
  });

  it('a higher clear-rate maps to a better (or equal) band than a lower one', () => {
    const weak = computeKR1Score(skillRun(0.5, 1337), 40);
    const strong = computeKR1Score(skillRun(0.95, 1337), 40);
    expect(strong.xBandIdx).toBeLessThanOrEqual(weak.xBandIdx);
    expect(strong.musculage).toBeLessThanOrEqual(weak.musculage);
  });
});
