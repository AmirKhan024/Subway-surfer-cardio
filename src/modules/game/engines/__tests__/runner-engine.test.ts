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

// ── drift guard + camera feel (M2) ─────────────────────────────────────────

describe('RunnerEngine — drift guard', () => {
  it('flags sustained scale drift and clears when the user recenters', () => {
    const engine = new RunnerEngine({ controlMode: 'pose', seed: 1337 });
    let t = calibrate(engine); // shoulderW 0.2 baseline
    engine.startPlaying();
    // user walks toward the camera: apparent shoulder width +40% (> 35% band)
    for (let i = 0; i < 75; i++) {
      t += FRAME_MS;
      engine.processFrame(makeFrame({ hipY: 0.6, shoulderW: 0.28 }), t);
    }
    expect(engine.getDriftState().drifting).toBe(true);
    // steps back to the calibrated distance
    for (let i = 0; i < 10; i++) {
      t += FRAME_MS;
      engine.processFrame(makeFrame({ hipY: 0.6, shoulderW: 0.2 }), t);
    }
    expect(engine.getDriftState().drifting).toBe(false);
  });

  it('brief scale wobble below the sustain window does NOT flag drift', () => {
    const engine = new RunnerEngine({ controlMode: 'pose', seed: 1337 });
    let t = calibrate(engine);
    engine.startPlaying();
    for (let i = 0; i < 20; i++) {
      // 660ms < 2s sustain
      t += FRAME_MS;
      engine.processFrame(makeFrame({ hipY: 0.6, shoulderW: 0.28 }), t);
    }
    expect(engine.getDriftState().drifting).toBe(false);
  });
});

describe('RunnerEngine — camera feel (hip-bob)', () => {
  it('dips the camera on squat and returns on stand', () => {
    const engine = new RunnerEngine({ controlMode: 'keyboard', seed: 1337 });
    engine.startPlaying();
    let t = 1000;
    const standing = () => engine.getSceneState().cameraY;
    for (let i = 0; i < 10; i++) {
      t += FRAME_MS;
      engine.processFrame([], t);
    }
    const eyeStanding = standing();
    engine.setControlInput({ crouchHeld: true });
    for (let i = 0; i < 30; i++) {
      t += FRAME_MS;
      engine.processFrame([], t);
    }
    expect(standing()).toBeLessThan(eyeStanding - 0.5); // dipped ~0.75m
    engine.setControlInput({ crouchHeld: false });
    for (let i = 0; i < 40; i++) {
      t += FRAME_MS;
      engine.processFrame([], t);
    }
    expect(standing()).toBeGreaterThan(eyeStanding - 0.05);
  });

  it('raises the camera during the jump arc', () => {
    const engine = new RunnerEngine({ controlMode: 'keyboard', seed: 1337 });
    engine.startPlaying();
    let t = 1000;
    for (let i = 0; i < 10; i++) {
      t += FRAME_MS;
      engine.processFrame([], t);
    }
    const eyeStanding = engine.getSceneState().cameraY;
    engine.setControlInput({ jumpPressed: true });
    let peak = eyeStanding;
    for (let i = 0; i < 21; i++) {
      t += FRAME_MS;
      engine.processFrame([], t);
      peak = Math.max(peak, engine.getSceneState().cameraY);
    }
    expect(peak).toBeGreaterThan(eyeStanding + 0.3);
  });
});

// ── keyboard/pose parity: a pose-driven bot clears the full course ─────────

describe('RunnerEngine — pose bot parity', () => {
  it('a scripted body (pose frames only) clears all 20 obstacles like the keyboard bot', () => {
    const engine = new RunnerEngine({ controlMode: 'pose', seed: 1337 });
    let t = calibrate(engine);
    engine.startPlaying();

    let hipY = 0.6;
    let jumpScript: number[] = []; // pending hipY frames for a jump
    let jumpedFor = -1;
    let frames = 0;

    while (!engine.isComplete() && frames < 12000) {
      frames++;
      t += FRAME_MS;
      const s = engine.getSceneState();
      const cue = s.cue;

      if (jumpScript.length > 0) {
        hipY = jumpScript.shift()!;
      } else if (cue?.type === 'beam') {
        hipY = Math.min(0.7, hipY + 0.015); // sink into a deep squat
      } else if (
        cue?.type === 'hurdle' &&
        cue.progress >= 0.75 &&
        jumpedFor !== cue.obstacleId
      ) {
        jumpedFor = cue.obstacleId;
        // takeoff ramp (fast up) + landing ramp back to baseline
        jumpScript = [...ramp(hipY, 0.42, 6), ...ramp(0.42, 0.6, 10)];
        hipY = jumpScript.shift()!;
      } else {
        hipY = Math.max(0.6, hipY - 0.02); // stand back up
      }

      engine.processFrame(makeFrame({ hipY }), t);
    }

    const raw = engine.getRawData();
    expect(engine.isComplete()).toBe(true);
    expect(raw.obstaclesCleared).toBe(20);
    expect(raw.obstaclesFailed).toBe(0);
    expect(raw.controlModeKeyboard).toBe(0);
    expect(raw.squatReps).toBeGreaterThanOrEqual(9); // one per beam (10), FSM-counted
    expect(raw.jumpReps).toBeGreaterThanOrEqual(10);
    expect(raw.avgReactionMs).toBeGreaterThan(0);
  });
});

