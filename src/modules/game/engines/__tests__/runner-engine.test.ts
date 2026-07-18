/**
 * RunnerEngine headless tests — deterministic clock (timestamps passed
 * explicitly; the engine never reads performance.now()), synthetic
 * 33-landmark frames for the pose path, scripted ControlInput for the
 * keyboard path. Harness pattern per new_kriya_move's engine tests.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { RunnerEngine } from '../runner-engine';
import {
  generateCourse,
  generateChunk,
  generateCoins,
  speedAtDistance,
  mulberry32,
  seedForAttempt,
} from '../runner-timeline';
import { COURSE, DETECT, CALIB, COIN, LOCO } from '@/components/games/runner/runner-constants';
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

  it('every pool seed yields a matched-difficulty chunk (endless stream)', () => {
    for (const seed of COURSE.SEED_POOL) {
      const course = generateCourse(seed);
      expect(course).toHaveLength(COURSE.OBSTACLES);
      const hurdles = course.filter((o) => o.type === 'hurdle').length;
      expect(hurdles).toBe(COURSE.OBSTACLES / 2);
      for (let i = 1; i < course.length; i++) {
        const gapSeconds =
          (course[i].atDistance - course[i - 1].atDistance) /
          speedAtDistance(course[i - 1].atDistance);
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

  it('chunks are deterministic, id-continuous, and movement-paced at the seam', () => {
    const c0 = generateChunk(1337, 0, COURSE.LEAD_IN_M, 0);
    const c1a = generateChunk(1337, 1, c0[c0.length - 1].atDistance, c0.length);
    const c1b = generateChunk(1337, 1, c0[c0.length - 1].atDistance, c0.length);
    expect(c1a).toEqual(c1b); // reproducible per (seed, chunk)
    expect(c1a[0].id).toBe(c0.length); // globally unique ids for scene keys
    // seam gap is paced like any other gap
    const seamGapS =
      (c1a[0].atDistance - c0[c0.length - 1].atDistance) /
      speedAtDistance(c0[c0.length - 1].atDistance);
    expect(seamGapS).toBeGreaterThanOrEqual(COURSE.MIN_GAP_S - 1e-9);
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

// ── coins (engagement only) ────────────────────────────────────────────────

describe('runner-timeline — coins', () => {
  it('is deterministic per seed and independent of the obstacle stream', () => {
    const obstacles = generateCourse(1337);
    expect(generateCoins(1337, obstacles)).toEqual(generateCoins(1337, obstacles));
    expect(generateCoins(1337, obstacles)).not.toEqual(generateCoins(2861, obstacles));
    // coin generation must not perturb the course itself
    expect(generateCourse(1337)).toEqual(obstacles);
  });

  it('ground coins stay clear of every action plane; aerials sit just past hurdles', () => {
    for (const seed of COURSE.SEED_POOL) {
      const obstacles = generateCourse(seed);
      const coins = generateCoins(seed, obstacles);
      expect(coins.length).toBeGreaterThan(20);
      const hurdlePlanes = new Set(
        obstacles.filter((o) => o.type === 'hurdle').map((o) => o.atDistance),
      );
      for (const coin of coins) {
        if (coin.aerial) {
          const owner = coin.atDistance - COIN.AERIAL_OFFSET_M;
          expect(hurdlePlanes.has(owner), `aerial coin ${coin.id} must sit past a hurdle`).toBe(true);
        } else {
          for (const ob of obstacles) {
            expect(
              Math.abs(coin.atDistance - ob.atDistance),
              `ground coin ${coin.id} too close to obstacle ${ob.id}`,
            ).toBeGreaterThanOrEqual(COIN.CLEARANCE_M - 1e-9);
          }
        }
      }
    }
  });
});

describe('RunnerEngine — coin collection', () => {
  it('perfect run collects a deterministic count including every aerial coin', () => {
    const a = new RunnerEngine({ controlMode: 'keyboard', seed: 1337 });
    runKeyboardBot(a, 'perfect');
    const b = new RunnerEngine({ controlMode: 'keyboard', seed: 1337 });
    runKeyboardBot(b, 'perfect');
    const rawA = a.getRawData();
    expect(rawA.coinsCollected).toBe(b.getRawData().coinsCollected);
    expect(rawA.coinsCollected).toBeGreaterThan(0);
    // the perfect bot jumps every hurdle with the arc high at +0.5m, so all
    // 10 aerial coins are included: count must exceed the ground-only total
    const idle = new RunnerEngine({ controlMode: 'keyboard', seed: 1337 });
    runKeyboardBot(idle, 'idle');
    const idleRaw = idle.getRawData();
    // idle dies at obstacle 3 but still auto-collects ground coins it passed
    expect(idleRaw.coinsCollected).toBeGreaterThanOrEqual(0);
    expect(idleRaw.coinsCollected).toBeLessThan(rawA.coinsCollected);
  });

  it('an idle player never grabs aerial coins (no jump = arc never high)', () => {
    const engine = new RunnerEngine({ controlMode: 'keyboard', seed: 1337 });
    runKeyboardBot(engine, 'idle');
    const coinEvents = engine
      .drainEvents()
      .filter((e) => e.tag === 'COIN')
      .map((e) => e.data as { aerial: boolean });
    for (const c of coinEvents) expect(c.aerial).toBe(false);
  });

  it('emits COIN events and SQUAT_START before the first SQUAT rep', () => {
    const engine = new RunnerEngine({ controlMode: 'keyboard', seed: 1337 });
    runKeyboardBot(engine, 'perfect');
    const events = engine.drainEvents();
    const tags = events.map((e) => e.tag);
    expect(tags).toContain('COIN');
    const squatStart = tags.indexOf('SQUAT_START');
    const firstSquatRep = events.findIndex(
      (e) => e.tag === 'REP' && (e.data as { kind: string }).kind === 'squat',
    );
    expect(squatStart).toBeGreaterThanOrEqual(0);
    expect(firstSquatRep).toBeGreaterThan(squatStart);
  });
});

describe('engine purity — audio never enters the engine', () => {
  it('runner-engine.ts has no audio import', () => {
    const src = readFileSync(new URL('../runner-engine.ts', import.meta.url), 'utf8');
    expect(src.includes('audio-manager')).toBe(false);
    expect(src.includes('AudioContext')).toBe(false);
  });
});

// ── keyboard mode: world sim, gates, lives ─────────────────────────────────

/** Perfect-player bot: squat on beam cues, jump near hurdle planes.
 *  Endless mode: a 60s session bounds every bot run (lives may end sooner). */
