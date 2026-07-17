/**
 * RunnerEngine headless tests — deterministic clock (timestamps passed
 * explicitly; the engine never reads performance.now()), synthetic
 * 33-landmark frames for the pose path, scripted ControlInput for the
 * keyboard path. Harness pattern per new_kriya_move's engine tests.
 */
import { describe, it, expect } from 'vitest';
import { RunnerEngine } from '../runner-engine';
import {
  generateCourse,
  speedAtIndex,
  mulberry32,
  seedForAttempt,
} from '../runner-timeline';
import { COURSE, DETECT, CALIB } from '@/components/games/runner/runner-constants';
import type { NormalizedLandmark } from '../types';
import { LM } from '../types';

const FRAME_MS = 33;

// ── synthetic landmark builder ─────────────────────────────────────────────

function makeFrame(opts: {
  hipY?: number;
  shoulderW?: number;
  visible?: boolean;
  heelLiftK?: number;
} = {}): NormalizedLandmark[] {
  const { hipY = 0.6, shoulderW = 0.2, visible = true, heelLiftK = 0 } = opts;
  const vis = visible ? 0.95 : 0.1;
  const lms: NormalizedLandmark[] = Array.from({ length: 33 }, () => ({
    x: 0.5,
    y: 0.5,
    z: 0,
    visibility: vis,
  }));
  const set = (i: number, x: number, y: number) => {
    lms[i] = { x, y, z: 0, visibility: vis };
  };
  set(LM.NOSE, 0.5, hipY - 0.42);
  set(LM.LEFT_SHOULDER, 0.5 - shoulderW / 2, hipY - 0.3);
  set(LM.RIGHT_SHOULDER, 0.5 + shoulderW / 2, hipY - 0.3);
  set(LM.LEFT_HIP, 0.46, hipY);
  set(LM.RIGHT_HIP, 0.54, hipY);
  set(LM.LEFT_KNEE, 0.46, hipY + 0.18);
  set(LM.RIGHT_KNEE, 0.54, hipY + 0.18);
  set(LM.LEFT_ANKLE, 0.46, hipY + 0.34);
  set(LM.RIGHT_ANKLE, 0.54, hipY + 0.34);
  const heelY = hipY + 0.36 - heelLiftK * shoulderW;
  set(LM.LEFT_HEEL, 0.45, heelY);
  set(LM.RIGHT_HEEL, 0.55, heelY);
  return lms;
}

/** Feed standing frames until calibration locks; returns the clock. */
function calibrate(engine: RunnerEngine, startT = 1000, hipY = 0.6): number {
  let t = startT;
  for (let i = 0; i < 80; i++) {
    t += FRAME_MS;
    const st = engine.processCalibrationAt(makeFrame({ hipY }), t);
    if (st.isReady) return t;
  }
  throw new Error('calibration never locked');
}

/** Drive pose frames along a hipY path (one frame per FRAME_MS). */
function drivePose(
  engine: RunnerEngine,
  t: number,
  hipYs: number[],
  extra: Partial<Parameters<typeof makeFrame>[0]> = {},
): number {
  for (const hipY of hipYs) {
    t += FRAME_MS;
    engine.processFrame(makeFrame({ hipY, ...extra }), t);
  }
  return t;
}

/** Linear ramp helper. */
function ramp(from: number, to: number, frames: number): number[] {
  return Array.from({ length: frames }, (_, i) => from + ((to - from) * (i + 1)) / frames);
}

// ── timeline ───────────────────────────────────────────────────────────────