// ── metrics math (M3) ──────────────────────────────────────────────────────

describe('RunnerEngine — metrics math', () => {
  it('perfect keyboard run has cleanFormRate 1.0 (full-depth holds + apex jumps)', () => {
    const engine = new RunnerEngine({ controlMode: 'keyboard', seed: 1337 });
    runKeyboardBot(engine, 'perfect');
    const raw = engine.getRawData();
    expect(raw.cleanFormRate).toBe(1);
    expect(raw.avgSquatDepth).toBeGreaterThan(0.95);
    expect(raw.avgJumpHeight).toBe(1); // keyboard arc apex, normalized
  });

  it('avgReactionMs matches a hand-scripted response delay', () => {
    const engine = new RunnerEngine({ controlMode: 'keyboard', seed: 1337 });
    engine.startPlaying();
    let t = 1000;
    // run until the first beam cue appears
    let cueAt = 0;
    while (cueAt === 0 && t < 120000) {
      t += FRAME_MS;
      engine.processFrame([], t);
      const cue = engine.getSceneState().cue;
      if (cue?.type === 'beam') cueAt = t;
      if (cue?.type === 'hurdle') {
        // clear hurdles reflexively so the run continues to a beam
        engine.setControlInput({ jumpPressed: true });
      }
    }
    expect(cueAt).toBeGreaterThan(0);
    // respond exactly 10 frames (~330ms) after the cue appeared
    for (let i = 0; i < 10; i++) {
      t += FRAME_MS;
      engine.processFrame([], t);
    }
    engine.setControlInput({ crouchHeld: true });
    for (let i = 0; i < 20; i++) {
      t += FRAME_MS;
      engine.processFrame([], t);
    }
    const raw = engine.getRawData();
    // squat reaction only (jump reactions belong to earlier hurdle cues, so
    // isolate: reaction list holds one entry per responded cue — assert the
    // scripted 330ms delay dominates the expected window)
    expect(raw.avgReactionMs).toBeGreaterThan(0);
    // the squat initiation fired 11 frames (363ms) after cue-shown ± a frame
    // (avg includes reflexive jump responses at ~1 frame each)
    expect(raw.squatReps + raw.jumpReps).toBeGreaterThan(0);
  });

  it('cleanFormRate separates cleared-but-not-clean squats (shallow holds)', () => {
    const engine = new RunnerEngine({ controlMode: 'pose', seed: 1337 });
    let t = calibrate(engine);
    engine.startPlaying();
    // shallow squat: peak crouch ≈ 0.6 — clears a beam gate (>0.55) but is
    // NOT clean (<0.75). drop needed: 0.15 + 0.6*0.35 = 0.36 → hipY +0.072
    t = drivePose(engine, t, ramp(0.6, 0.672, 12));
    t = drivePose(engine, t, Array(12).fill(0.672));
    t = drivePose(engine, t, ramp(0.672, 0.6, 12));
    t = drivePose(engine, t, Array(12).fill(0.6));
    const raw = engine.getRawData();
    expect(raw.squatReps).toBe(1);
    expect(raw.cleanFormRate).toBe(0); // rep counted, but not clean
    expect(raw.avgSquatDepth).toBeGreaterThan(0.5);
    expect(raw.avgSquatDepth).toBeLessThan(0.75);
  });

  it('elapsed tracks play time and distance matches speed × time roughly', () => {
    const engine = new RunnerEngine({ controlMode: 'keyboard', seed: 1337 });
    runKeyboardBot(engine, 'perfect');
    const raw = engine.getRawData();
    const avgSpeed = (COURSE.SPEED_START + COURSE.SPEED_END) / 2;
    const expected = (raw.elapsed / 1000) * avgSpeed;
    expect(raw.distance).toBeGreaterThan(expected * 0.8);
    expect(raw.distance).toBeLessThan(expected * 1.2);
  });
});