function runKeyboardBot(
  engine: RunnerEngine,
  behavior: 'perfect' | 'idle',
): { frames: number } {
  engine.setSessionMs(60_000);
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

  it('perfect play survives the full session with 3 lives intact (endless)', () => {
    const engine = new RunnerEngine({ controlMode: 'keyboard', seed: 1337 });
    runKeyboardBot(engine, 'perfect');
    expect(engine.isComplete()).toBe(true);
    expect(engine.getEndReason()).toBe('time'); // never 'lives' for a perfect run
    const raw = engine.getRawData();
    expect(raw.obstaclesCleared).toBeGreaterThanOrEqual(15); // ~60s of obstacles
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
      expect(engine.getRawData().obstaclesFailed).toBe(0);
      expect(engine.getRawData().obstaclesCleared).toBeGreaterThanOrEqual(15);
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
  it('a scripted body (pose frames only) clears obstacles like the keyboard bot', () => {
    const engine = new RunnerEngine({ controlMode: 'pose', seed: 1337 });
    let t = calibrate(engine);
    engine.setSessionMs(60_000);
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
    expect(raw.obstaclesCleared).toBeGreaterThanOrEqual(12);
    expect(raw.obstaclesFailed).toBe(0);
    expect(raw.controlModeKeyboard).toBe(0);
    expect(raw.squatReps).toBeGreaterThanOrEqual(6); // one per beam, FSM-counted
    expect(raw.jumpReps).toBeGreaterThanOrEqual(6);
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
    // release so the squat rep completes (reps bank on return-to-neutral)
    engine.setControlInput({ crouchHeld: false });
    for (let i = 0; i < 20; i++) {
      t += FRAME_MS;
      engine.processFrame([], t);
    }
    const raw = engine.getRawData();
    // the squat initiation fired 11 frames (~363ms) after cue-shown ± a frame
    expect(raw.avgReactionMs).toBeGreaterThan(300);
    expect(raw.avgReactionMs).toBeLessThan(500);
    expect(raw.squatReps).toBeGreaterThanOrEqual(1);
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

// ── intent-based jump clear (forgiving window) ─────────────────────────────

/**
 * Keyboard bot that plays perfectly EXCEPT the first hurdle, where jump
 * timing is scripted: `atTtaS` jumps that many seconds BEFORE the plane;
 * `atMsPast` jumps that many ms AFTER the crossing; neither → never jumps it.
 */
function runFirstHurdleTimingBot(
  engine: RunnerEngine,
  timing: { atTtaS?: number; atMsPast?: number },
): { firstHurdleId: number; obstacleEvents: Map<number, Record<string, unknown>> } {
  engine.setSessionMs(60_000); // endless mode: the session bounds the run
  engine.startPlaying();
  let t = 1000;
  let frames = 0;
  let firstHurdleId = -1;
  let jumpedFirst = false;
  let jumpedFor = -1;
  // scene state is WINDOWED in endless mode (passed obstacles drop out), so
  // final assertions come from the OBSTACLE event stream, not the scene
  const obstacleEvents = new Map<number, Record<string, unknown>>();
  while (!engine.isComplete() && frames < 12000) {
    frames++;
    t += FRAME_MS;
    const s = engine.getSceneState();
    if (firstHurdleId === -1) {
      const hurdles = s.obstacles.filter((o) => o.type === 'hurdle');
      firstHurdleId = hurdles.reduce((a, b) => (a.zAhead < b.zAhead ? a : b)).id;
    }
    const first = s.obstacles.find((o) => o.id === firstHurdleId);
    const cue = s.cue;
    engine.setControlInput({ crouchHeld: cue?.type === 'beam' });

    if (!jumpedFirst && first && !first.resolved) {
      if (timing.atTtaS !== undefined && first.zAhead > 0 && first.zAhead / s.speed <= timing.atTtaS) {
        jumpedFirst = true;
        engine.setControlInput({ jumpPressed: true });
      }
      if (
        timing.atMsPast !== undefined &&
        first.zAhead <= 0 &&
        (-first.zAhead / s.speed) * 1000 >= timing.atMsPast
      ) {
        jumpedFirst = true;
        engine.setControlInput({ jumpPressed: true });
      }
    }
    if (cue?.type === 'hurdle' && cue.obstacleId !== firstHurdleId && cue.progress >= 0.8 && jumpedFor !== cue.obstacleId) {
      jumpedFor = cue.obstacleId;
      engine.setControlInput({ jumpPressed: true });
    }
    engine.processFrame([], t);
    for (const e of engine.drainEvents()) {
      if (e.tag === 'OBSTACLE') obstacleEvents.set(e.data.id as number, e.data);
    }
  }
  return { firstHurdleId, obstacleEvents };
}

describe('RunnerEngine — intent-based hurdle clearing', () => {
  it("REGRESSION (Govind's bug): a jump initiated 0.70s before the plane now CLEARS", () => {
    const engine = new RunnerEngine({ controlMode: 'keyboard', seed: 1337 });
    const { firstHurdleId, obstacleEvents } = runFirstHurdleTimingBot(engine, { atTtaS: 0.7 });
    expect(obstacleEvents.get(firstHurdleId)?.cleared).toBe(true);
    expect(engine.getRawData().obstaclesFailed).toBe(0);
  });

  it('a jump ~100ms AFTER the crossing retro-clears within the grace window', () => {
    const engine = new RunnerEngine({ controlMode: 'keyboard', seed: 1337 });
    const { firstHurdleId, obstacleEvents } = runFirstHurdleTimingBot(engine, { atMsPast: 100 });
    const first = obstacleEvents.get(firstHurdleId)!;
    expect(first.cleared).toBe(true);
    expect(first.retroCleared).toBe(true);
    expect(engine.getRawData().obstaclesFailed).toBe(0);
  });

  it('no jump at all still fails the hurdle (after the grace) — honesty preserved', () => {
    const engine = new RunnerEngine({ controlMode: 'keyboard', seed: 1337 });
    const { firstHurdleId, obstacleEvents } = runFirstHurdleTimingBot(engine, {});
    const first = obstacleEvents.get(firstHurdleId)!;
    expect(first.cleared).toBe(false);
    expect(first.graceExpired).toBe(true);
    expect(engine.getRawData().obstaclesFailed).toBe(1);
  });

  it('re-arm forgiveness: landing into a slight crouch no longer wedges the jump disarmed', () => {
    const engine = new RunnerEngine({ controlMode: 'pose', seed: 1337 });
    let t = calibrate(engine);
    engine.startPlaying();
    // jump 1
    t = drivePose(engine, t, ramp(0.6, 0.42, 7));
    expect(engine.getRawData().jumpReps).toBe(1);
    // land into a SLIGHT crouch: drop 0.10 (> old 0.08 neutral band, < 0.15)
    t = drivePose(engine, t, ramp(0.42, 0.62, 8));
    t = drivePose(engine, t, Array(30).fill(0.62));
    // jump 2 from the slightly-crouched stance must still trigger
    t = drivePose(engine, t, ramp(0.62, 0.42, 7));
    expect(engine.getRawData().jumpReps).toBe(2);
  });

  it('head mode: an early look-up (short, returned to neutral) still clears every hurdle', () => {
    const engine = new RunnerEngine({ controlMode: 'head', seed: 1337 });
    let t = calibrateHead(engine);
    engine.setSessionMs(60_000);
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
        pitchK = Math.max(0.3, pitchK - 0.02);
      } else if (cue?.type === 'hurdle' && cue.progress >= 0.65 && jumpedFor !== cue.obstacleId) {
        jumpedFor = cue.obstacleId;
        // EARLY + SHORT: ~0.5s look-up, back to neutral before the plane
        lookUpScript = [...ramp(pitchK, 0.68, 5), ...Array(4).fill(0.68), ...ramp(0.68, 0.5, 6)];
        pitchK = lookUpScript.shift()!;
      } else {
        pitchK = Math.min(0.5, pitchK + 0.02);
      }
      engine.processFrame(makeHeadFrame({ pitchK }), t);
    }
    const raw = engine.getRawData();
    expect(raw.obstaclesCleared).toBeGreaterThanOrEqual(12);
    expect(raw.obstaclesFailed).toBe(0);
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
  it('a scripted head (pose frames only) clears obstacles without a single fail', () => {
    const engine = new RunnerEngine({ controlMode: 'head', seed: 1337 });
    let t = calibrateHead(engine);
    engine.setSessionMs(60_000);
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
    expect(raw.obstaclesCleared).toBeGreaterThanOrEqual(12);
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
    expect(obstacles.length).toBeGreaterThanOrEqual(15); // ~60s of endless obstacles
    for (const ob of obstacles) {
      expect(ob.data.cleared).toBe(true);
      expect(typeof ob.data.crouchAtGate).toBe('number');
      expect(typeof ob.data.jumpYAtGate).toBe('number');
      expect(typeof ob.data.livesLeft).toBe('number');
    }
    const reps = events.filter((e) => e.tag === 'REP');
    expect(reps.length).toBeGreaterThanOrEqual(15);
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

// ── game clock: runActive gate, real pause, session timer ─────────────────

describe('RunnerEngine — game clock (runActive gate + pause + session timer)', () => {
  it('manual pause freezes the world and session timer; resume continues from the same point', () => {
    const engine = new RunnerEngine({ controlMode: 'keyboard', seed: 1337 });
    engine.setSessionMs(60_000);
    engine.startPlaying();
    let t = 1000;
    for (let i = 0; i < 60; i++) {
      t += FRAME_MS;
      engine.processFrame([], t);
    }
    const dBefore = engine.getSceneState().distance;
    const timerBefore = engine.getTimerRemainingMs();
    expect(dBefore).toBeGreaterThan(0);

    engine.setPaused(true);
    for (let i = 0; i < 90; i++) {
      t += FRAME_MS;
      engine.processFrame([], t);
    }
    expect(engine.isRunActive()).toBe(false);
    expect(engine.getSceneState().distance).toBe(dBefore);
    expect(engine.getTimerRemainingMs()).toBe(timerBefore);

    engine.setPaused(false);
    for (let i = 0; i < 30; i++) {
      t += FRAME_MS;
      engine.processFrame([], t);
    }
    expect(engine.getSceneState().distance).toBeGreaterThan(dBefore);
    expect(engine.getTimerRemainingMs()!).toBeLessThan(timerBefore!);
  });

  it('session timer reaching 0 ends the run with reason "time" (fixed course capped by timer)', () => {
    const engine = new RunnerEngine({ controlMode: 'keyboard', seed: 1337 });
    engine.setSessionMs(2000);
    engine.startPlaying();
    let t = 1000;
    const reasons: string[] = [];
    for (let i = 0; i < 400 && !engine.isComplete(); i++) {
      t += FRAME_MS;
      engine.processFrame([], t);
      for (const e of engine.drainEvents()) {
        if (e.tag === 'RUN_DONE') reasons.push(String(e.data.reason));
      }
    }
    expect(engine.isComplete()).toBe(true);
    expect(reasons).toContain('time');
    // REGRESSION (playtest): the end reason is 'time' while ALL lives remain —
    // the UI must never infer "Out of lives" from anything but this reason
    expect(engine.getEndReason()).toBe('time');
    expect(engine.getSceneState().lives).toBe(3);
    const raw = engine.getRawData();
    expect(raw.elapsed).toBeGreaterThanOrEqual(2000);
    // 2s at ~6m/s ≈ 12m — before the 30m lead-in ends, so no obstacle resolved
    expect(raw.obstaclesFailed).toBe(0);
  });

  it('elapsed counts only ACTIVE time — a pause never inflates the Time stat', () => {
    const engine = new RunnerEngine({ controlMode: 'keyboard', seed: 1337 });
    engine.startPlaying();
    let t = 1000;
    for (let i = 0; i < 30; i++) {
      t += FRAME_MS;
      engine.processFrame([], t);
    } // ~1s active
    engine.setPaused(true);
    for (let i = 0; i < 60; i++) {
      t += FRAME_MS;
      engine.processFrame([], t);
    } // ~2s paused
    engine.setPaused(false);
    for (let i = 0; i < 30; i++) {
      t += FRAME_MS;
      engine.processFrame([], t);
    } // ~1s active
    const elapsed = engine.getRawData().elapsed;
    expect(elapsed).toBeGreaterThan(1700);
    expect(elapsed).toBeLessThan(2300); // ≈2s of activity, NOT the 4s wall span
  });

  it('input while paused counts no reps and cannot arm a hurdle clear', () => {
    const engine = new RunnerEngine({ controlMode: 'keyboard', seed: 1337 });
    engine.startPlaying();
    let t = 1000;
    for (let i = 0; i < 10; i++) {
      t += FRAME_MS;
      engine.processFrame([], t);
    }
    engine.setPaused(true);
    engine.setControlInput({ jumpPressed: true });
    for (let i = 0; i < 30; i++) {
      t += FRAME_MS;
      engine.processFrame([], t);
    }
    expect(engine.getRawData().jumpReps).toBe(0);
    engine.setPaused(false);
    for (let i = 0; i < 5; i++) {
      t += FRAME_MS;
      engine.processFrame([], t);
    }
    // the paused press was consumed and discarded — nothing fires on resume
    expect(engine.getRawData().jumpReps).toBe(0);
  });

  it('a freeze during the post-crossing jump grace never causes an unfair fail', () => {
    const engine = new RunnerEngine({ controlMode: 'keyboard', seed: 1337 });
    engine.setSessionMs(60_000);
    engine.startPlaying();
    let t = 1000;
    let firstHurdleId = -1;
    let stage: 'run' | 'frozen' | 'after' = 'run';
    let pausedFrames = 0;
    let jumpedFor = -1;
    const obstacleEvents = new Map<number, Record<string, unknown>>();
    for (let frames = 0; frames < 12000 && !engine.isComplete(); frames++) {
      t += FRAME_MS;
      const s = engine.getSceneState();
      if (firstHurdleId === -1) {
        const hurdles = s.obstacles.filter((o) => o.type === 'hurdle');
        firstHurdleId = hurdles.reduce((a, b) => (a.zAhead < b.zAhead ? a : b)).id;
      }
      const first = s.obstacles.find((o) => o.id === firstHurdleId);
      const cue = s.cue;
      engine.setControlInput({ crouchHeld: cue?.type === 'beam' });
      // play every OTHER hurdle perfectly
      if (
        cue?.type === 'hurdle' &&
        cue.obstacleId !== firstHurdleId &&
        cue.progress >= 0.8 &&
        jumpedFor !== cue.obstacleId
      ) {
        jumpedFor = cue.obstacleId;
        engine.setControlInput({ jumpPressed: true });
      }
      if (stage === 'run' && first && !first.resolved && first.zAhead <= 0) {
        // crossed the first hurdle WITHOUT jumping → inside the 250ms grace.
        // Freeze ~100ms into it for ~1s (far beyond the nominal grace).
        if ((-first.zAhead / s.speed) * 1000 >= 100) {
          engine.setPaused(true);
          stage = 'frozen';
        }
      } else if (stage === 'frozen') {
        pausedFrames++;
        if (pausedFrames >= 30) {
          engine.setPaused(false);
          engine.setControlInput({ jumpPressed: true }); // late jump right after resume
          stage = 'after';
        }
      }
      engine.processFrame([], t);
      for (const e of engine.drainEvents()) {
        if (e.tag === 'OBSTACLE') obstacleEvents.set(e.data.id as number, e.data);
      }
    }
    // the grace window was shifted by the frozen span → the resume-jump retro-clears
    const first = obstacleEvents.get(firstHurdleId)!;
    expect(first.cleared).toBe(true);
    expect(engine.getRawData().obstaclesFailed).toBe(0);
  });
});

// ── locomotion gating: march/jog in place to move (pose mode) ─────────────

describe('RunnerEngine — locomotion gating (march/jog to move)', () => {
  /** whole-body bounce: makeFrame's hipY shifts shoulders+hips together —
   *  a small rhythmic oscillation, exactly like marching in place. */
  function driveBounce(engine: RunnerEngine, t: number, frames: number, amp = 0.012): number {
    for (let i = 0; i < frames; i++) {
      t += FRAME_MS;
      const hipY = 0.6 + amp * Math.sin((2 * Math.PI * i) / 12); // ~2.5Hz
      engine.processFrame(makeFrame({ hipY }), t);
    }
    return t;
  }

  function driveStill(engine: RunnerEngine, t: number, frames: number): number {
    for (let i = 0; i < frames; i++) {
      t += FRAME_MS;
      engine.processFrame(makeFrame({ hipY: 0.6 }), t);
    }
    return t;
  }

  function gatedEngine(): { engine: RunnerEngine; t: number } {
    const engine = new RunnerEngine({ controlMode: 'pose', seed: 1337 });
    const t = calibrate(engine);
    engine.setLocomotionGating(true);
    engine.startPlaying();
    return { engine, t };
  }

  it('world holds until marching starts; rhythmic bounce activates locomotion', () => {
    const { engine, t: t0 } = gatedEngine();
    let t = driveStill(engine, t0, 30); // ~1s standing
    expect(engine.getLocomotionState().active).toBe(false);
    expect(engine.getSceneState().distance).toBe(0);

    t = driveBounce(engine, t, 90); // ~3s of marching
    expect(engine.getLocomotionState().started).toBe(true);
    expect(engine.getLocomotionState().active).toBe(true);
    expect(engine.getSceneState().distance).toBeGreaterThan(0);
  });

  it('stopping decays locomotion after the step timeout and the world halts smoothly', () => {
    const { engine, t: t0 } = gatedEngine();
    let t = driveBounce(engine, t0, 90);
    expect(engine.getLocomotionState().active).toBe(true);

    t = driveStill(engine, t, 90); // ~3s stopped: timeout (1.2s) + decel tail
    expect(engine.getLocomotionState().active).toBe(false);
    const halted = engine.getSceneState().distance;
    t = driveStill(engine, t, 30);
    expect(engine.getSceneState().distance).toBe(halted); // fully at rest
    // elapsed excludes the stopped span (active time only)
    expect(engine.getRawData().elapsed).toBeLessThan(4000);
  });

  it('a single jump is a large transient — it never reads as locomotion', () => {
    const { engine, t: t0 } = gatedEngine();
    let t = driveStill(engine, t0, 15);
    // jump: fast big hip rise and return (far beyond LOCO.MAX_AMP)
    const jumpProfile = [...ramp(0.6, 0.44, 4), ...Array(6).fill(0.44), ...ramp(0.44, 0.6, 4)];
    for (const hipY of jumpProfile) {
      t += FRAME_MS;
      engine.processFrame(makeFrame({ hipY }), t);
    }
    t = driveStill(engine, t, 30);
    expect(engine.getLocomotionState().started).toBe(false);
    expect(engine.getSceneState().distance).toBe(0);
  });

  it('momentum carries locomotion THROUGH a jump instead of stalling', () => {
    const { engine, t: t0 } = gatedEngine();
    let t = driveBounce(engine, t0, 90);
    const dBefore = engine.getSceneState().distance;
    expect(engine.getLocomotionState().active).toBe(true);

    // jump mid-run (~0.45s of large excursion, no steps)
    const jumpProfile = [...ramp(0.6, 0.44, 4), ...Array(6).fill(0.44), ...ramp(0.44, 0.6, 4)];
    for (const hipY of jumpProfile) {
      t += FRAME_MS;
      engine.processFrame(makeFrame({ hipY }), t);
    }
    expect(engine.getLocomotionState().active).toBe(true); // momentum coasted
    expect(engine.getSceneState().distance).toBeGreaterThan(dBefore); // never stalled
  });

  it('every jump emits exactly one LAND event when the arc completes (game-feel hook)', () => {
    const engine = new RunnerEngine({ controlMode: 'keyboard', seed: 1337 });
    engine.startPlaying();
    let t = 1000;
    engine.setControlInput({ jumpPressed: true });
    const tags: string[] = [];
    for (let i = 0; i < 40; i++) {
      t += FRAME_MS;
      engine.processFrame([], t);
      for (const e of engine.drainEvents()) tags.push(e.tag);
    }
    expect(tags.filter((x) => x === 'JUMP_TRIGGER').length).toBe(1);
    expect(tags.filter((x) => x === 'LAND').length).toBe(1);
  });

  it('keyboard and head modes are never gated — auto-advance as before', () => {
    const kb = new RunnerEngine({ controlMode: 'keyboard', seed: 1337 });
    kb.startPlaying();
    let t = 1000;
    for (let i = 0; i < 30; i++) {
      t += FRAME_MS;
      kb.processFrame([], t);
    }
    expect(kb.getLocomotionState().gated).toBe(false);
    expect(kb.getSceneState().distance).toBeGreaterThan(0);
  });
});

// ── B1: resume-near-obstacle fairness ──────────────────────────────────────
// A locomotion stop coasts to a reaction-based margin before the plane, and
// after ANY gated resume the plane cannot be crossed until the player has had
// a real reaction window (released early once the correct action starts).
describe('RunnerEngine — resume-near-obstacle fairness', () => {
  function gatedEngine(): { engine: RunnerEngine; t: number } {
    const engine = new RunnerEngine({ controlMode: 'pose', seed: 1337 });
    const t = calibrate(engine);
    engine.setLocomotionGating(true);
    engine.startPlaying();
    return { engine, t };
  }

  /** One marching frame; drains events into `log` stamped with the clock. */
  function stepBounce(
    engine: RunnerEngine,
    t: number,
    i: number,
    log: { tag: string; t: number; data: Record<string, unknown> }[],
  ): number {
    t += FRAME_MS;
    const hipY = 0.6 + 0.012 * Math.sin((2 * Math.PI * i) / 12);
    engine.processFrame(makeFrame({ hipY }), t);
    for (const e of engine.drainEvents()) log.push({ tag: e.tag, t, data: e.data });
    return t;
  }

  function stepStill(
    engine: RunnerEngine,
    t: number,
    log: { tag: string; t: number; data: Record<string, unknown> }[],
  ): number {
    t += FRAME_MS;
    engine.processFrame(makeFrame({ hipY: 0.6 }), t);
    for (const e of engine.drainEvents()) log.push({ tag: e.tag, t, data: e.data });
    return t;
  }

  /** March until the world is within `withinM` of the first plane, then stop
   *  until fully frozen. Returns clock + the first obstacle. */
  function approachAndFreeze(
    engine: RunnerEngine,
    t0: number,
    log: { tag: string; t: number; data: Record<string, unknown> }[],
    withinM = 12,
  ): { t: number; first: { atDistance: number; type: string; id: number } } {
    const first = generateChunk(1337, 0, COURSE.LEAD_IN_M, 0)[0];
    let t = t0;
    let i = 0;
    while (engine.getSceneState().distance < first.atDistance - withinM) {
      t = stepBounce(engine, t, i++, log);
      if (i > 2000) throw new Error('never approached the first obstacle');
    }
    for (let s = 0; s < 90; s++) t = stepStill(engine, t, log); // ~3s → frozen
    expect(log.some((e) => e.tag === 'RUN_FREEZE')).toBe(true);
    return { t, first };
  }

  it('a stop coasts to the reaction-based margin, never 0.6m from the plane', () => {
    const { engine, t: t0 } = gatedEngine();
    const log: { tag: string; t: number; data: Record<string, unknown> }[] = [];
    const { first } = approachAndFreeze(engine, t0, log);
    const halted = engine.getSceneState().distance;
    const speed = engine.getSceneState().speed;
    const margin = Math.max(LOCO.STOP_MARGIN_M, speed * LOCO.STOP_REACTION_S);
    expect(first.atDistance - halted).toBeGreaterThanOrEqual(margin - 0.05);
  });

  it('resume without acting: the plane is not crossed until the reaction window elapses', () => {
    const { engine, t: t0 } = gatedEngine();
    const log: { tag: string; t: number; data: Record<string, unknown> }[] = [];
    const { t: tFrozen, first } = approachAndFreeze(engine, t0, log);
    log.length = 0; // drop run-start freeze/resume events — track THIS resume

    // resume marching (small bounce = no squat/jump) until the plane resolves
    let t = tFrozen;
    let i = 0;
    let maxBeforeResolve = 0;
    while (!log.some((e) => e.tag === 'OBSTACLE') && i < 600) {
      t = stepBounce(engine, t, i++, log);
      if (!log.some((e) => e.tag === 'OBSTACLE')) {
        maxBeforeResolve = Math.max(maxBeforeResolve, engine.getSceneState().distance);
      }
    }
    const resume = log.find((e) => e.tag === 'RUN_RESUME');
    const obstacle = log.find((e) => e.tag === 'OBSTACLE');
    expect(resume).toBeDefined();
    expect(obstacle).toBeDefined();
    // the reaction window held (allow one frame of clock quantization)
    expect(obstacle!.t - resume!.t).toBeGreaterThanOrEqual(LOCO.RESUME_REACTION_MS - FRAME_MS);
    // ...and it is the grace doing the work, not a distant stop point:
    // the world glided up to just short of the plane and held there
    expect(maxBeforeResolve).toBeLessThan(first.atDistance);
    expect(maxBeforeResolve).toBeGreaterThan(first.atDistance - 1);
  });

  it('acting during the grace releases it early and clears the obstacle', () => {
    const { engine, t: t0 } = gatedEngine();
    const log: { tag: string; t: number; data: Record<string, unknown> }[] = [];
    const { t: tFrozen, first } = approachAndFreeze(engine, t0, log);
    log.length = 0;

    // resume marching until the world is holding just short of the plane
    let t = tFrozen;
    let i = 0;
    while (engine.getSceneState().distance < first.atDistance - 0.5 && i < 600) {
      t = stepBounce(engine, t, i++, log);
    }
    expect(log.some((e) => e.tag === 'RUN_RESUME')).toBe(true);
    expect(log.some((e) => e.tag === 'OBSTACLE')).toBe(false); // still held

    // perform the correct action for the obstacle type
    const drain = () => {
      for (const e of engine.drainEvents()) log.push({ tag: e.tag, t, data: e.data });
    };
    if (first.type === 'beam') {
      // deep crouch (hip drop ≈ 0.08 raw ⇒ crouch ≈ 1) and hold
      for (const hipY of [...ramp(0.6, 0.68, 4), ...Array(25).fill(0.68)]) {
        t += FRAME_MS;
        engine.processFrame(makeFrame({ hipY }), t);
        drain();
      }
    } else {
      // jump: fast large hip rise + return, then keep marching
      for (const hipY of [...ramp(0.6, 0.44, 4), ...Array(6).fill(0.44), ...ramp(0.44, 0.6, 4)]) {
        t += FRAME_MS;
        engine.processFrame(makeFrame({ hipY }), t);
        drain();
      }
      for (let k = 0; k < 20 && !log.some((e) => e.tag === 'OBSTACLE'); k++) {
        t = stepBounce(engine, t, k, log);
      }
    }
    const obstacle = log.find((e) => e.tag === 'OBSTACLE');
    expect(obstacle).toBeDefined();
    expect(obstacle!.data.cleared).toBe(true);
    expect(engine.getRawData().obstaclesFailed).toBe(0);
  });

  it('a re-freeze during the grace re-arms a full fresh window on the next resume', () => {
    const { engine, t: t0 } = gatedEngine();
    const log: { tag: string; t: number; data: Record<string, unknown> }[] = [];
    const { t: tFrozen } = approachAndFreeze(engine, t0, log);
    log.length = 0;

    // resume marching until the world is moving again (first grace armed)...
    let t = tFrozen;
    let i = 0;
    for (; i < 30; i++) t = stepBounce(engine, t, i, log);
    expect(log.filter((e) => e.tag === 'RUN_RESUME').length).toBe(1);
    expect(log.some((e) => e.tag === 'OBSTACLE')).toBe(false);
    // ...lose tracking mid-glide (instant freeze, no step-timeout wait)...
    for (let s = 0; s < 12; s++) {
      t += FRAME_MS;
      engine.processFrame(makeFrame({ hipY: 0.6, visible: false }), t);
      for (const e of engine.drainEvents()) log.push({ tag: e.tag, t, data: e.data });
    }
    expect(log.some((e) => e.tag === 'RUN_FREEZE')).toBe(true);
    expect(log.some((e) => e.tag === 'OBSTACLE')).toBe(false);
    // ...and resume: the plane must hold for a FULL fresh window again
    log.length = 0;
    while (!log.some((e) => e.tag === 'OBSTACLE') && i < 2000) {
      t = stepBounce(engine, t, i++, log);
    }
    const resume2 = log.find((e) => e.tag === 'RUN_RESUME');
    const obstacle = log.find((e) => e.tag === 'OBSTACLE');
    expect(resume2).toBeDefined();
    expect(obstacle).toBeDefined();
    expect(obstacle!.t - resume2!.t).toBeGreaterThanOrEqual(LOCO.RESUME_REACTION_MS - FRAME_MS);
  });
});
