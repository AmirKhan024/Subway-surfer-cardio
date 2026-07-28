/**
 * Three-act journey — the whole automated test surface for the feature.
 *
 * runner-scene.ts imports three and touches the DOM, and vitest here is
 * node-env with include: ['src/**\/*.test.ts'], so the scene and the .tsx
 * files cannot be tested. Everything testable therefore lives in
 * runner-acts.ts, and these tests are what stop a future edit silently
 * breaking the world (gaps in the prop rows, props teleporting, the ramp
 * going dark where the obstacles must stay readable).
 */
import { describe, it, expect } from 'vitest';
import {
  ACT_BOUNDS,
  ACT_BLEND_BAND,
  ACT_PROP_LEAD,
  ACTS,
  DAWN,
  PROP_ROW_SIZES,
  actForProgress,
  actForWrap,
  actMeta,
  actWeights,
  propKindFor,
  propKindsForSlot,
  propLap,
  propZLocal,
  type ActId,
  type ActWeights,
  type PropRow,
} from '../runner-acts';

const LOOP_LEN = 200; // must match runner-scene.ts

describe('act bounds — equal thirds of run progress', () => {
  it('maps progress to the right act, inclusive at each boundary', () => {
    expect(actForProgress(0)).toBe(1);
    expect(actForProgress(0.2)).toBe(1);
    expect(actForProgress(1 / 3 - 1e-9)).toBe(1);
    expect(actForProgress(1 / 3)).toBe(2);
    expect(actForProgress(0.5)).toBe(2);
    expect(actForProgress(2 / 3 - 1e-9)).toBe(2);
    expect(actForProgress(2 / 3)).toBe(3);
    expect(actForProgress(1)).toBe(3);
  });

  it('clamps junk rather than propagating it into the scene', () => {
    // progress comes from 1 - timerMs/sessionMs and the timer can be null
    expect(actForProgress(-1)).toBe(1);
    expect(actForProgress(2)).toBe(3);
    expect(actForProgress(NaN)).toBe(1);
    expect(actForProgress(Infinity)).toBe(1);
  });

  it('the three acts are equal thirds', () => {
    const a = ACT_BOUNDS.ACT2_START;
    const b = ACT_BOUNDS.ACT3_START;
    expect(a).toBeCloseTo(1 / 3, 12);
    expect(b).toBeCloseTo(2 / 3, 12);
    expect(b - a).toBeCloseTo(a - 0, 12);
    expect(1 - b).toBeCloseTo(b - a, 12);
  });

  it('never runs backwards over a full sweep and visits exactly three acts', () => {
    let prev = 0;
    const seen = new Set<ActId>();
    for (let i = 0; i <= 1000; i++) {
      const act = actForProgress(i / 1000);
      expect(act).toBeGreaterThanOrEqual(prev);
      prev = act;
      seen.add(act);
    }
    expect(Array.from(seen).sort()).toEqual([1, 2, 3]);
  });
});