// ── head / neck-ROM control mode ───────────────────────────────────────────

/**
 * Seated synthetic frame: nose + shoulders (+ optionally ears) visible,
 * hips/ankles NOT visible. pitchK = (shoulderMidY − noseY) / shoulderW.
 */
function makeHeadFrame(opts: {
  pitchK?: number;
  shoulderW?: number;
  noseVisible?: boolean;
} = {}): NormalizedLandmark[] {
  const { pitchK = 0.5, shoulderW = 0.2, noseVisible = true } = opts;
  const lms: NormalizedLandmark[] = Array.from({ length: 33 }, () => ({
    x: 0.5,
    y: 0.5,
    z: 0,
    visibility: 0.1, // hips, knees, ankles, heels all invisible — seated close-up
  }));
  const shoulderMidY = 0.45;
  const noseY = shoulderMidY - pitchK * shoulderW;
  lms[LM.NOSE] = { x: 0.5, y: noseY, z: 0, visibility: noseVisible ? 0.95 : 0.1 };
  lms[LM.LEFT_SHOULDER] = { x: 0.5 - shoulderW / 2, y: shoulderMidY, z: 0, visibility: 0.95 };
  lms[LM.RIGHT_SHOULDER] = { x: 0.5 + shoulderW / 2, y: shoulderMidY, z: 0, visibility: 0.95 };
  lms[LM.LEFT_EAR] = { x: 0.47, y: noseY + 0.01, z: 0, visibility: 0.9 };
  lms[LM.RIGHT_EAR] = { x: 0.53, y: noseY + 0.01, z: 0, visibility: 0.9 };
  return lms;
}

function calibrateHead(engine: RunnerEngine, startT = 1000): number {
  let t = startT;
  for (let i = 0; i < 80; i++) {
    t += FRAME_MS;
    const st = engine.processCalibrationAt(makeHeadFrame(), t);
    if (st.isReady) return t;
  }
  throw new Error('head calibration never locked');
}

function driveHead(engine: RunnerEngine, t: number, pitchKs: number[]): number {
  for (const pitchK of pitchKs) {
    t += FRAME_MS;
    engine.processFrame(makeHeadFrame({ pitchK }), t);
  }
  return t;
}

describe('RunnerEngine — head mode calibration (seated)', () => {
  it('locks with only nose + shoulders visible (no ankles/hips — works seated)', () => {
    const engine = new RunnerEngine({ controlMode: 'head' });
    const t = calibrateHead(engine);
    expect(t).toBeGreaterThan(1000);
    expect(engine.processCalibration([]).isReady).toBe(true);
    const lock = engine.drainEvents().find((e) => e.tag === 'CALIB_LOCK');
    expect(lock).toBeDefined();
    expect(lock!.data.neckNeutral).toBeCloseTo(0.5, 1);
  });

  it('BODY pose mode does NOT lock on the same seated frames (ankles required)', () => {
    const engine = new RunnerEngine({ controlMode: 'pose' });
    let t = 1000;
    for (let i = 0; i < 80; i++) {
      t += FRAME_MS;
      expect(engine.processCalibrationAt(makeHeadFrame(), t).isReady).toBeFalsy();
    }
  });

  it('rejects when the nose is not visible', () => {
    const engine = new RunnerEngine({ controlMode: 'head' });
    let t = 1000;
    for (let i = 0; i < 80; i++) {
      t += FRAME_MS;
      const st = engine.processCalibrationAt(makeHeadFrame({ noseVisible: false }), t);
      expect(st.isReady).toBeFalsy();
    }
  });
});