describe('runner-timeline', () => {
  it('is deterministic per seed', () => {
    expect(generateCourse(1337)).toEqual(generateCourse(1337));
    expect(generateCourse(1337)).not.toEqual(generateCourse(2861));
  });

  it('every pool seed yields a matched-difficulty course', () => {
    for (const seed of COURSE.SEED_POOL) {
      const course = generateCourse(seed);
      expect(course).toHaveLength(COURSE.OBSTACLES);
      const hurdles = course.filter((o) => o.type === 'hurdle').length;
      expect(hurdles).toBe(COURSE.OBSTACLES / 2);
      for (let i = 1; i < course.length; i++) {
        const gapSeconds =
          (course[i].atDistance - course[i - 1].atDistance) / speedAtIndex(i - 1);
        expect(gapSeconds).toBeGreaterThanOrEqual(COURSE.MIN_GAP_S - 1e-9);
      }
      // movement-paced: never 3 identical types in a row
      for (let i = 2; i < course.length; i++) {
        const same =
          course[i].type === course[i - 1].type && course[i].type === course[i - 2].type;
        expect(same).toBe(false);
      }
    }
  });

  it('mulberry32 is deterministic and in [0,1)', () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    for (let i = 0; i < 100; i++) {
      const v = a();
      expect(v).toBe(b());
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('seedForAttempt rotates the pool starting at the assessment seed', () => {
    expect(seedForAttempt(0)).toBe(COURSE.ASSESSMENT_SEED);
    expect(seedForAttempt(1)).toBe(COURSE.SEED_POOL[1]);
    expect(seedForAttempt(COURSE.SEED_POOL.length)).toBe(COURSE.ASSESSMENT_SEED);
  });
});

// ── keyboard mode: world sim, gates, lives ─────────────────────────────────

/** Perfect-player bot: squat on beam cues, jump near hurdle planes. */
function runKeyboardBot(
  engine: RunnerEngine,
  behavior: 'perfect' | 'idle',
): { frames: number } {
  engine.startPlaying();
  let t = 1000;
  let jumpedFor = -1;
  let frames = 0;
  while (!engine.isComplete() && frames < 12000) {
    frames++;
    t += FRAME_MS;
    if (behavior === 'perfect') {
      const s = engine.getSceneState();
      const cue = s.cue;
      engine.setControlInput({ crouchHeld: cue?.type === 'beam' });
      if (cue?.type === 'hurdle' && cue.progress >= 0.8 && jumpedFor !== cue.obstacleId) {
        jumpedFor = cue.obstacleId;
        engine.setControlInput({ jumpPressed: true });
      }
    }
    engine.processFrame([], t);
  }
  return { frames };
}

describe('RunnerEngine — keyboard mode', () => {
  it('is instantly calibrated (no camera)', () => {
    const engine = new RunnerEngine({ controlMode: 'keyboard' });
    expect(engine.processCalibration([]).isReady).toBe(true);
  });

  it('perfect play clears the whole 20-obstacle course with 3 lives intact', () => {
    const engine = new RunnerEngine({ controlMode: 'keyboard', seed: 1337 });
    runKeyboardBot(engine, 'perfect');
    expect(engine.isComplete()).toBe(true);
    const raw = engine.getRawData();
    expect(raw.obstaclesTotal).toBe(20);
    expect(raw.obstaclesCleared).toBe(20);
    expect(raw.obstaclesFailed).toBe(0);
    expect(engine.getSceneState().lives).toBe(3);
    expect(raw.distance).toBeGreaterThan(0);
    expect(raw.controlModeKeyboard).toBe(1);
  });

  it('standing idle burns exactly 3 lives then ends the run', () => {
    const engine = new RunnerEngine({ controlMode: 'keyboard', seed: 1337 });
    runKeyboardBot(engine, 'idle');
    expect(engine.isComplete()).toBe(true);
    const raw = engine.getRawData();
    expect(raw.obstaclesFailed).toBe(3);
    expect(raw.obstaclesCleared).toBe(0);
    expect(engine.getSceneState().lives).toBe(0);
    // remaining obstacles stay unresolved
    expect(raw.obstaclesCleared + raw.obstaclesFailed).toBeLessThan(raw.obstaclesTotal);
  });

  it('perfect run works on every pool seed (matched difficulty)', () => {
    for (const seed of COURSE.SEED_POOL) {
      const engine = new RunnerEngine({ controlMode: 'keyboard', seed });
      runKeyboardBot(engine, 'perfect');
      expect(engine.getRawData().obstaclesCleared).toBe(20);
    }
  });

  it('telegraphs the cue within the cue window', () => {
    const engine = new RunnerEngine({ controlMode: 'keyboard', seed: 1337 });
    engine.startPlaying();
    let t = 1000;
    let firstCueSeen: { timeToPlane: number } | null = null;
    while (!firstCueSeen && t < 60000) {
      t += FRAME_MS;
      engine.processFrame([], t);
      const s = engine.getSceneState();
      if (s.cue) {
        const ob = s.obstacles.find((o) => o.id === s.cue!.obstacleId)!;
        firstCueSeen = { timeToPlane: ob.zAhead / s.speed };
      }
    }
    expect(firstCueSeen).not.toBeNull();
    expect(firstCueSeen!.timeToPlane).toBeLessThanOrEqual(COURSE.CUE_WINDOW_S + 0.05);
    expect(firstCueSeen!.timeToPlane).toBeGreaterThan(COURSE.CUE_WINDOW_S - 0.3);
  });

  it('counts keyboard reps through the same FSM path', () => {
    const engine = new RunnerEngine({ controlMode: 'keyboard', seed: 1337 });
    engine.startPlaying();
    let t = 1000;
    // one full squat: hold 600ms, release 600ms
    engine.setControlInput({ crouchHeld: true });
    for (let i = 0; i < 18; i++) {
      t += FRAME_MS;
      engine.processFrame([], t);
    }
    engine.setControlInput({ crouchHeld: false });
    for (let i = 0; i < 18; i++) {
      t += FRAME_MS;
      engine.processFrame([], t);
    }
    // one jump (arc lands after 0.7s)
    engine.setControlInput({ jumpPressed: true });
    for (let i = 0; i < 30; i++) {
      t += FRAME_MS;
      engine.processFrame([], t);
    }
    const raw = engine.getRawData();
    expect(raw.squatReps).toBe(1);
    expect(raw.jumpReps).toBe(1);
    expect(raw.avgSquatDepth).toBeGreaterThan(0.9); // held to full crouch
  });
});

// ── pose mode: calibration ─────────────────────────────────────────────────

describe('RunnerEngine — calibration (pose)', () => {
  it('locks after a stable full-body hold', () => {
    const engine = new RunnerEngine({ controlMode: 'pose' });
    const t = calibrate(engine);
    expect(t - 1000).toBeGreaterThanOrEqual(CALIB.HOLD_MS);
    expect(engine.processCalibration([]).isReady).toBe(true);
  });

  it('never locks without a visible full body', () => {
    const engine = new RunnerEngine({ controlMode: 'pose' });
    let t = 1000;
    for (let i = 0; i < 100; i++) {
      t += FRAME_MS;
      const st = engine.processCalibrationAt(makeFrame({ visible: false }), t);
      expect(st.isReady).toBeFalsy();
    }
  });

  it('a mid-hold wobble restarts the hold', () => {
    const engine = new RunnerEngine({ controlMode: 'pose' });
    let t = 1000;
    for (let i = 0; i < 30; i++) {
      t += FRAME_MS;
      engine.processCalibrationAt(makeFrame({ hipY: 0.6 }), t);
    }
    // big hip jump: wobble
    t += FRAME_MS;
    const st = engine.processCalibrationAt(makeFrame({ hipY: 0.68 }), t);
    expect(st.isReady).toBeFalsy();
    expect((st.progress ?? 1) < 0.3).toBe(true);
  });
});

// ── pose mode: squat / jump detection ──────────────────────────────────────

describe('RunnerEngine — pose detection', () => {
  it('detects a full squat rep with return-to-neutral', () => {
    const engine = new RunnerEngine({ controlMode: 'pose', seed: 1337 });
    let t = calibrate(engine);
    engine.startPlaying();
    // descend well past clear depth (drop 0.45k = hipY +0.09), hold, return
    t = drivePose(engine, t, ramp(0.6, 0.69, 12));
    t = drivePose(engine, t, Array(10).fill(0.69));
    t = drivePose(engine, t, ramp(0.69, 0.6, 12));
    t = drivePose(engine, t, Array(10).fill(0.6));
    const raw = engine.getRawData();
    expect(raw.squatReps).toBe(1);
    expect(raw.avgSquatDepth).toBeGreaterThan(0.5);
  });

  it('a bounce at the bottom does not double-count the rep', () => {
    const engine = new RunnerEngine({ controlMode: 'pose', seed: 1337 });
    let t = calibrate(engine);
    engine.startPlaying();
    t = drivePose(engine, t, ramp(0.6, 0.69, 12));
    t = drivePose(engine, t, ramp(0.69, 0.645, 6)); // partial rise, still > engage
    t = drivePose(engine, t, ramp(0.645, 0.69, 6)); // bounce back down
    t = drivePose(engine, t, ramp(0.69, 0.6, 12));
    t = drivePose(engine, t, Array(10).fill(0.6));
    expect(engine.getRawData().squatReps).toBe(1);
  });

  it('detects a jump on takeoff and re-arms only after return-to-neutral', () => {
    const engine = new RunnerEngine({ controlMode: 'pose', seed: 1337 });
    let t = calibrate(engine);
    engine.startPlaying();
    // fast upward hip ramp: 0.6 → 0.42 over ~230ms (≈0.78 raw u/s, ~3.9 k/s)
    t = drivePose(engine, t, ramp(0.6, 0.42, 7));
    expect(engine.getRawData().jumpReps).toBe(1);
    // still airborne / not returned: another up-flick must NOT re-trigger
    t = drivePose(engine, t, ramp(0.42, 0.5, 3));
    t = drivePose(engine, t, ramp(0.5, 0.42, 3));
    expect(engine.getRawData().jumpReps).toBe(1);
    // land + settle at baseline → re-armed → jump again
    t = drivePose(engine, t, ramp(0.42, 0.6, 8));
    t = drivePose(engine, t, Array(30).fill(0.6));
    t = drivePose(engine, t, ramp(0.6, 0.42, 7));
    expect(engine.getRawData().jumpReps).toBe(2);
  });

  it('low-impact heel-raise triggers the same game-space arc', () => {
    const engine = new RunnerEngine({ controlMode: 'pose', seed: 1337, lowImpact: true });
    let t = calibrate(engine);
    engine.startPlaying();
    // heels rise to 0.12k (above trigger 0.06 and clean 0.10)
    t = drivePose(engine, t, [0.6, 0.6, 0.6], {});
    for (const lift of [0.02, 0.05, 0.08, 0.11, 0.12, 0.12, 0.12]) {
      t += FRAME_MS;
      engine.processFrame(makeFrame({ hipY: 0.6, heelLiftK: lift }), t);
    }
    expect(engine.getRawData().jumpReps).toBe(1);
    expect(engine.getRawData().lowImpact).toBe(1);
  });

  it('tracking loss decays crouch instead of freezing a phantom squat-hold', () => {
    const engine = new RunnerEngine({ controlMode: 'pose', seed: 1337 });
    let t = calibrate(engine);
    engine.startPlaying();
    t = drivePose(engine, t, ramp(0.6, 0.69, 12)); // deep squat
    t = drivePose(engine, t, Array(10).fill(0.69)); // hold — let the EMA converge
    expect(engine.getSceneState().crouch).toBeGreaterThan(0.5);
    // landmarks vanish for a second
    for (let i = 0; i < 30; i++) {
      t += FRAME_MS;
      engine.processFrame([], t);
    }
    expect(engine.getSceneState().crouch).toBe(0);
    expect(engine.isTracking()).toBe(false);
  });
});

// ── raw data invariant ─────────────────────────────────────────────────────

describe('RunnerRawData invariant', () => {
  it('every field except testId is a finite number (perfect + idle + fresh)', () => {
    const engines = [
      new RunnerEngine({ controlMode: 'keyboard', seed: 1337 }),
      new RunnerEngine({ controlMode: 'keyboard', seed: 2861 }),
      new RunnerEngine({ controlMode: 'keyboard', seed: 4242 }),
    ];
    runKeyboardBot(engines[0], 'perfect');
    runKeyboardBot(engines[1], 'idle');
    // engines[2] untouched — fresh engine must still emit finite data
    for (const engine of engines) {
      const raw = engine.getRawData();
      for (const [key, value] of Object.entries(raw)) {
        if (key === 'testId') {
          expect(value).toBe('KR1');
        } else {
          expect(typeof value, key).toBe('number');
          expect(Number.isFinite(value), `${key} must be finite`).toBe(true);
        }
      }
    }
  });

  it('assessmentValid flags short runs as 0 and full runs as 1', () => {
    const idle = new RunnerEngine({ controlMode: 'keyboard', seed: 1337 });
    runKeyboardBot(idle, 'idle');
    expect(idle.getRawData().assessmentValid).toBe(0);

    const perfect = new RunnerEngine({ controlMode: 'keyboard', seed: 1337 });
    runKeyboardBot(perfect, 'perfect');
    expect(perfect.getRawData().assessmentValid).toBe(1);
  });
});