describe('act metadata — the title-card copy', () => {
  it('is three acts, in order, with unique keys', () => {
    expect(ACTS).toHaveLength(3);
    expect(ACTS.map((a) => a.id)).toEqual([1, 2, 3]);
    expect(ACTS.map((a) => a.key)).toEqual(['kaho', 'crossing', 'dong']);
    expect(ACTS.map((a) => a.numeral)).toEqual(['I', 'II', 'III']);
    expect(new Set(ACTS.map((a) => a.key)).size).toBe(3);
  });

  it('every act has a name and a beat, and the beat fits the lower-third card', () => {
    for (const a of ACTS) {
      expect(a.name.length).toBeGreaterThan(0);
      expect(a.beat.length).toBeGreaterThan(0);
      // a longer line wraps to four rows on a 360px phone and starts eating
      // into the play area — this is the guard, not a style preference
      expect(a.beat.length, `${a.name} beat too long`).toBeLessThanOrEqual(62);
      expect(a.accent).toMatch(/^#[0-9A-Fa-f]{6}$/);
    }
  });

  it('actMeta round-trips whatever actForProgress returns', () => {
    for (const p of [0, 0.1, 1 / 3, 0.5, 2 / 3, 0.9, 1]) {
      const id = actForProgress(p);
      expect(actMeta(id).id).toBe(id);
    }
  });
});

describe('the prop plan — no gaps, no regression, stable near lane', () => {
  const ROWS: PropRow[] = ['A', 'B', 'C'];

  it('every slot has a prop in every act — hiding one can never leave a hole', () => {
    for (const row of ROWS) {
      for (let i = 0; i < PROP_ROW_SIZES[row]; i++) {
        for (const act of [1, 2, 3] as ActId[]) {
          const kind = propKindFor(row, i, act);
          expect(kind, `row ${row} slot ${i} act ${act}`).toBeTruthy();
          expect(typeof kind).toBe('string');
        }
      }
    }
  });

  it('row C is act-invariant — the near-lane speed rhythm never changes', () => {
    for (let i = 0; i < PROP_ROW_SIZES.C; i++) {
      expect(propKindFor('C', i, 1)).toBe('marker');
      expect(propKindFor('C', i, 2)).toBe('marker');
      expect(propKindFor('C', i, 3)).toBe('marker');
    }
  });

  it('act 1 reproduces the shipped world exactly (zero visual regression)', () => {
    // these are the literal expressions from buildWorld before this change
    for (let i = 0; i < 14; i++) {
      const expected = i === 9 ? 'gonpa' : i % 3 === 1 ? 'bamboo' : 'pine';
      expect(propKindFor('A', i, 1), `row A slot ${i}`).toBe(expected);
    }
    for (let i = 0; i < 10; i++) {
      expect(propKindFor('B', i, 1), `row B slot ${i}`).toBe(
        i % 2 === 0 ? 'flags' : 'mani',
      );
    }
  });

  it('the gonpa is Kaho\'s landmark and does not follow you out of the village', () => {
    const count = (act: ActId) =>
      Array.from({ length: PROP_ROW_SIZES.A }, (_, i) => propKindFor('A', i, act)).filter(
        (k) => k === 'gonpa',
      ).length;
    expect(count(1)).toBe(1);
    expect(count(2)).toBe(0);
    expect(count(3)).toBe(0);
  });

  it('propKindsForSlot is the deduped superset of the three acts', () => {
    for (const row of ROWS) {
      for (let i = 0; i < PROP_ROW_SIZES[row]; i++) {
        const kinds = propKindsForSlot(row, i);
        expect(new Set(kinds).size, `row ${row} slot ${i} has duplicates`).toBe(kinds.length);
        for (const act of [1, 2, 3] as ActId[]) {
          expect(kinds).toContain(propKindFor(row, i, act));
        }
      }
    }
  });

  it('row C costs exactly one variant per slot', () => {
    for (let i = 0; i < PROP_ROW_SIZES.C; i++) {
      expect(propKindsForSlot('C', i)).toEqual(['marker']);
    }
  });

  it('the finish looks meaningfully unlike the opening', () => {
    // the acceptance criterion is "three acts clearly distinct". Row C is
    // deliberately act-invariant (8 slots) and prayer flags run the whole
    // journey (5 slots), so the ceiling is 19 — this pins that we are using
    // most of it rather than quietly drifting back toward Kaho.
    let changed = 0;
    for (const row of ROWS) {
      for (let i = 0; i < PROP_ROW_SIZES[row]; i++) {
        if (propKindFor(row, i, 3) !== propKindFor(row, i, 1)) changed += 1;
      }
    }
    expect(changed).toBeGreaterThanOrEqual(14);
  });

  it('the total variant budget stays bounded (VRAM guard)', () => {
    let total = 0;
    for (const row of ROWS) {
      for (let i = 0; i < PROP_ROW_SIZES[row]; i++) total += propKindsForSlot(row, i).length;
    }
    // 32 slots; a naive 3-per-slot build would be 96. Fail loudly if someone
    // adds kinds without thinking about the mesh count.
    expect(total).toBeLessThanOrEqual(70);
    expect(total).toBeGreaterThanOrEqual(32); // every slot has at least one
  });
});

describe('prop recycling maths — the rewrite moves no prop', () => {
  /** the EXACT formula runner-scene.ts used before the three-act change */
  function oldZ(d: number, baseZ: number, loopLen: number): number {
    let z = (baseZ - d) % loopLen;
    if (z < 0) z += loopLen;
    return -(z ? z : loopLen) + 10;
  }

  it('matches the old modulo formula over a wide sweep, including frac === 0', () => {
    for (let s = 0; s < 10000; s++) {
      const d = (s * 7919) % 5000; // spread over 5km of run
      const baseZ = (s * 13) % LOOP_LEN;
      expect(propZLocal(d, baseZ, LOOP_LEN) + 10, `d=${d} baseZ=${baseZ}`).toBeCloseTo(
        oldZ(d, baseZ, LOOP_LEN),
        9,
      );
    }
  });

  it('handles the exact wrap boundary the old special case covered', () => {
    for (const baseZ of [0, 7, 3, 100, 199]) {
      for (const laps of [0, 1, 2, 5]) {
        const d = baseZ + laps * LOOP_LEN; // frac === 0
        expect(propZLocal(d, baseZ, LOOP_LEN) + 10).toBeCloseTo(oldZ(d, baseZ, LOOP_LEN), 9);
        // and it sits far beyond FOG_FAR (95) — invisible, hence safe to swap
        expect(propZLocal(d, baseZ, LOOP_LEN) + 10).toBeLessThan(-95);
      }
    }
  });

  it('the lap counter ticks exactly once per loop length', () => {
    const baseZ = 37;
    for (let lap = 0; lap < 20; lap++) {
      const inside = baseZ + lap * LOOP_LEN + 1;
      expect(propLap(inside, baseZ, LOOP_LEN)).toBe(lap);
    }
  });

  it('frame one registers no false wrap', () => {
    // the scene seeds lastLap by calling propLap(0, baseZ, LOOP_LEN) at build
    // time, so frame one must compute the same lap and see no change.
    // (toBeCloseTo, not toBe: Math.floor(-0/n) is -0, which Object.is
    // distinguishes from 0 even though nothing downstream can tell them apart)
    for (const baseZ of [0, 7, 50, 199]) {
      expect(propLap(0, baseZ, LOOP_LEN)).toBeCloseTo(Math.floor(-baseZ / LOOP_LEN), 12);
      // and no lap change between the seed and the first real frame
      expect(propLap(0.001, baseZ, LOOP_LEN)).toBeCloseTo(propLap(0, baseZ, LOOP_LEN), 12);
    }
  });

  it('the wrap lead points props at the act you are about to run into', () => {
    expect(ACT_PROP_LEAD).toBeGreaterThanOrEqual(0);
    expect(actForWrap(0)).toBe(1);
    expect(actForWrap(1)).toBe(3); // the lead never overruns the last act
    if (ACT_PROP_LEAD > 0) {
      expect(actForWrap(ACT_BOUNDS.ACT2_START - ACT_PROP_LEAD / 2)).toBe(2);
      expect(actForWrap(ACT_BOUNDS.ACT3_START - ACT_PROP_LEAD / 2)).toBe(3);
    }
  });
});

describe('act blend weights — the look cross-fades, it never cuts', () => {
  const out: ActWeights = { w1: 0, w2: 0, w3: 0 };

  it('always sums to one, with every weight in range', () => {
    for (let i = 0; i <= 1000; i++) {
      actWeights(i / 1000, out);
      expect(out.w1 + out.w2 + out.w3).toBeCloseTo(1, 9);
      for (const w of [out.w1, out.w2, out.w3]) {
        expect(w).toBeGreaterThanOrEqual(0);
        expect(w).toBeLessThanOrEqual(1);
      }
    }
  });

  it('is pure act 1 at the start, pure act 3 at the finish, act 2 in the middle', () => {
    actWeights(0, out);
    expect(out.w1).toBeCloseTo(1, 9);
    actWeights(1, out);
    expect(out.w3).toBeCloseTo(1, 9);
    actWeights(0.5, out);
    expect(out.w2).toBeCloseTo(1, 9);
  });

  it('crosses over exactly half-way at each boundary', () => {
    actWeights(ACT_BOUNDS.ACT2_START, out);
    expect(out.w1).toBeCloseTo(0.5, 6);
    expect(out.w2).toBeCloseTo(0.5, 6);
    actWeights(ACT_BOUNDS.ACT3_START, out);
    expect(out.w2).toBeCloseTo(0.5, 6);
    expect(out.w3).toBeCloseTo(0.5, 6);
  });

  it('is continuous everywhere — no step change to pop the scene', () => {
    const prev: ActWeights = { w1: 0, w2: 0, w3: 0 };
    actWeights(0, prev);
    for (let i = 1; i <= 1000; i++) {
      actWeights(i / 1000, out);
      expect(Math.abs(out.w1 - prev.w1)).toBeLessThan(0.06);
      expect(Math.abs(out.w2 - prev.w2)).toBeLessThan(0.06);
      expect(Math.abs(out.w3 - prev.w3)).toBeLessThan(0.06);
      prev.w1 = out.w1;
      prev.w2 = out.w2;
      prev.w3 = out.w3;
    }
  });

  it('is an out-param so a 60fps caller cannot be tempted to allocate', () => {
    expect(actWeights(0.5, out)).toBeUndefined();
    expect(ACT_BLEND_BAND).toBeGreaterThan(0);
  });

  it('handles junk progress without producing NaN weights', () => {
    for (const p of [NaN, Infinity, -5, 9]) {
      actWeights(p, out);
      expect(Number.isFinite(out.w1 + out.w2 + out.w3)).toBe(true);
      expect(out.w1 + out.w2 + out.w3).toBeCloseTo(1, 9);
    }
  });
});

describe('dawn ramp aligns with the acts', () => {
  it('is a well-formed, strictly ascending ramp from 0 to 1', () => {
    expect(DAWN[0].p).toBe(0);
    expect(DAWN[DAWN.length - 1].p).toBe(1);
    for (let i = 1; i < DAWN.length; i++) {
      expect(DAWN[i].p, `stop ${i}`).toBeGreaterThan(DAWN[i - 1].p);
    }
  });

  it('ends the night exactly where Kaho ends', () => {
    expect(DAWN.some((s) => Math.abs(s.p - ACT_BOUNDS.ACT2_START) < 1e-9)).toBe(true);
  });

  it('gives the Crossing a first-light stop of its own', () => {
    const inAct2 = DAWN.filter(
      (s) => s.p > ACT_BOUNDS.ACT2_START && s.p < ACT_BOUNDS.ACT3_START,
    );
    expect(inAct2.length).toBeGreaterThanOrEqual(1);
    // and it must actually lift: ambient brighter than where Kaho ended
    const kahoEnd = DAWN.find((s) => Math.abs(s.p - ACT_BOUNDS.ACT2_START) < 1e-9)!;
    expect(inAct2[0].ambI).toBeGreaterThan(kahoEnd.ambI);
  });

  it('never drops below the obstacle-readability floor', () => {
    // this game is also an assessment: a cue that cannot be seen costs a real
    // stumble, so ambient light has a hard floor at every stop
    for (const s of DAWN) expect(s.ambI, `stop p=${s.p}`).toBeGreaterThanOrEqual(0.34);
  });

  it('keeps the sun behind the ridge until Dong', () => {
    for (let i = 1; i < DAWN.length; i++) {
      expect(DAWN[i].sunY).toBeGreaterThanOrEqual(DAWN[i - 1].sunY);
    }
    for (const s of DAWN) {
      if (s.p <= ACT_BOUNDS.ACT3_START) {
        expect(s.sunY, `sun already up at p=${s.p}`).toBeLessThan(0);
      }
    }
  });

  it('leaves the shipped sunrise payoff byte-identical', () => {
    // only the two early `p` values moved; from the violet stop on, nothing
    // about the sunrise changed — this pins that promise
    const tail = DAWN.filter((s) => s.p >= 0.68);
    expect(tail.map((s) => s.p)).toEqual([0.68, 0.75, 0.9, 1.0]);
    expect(tail.map((s) => s.sky)).toEqual([0x6b4a5e, 0xe8913a, 0xf5c542, 0xffcb5c]);
    expect(tail.map((s) => s.sunI)).toEqual([0.8, 1.35, 1.75, 1.95]);
    expect(tail.map((s) => s.ambI)).toEqual([0.74, 0.95, 1.2, 1.35]);
    expect(tail.map((s) => s.sunY)).toEqual([4, 20, 31, 40]);
  });
});