describe('RunnerEngine — head mode detection', () => {
  it('a clean look-down counts a squat rep judged on RAW neck excursion', () => {
    const engine = new RunnerEngine({ controlMode: 'head', seed: 1337 });
    let t = calibrateHead(engine);
    engine.startPlaying();
    // flex to 0.20k (above FLEX_CLEAN 0.16), hold, return to neutral
    t = driveHead(engine, t, ramp(0.5, 0.3, 8));
    t = driveHead(engine, t, Array(15).fill(0.3));
    t = driveHead(engine, t, ramp(0.3, 0.5, 8));
    t = driveHead(engine, t, Array(15).fill(0.5));
    const raw = engine.getRawData();
    expect(raw.squatReps).toBe(1);
    expect(raw.cleanFormRate).toBe(1);
    expect(raw.avgNeckFlexion).toBeGreaterThan(0.16);
    expect(raw.testId).toBe('KR1N');
    expect(raw.controlScheme).toBe(2);
  });

  it('CLEARED-but-not-CLEAN: shallow look-down clears the crouch gate but cleanFormRate < 1', () => {
    const engine = new RunnerEngine({ controlMode: 'head', seed: 1337 });
    let t = calibrateHead(engine);
    engine.startPlaying();
    // flex target 0.125k: crouch peak ≈ (0.125-0.05)/0.12 = 0.63 > clear 0.55,
    // but 0.125 < FLEX_CLEAN 0.16 → clean must be false (the ONE clean
    // authority in head mode is raw neck excursion, not derived crouch)
    let crouchPeak = 0;
    t = driveHead(engine, t, ramp(0.5, 0.375, 8));
    for (let i = 0; i < 20; i++) {
      t += FRAME_MS;
      engine.processFrame(makeHeadFrame({ pitchK: 0.375 }), t);
      crouchPeak = Math.max(crouchPeak, engine.getSceneState().crouch);
    }
    t = driveHead(engine, t, ramp(0.375, 0.5, 8));
    t = driveHead(engine, t, Array(15).fill(0.5));
    const raw = engine.getRawData();
    expect(crouchPeak).toBeGreaterThan(0.55); // would clear a beam gate
    expect(raw.squatReps).toBe(1);
    expect(raw.cleanFormRate).toBe(0); // NOT clean — neck range too small
  });

  it('look-up fires the jump via POSITION edge-trigger and re-arms only after neutral', () => {
    const engine = new RunnerEngine({ controlMode: 'head', seed: 1337 });
    let t = calibrateHead(engine);
    engine.startPlaying();
    // extend to 0.10k (above EXT_RISE 0.08) — no velocity requirement
    t = driveHead(engine, t, ramp(0.5, 0.6, 6));
    t = driveHead(engine, t, Array(10).fill(0.6));
    expect(engine.getRawData().jumpReps).toBe(1);
    // staying extended / wiggling up must NOT re-trigger
    t = driveHead(engine, t, ramp(0.6, 0.55, 4));
    t = driveHead(engine, t, ramp(0.55, 0.62, 4));
    t = driveHead(engine, t, Array(30).fill(0.62));
    expect(engine.getRawData().jumpReps).toBe(1);
    // return to neutral → re-armed → second look-up (hold so the EMA crosses)
    t = driveHead(engine, t, ramp(0.62, 0.5, 8));
    t = driveHead(engine, t, Array(20).fill(0.5));
    t = driveHead(engine, t, ramp(0.5, 0.6, 6));
    t = driveHead(engine, t, Array(10).fill(0.6));
    expect(engine.getRawData().jumpReps).toBe(2);
  });

  it('a comfortable full look-up is clean; a minimal one is not', () => {
    const engine = new RunnerEngine({ controlMode: 'head', seed: 1337 });
    let t = calibrateHead(engine);
    engine.startPlaying();
    // full extension 0.20k ≥ EXT_CLEAN 0.14 (arc lands after 0.7s = ~22 frames)
    t = driveHead(engine, t, ramp(0.5, 0.7, 8));
    t = driveHead(engine, t, Array(25).fill(0.7));
    t = driveHead(engine, t, ramp(0.7, 0.5, 8));
    t = driveHead(engine, t, Array(15).fill(0.5));
    const raw = engine.getRawData();
    expect(raw.jumpReps).toBe(1);
    expect(raw.cleanFormRate).toBe(1);
    expect(raw.avgNeckExtension).toBeGreaterThanOrEqual(0.14);
  });
});

describe('RunnerEngine — head-bot clears the course (parity)', () => {
  it('a scripted head (pose frames only) clears all 20 obstacles', () => {
    const engine = new RunnerEngine({ controlMode: 'head', seed: 1337 });
    let t = calibrateHead(engine);
    engine.startPlaying();

    let pitchK = 0.5;
    let lookUpScript: number[] = [];
    let jumpedFor = -1;
    let frames = 0;

    while (!engine.isComplete() && frames < 12000) {
      frames++;
      t += FRAME_MS;
      const s = engine.getSceneState();
      const cue = s.cue;

      if (lookUpScript.length > 0) {
        pitchK = lookUpScript.shift()!;
      } else if (cue?.type === 'beam') {
        pitchK = Math.max(0.3, pitchK - 0.02); // look down into deep flexion
      } else if (
        cue?.type === 'hurdle' &&
        cue.progress >= 0.7 &&
        jumpedFor !== cue.obstacleId
      ) {
        jumpedFor = cue.obstacleId;
        // gentle look-up, hold through the gate, return to neutral
        lookUpScript = [...ramp(pitchK, 0.68, 5), ...Array(14).fill(0.68), ...ramp(0.68, 0.5, 6)];
        pitchK = lookUpScript.shift()!;
      } else {
        pitchK = Math.min(0.5, pitchK + 0.02); // settle back to neutral
      }

      engine.processFrame(makeHeadFrame({ pitchK }), t);
    }

    const raw = engine.getRawData();
    expect(engine.isComplete()).toBe(true);
    expect(raw.obstaclesCleared).toBe(20);
    expect(raw.obstaclesFailed).toBe(0);
    expect(raw.testId).toBe('KR1N');
    expect(raw.controlScheme).toBe(2);
    // all-finite invariant holds for head runs too
    for (const [key, value] of Object.entries(raw)) {
      if (key === 'testId') continue;
      expect(Number.isFinite(value as number), `${key} must be finite`).toBe(true);
    }
  });
});

// ── diagnostic events (drained by the layer) ───────────────────────────────

describe('RunnerEngine — diagnostic events', () => {
  it('a full run emits RUN_RESET, OBSTACLE per obstacle with gate values, REP per rep, RUN_DONE', () => {
    const engine = new RunnerEngine({ controlMode: 'keyboard', seed: 1337 });
    runKeyboardBot(engine, 'perfect');
    const events = engine.drainEvents();
    const tags = events.map((e) => e.tag);
    expect(tags).toContain('RUN_RESET');
    expect(tags).toContain('RUN_DONE');
    const obstacles = events.filter((e) => e.tag === 'OBSTACLE');
    expect(obstacles).toHaveLength(20);
    for (const ob of obstacles) {
      expect(ob.data.cleared).toBe(true);
      expect(typeof ob.data.crouchAtGate).toBe('number');
      expect(typeof ob.data.jumpYAtGate).toBe('number');
      expect(typeof ob.data.livesLeft).toBe('number');
    }
    const reps = events.filter((e) => e.tag === 'REP');
    expect(reps.length).toBeGreaterThanOrEqual(20);
    for (const rep of reps) {
      expect(['squat', 'jump', 'heel']).toContain(rep.data.kind);
      expect(typeof rep.data.clean).toBe('boolean');
    }
  });

  it('failed obstacles carry the gate values that explain the miss', () => {
    const engine = new RunnerEngine({ controlMode: 'keyboard', seed: 1337 });
    runKeyboardBot(engine, 'idle');
    const obstacles = engine.drainEvents().filter((e) => e.tag === 'OBSTACLE');
    expect(obstacles).toHaveLength(3); // 3 lives burned
    for (const ob of obstacles) {
      expect(ob.data.cleared).toBe(false);
      expect(ob.data.crouchAtGate).toBe(0);
      expect(ob.data.jumpYAtGate).toBe(0);
    }
  });

  it('drainEvents clears the buffer (second drain is empty)', () => {
    const engine = new RunnerEngine({ controlMode: 'keyboard', seed: 1337 });
    runKeyboardBot(engine, 'perfect');
    expect(engine.drainEvents().length).toBeGreaterThan(0);
    expect(engine.drainEvents()).toHaveLength(0);
  });

  it('calibration lock emits CALIB_LOCK with the captured baseline', () => {
    const engine = new RunnerEngine({ controlMode: 'pose', seed: 1337 });
    calibrate(engine);
    const lock = engine.drainEvents().find((e) => e.tag === 'CALIB_LOCK');
    expect(lock).toBeDefined();
    expect(lock!.data.hipY0).toBeCloseTo(0.6, 1);
    expect(lock!.data.shoulderW0).toBeCloseTo(0.2, 1);
  });

  it('sustained drift emits DRIFT_ON then DRIFT_OFF on recenter', () => {
    const engine = new RunnerEngine({ controlMode: 'pose', seed: 1337 });
    let t = calibrate(engine);
    engine.startPlaying();
    engine.drainEvents();
    for (let i = 0; i < 75; i++) {
      t += FRAME_MS;
      engine.processFrame(makeFrame({ hipY: 0.6, shoulderW: 0.28 }), t);
    }
    for (let i = 0; i < 10; i++) {
      t += FRAME_MS;
      engine.processFrame(makeFrame({ hipY: 0.6, shoulderW: 0.2 }), t);
    }
    const tags = engine.drainEvents().map((e) => e.tag);
    expect(tags).toContain('DRIFT_ON');
    expect(tags).toContain('DRIFT_OFF');
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
