/**
 * Kriya Runner — Level 1 game engine (KR1).
 *
 * Pure TypeScript: no DOM, no three.js, no window. All game truth lives
 * here — course timeline, squat/jump/heel-raise detection FSMs, obstacle
 * gates, lives, metrics, and the camera-feel outputs the Three.js scene
 * reads. Time comes ONLY from the timestampMs passed to processFrame /
 * processCalibration, so the whole engine is deterministic and testable
 * headless (vitest, mocked clock).
 *
 * Keyboard and pose control share one code path: keyboard input ramps the
 * same `crouch` signal and fires the same `triggerJump()` the pose FSMs do,
 * so gates / reps / metrics are identical downstream.
 */
import type {
  GameEngine,
  NormalizedLandmark,
  CalibrationStatus,
  HudMetrics,
} from './types';
import { LM } from './types';
import { generateCourse, courseLength, type Obstacle } from './runner-timeline';
import {
  DETECT,
  CALIB,
  DRIFT,
  COURSE,
  CAMERA,
  KEYBOARD,
  ASSESSMENT,
} from '@/components/games/runner/runner-constants';
import type { RunnerRawData } from '@/types/raw-data';

export type ControlMode = 'pose' | 'keyboard';
export type RunnerPhase = 'calibrating' | 'ready' | 'playing' | 'done';

export interface ControlInput {
  crouchHeld: boolean;
  /** edge-consumed: engine resets it to false after firing */
  jumpPressed: boolean;
}

export interface CueState {
  type: 'hurdle' | 'beam';
  /** 0 → just telegraphed, 1 → act NOW (at the action plane) */
  progress: number;
  obstacleId: number;
}

export interface SceneObstacle {
  id: number;
  type: 'hurdle' | 'beam';
  /** meters ahead of the player (negative = behind) */
  zAhead: number;
  resolved: boolean;
  cleared: boolean;
}

export interface RunnerSceneState {
  phase: RunnerPhase;
  distance: number;
  speed: number;
  cameraY: number;
  cameraPitch: number;
  fov: number;
  lives: number;
  /** timestampMs of the last failed obstacle, 0 if none */
  hitFlashAt: number;
  cue: CueState | null;
  obstacles: SceneObstacle[];
  lowImpact: boolean;
  crouch: number;
  jumpY: number;
}

type FsmState = 'neutral' | 'active' | 'returning';

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const finite = (v: number, fallback = 0) => (Number.isFinite(v) ? v : fallback);

export class RunnerEngine implements GameEngine {
  // ── control / config ──
  private controlMode: ControlMode = 'pose';
  private lowImpact = false;
  private input: ControlInput = { crouchHeld: false, jumpPressed: false };
  private seed: number = COURSE.ASSESSMENT_SEED;
  private debug = false;

  // ── phase / clock ──
  private phase: RunnerPhase = 'calibrating';
  private lastTs = 0;
  private playStartTs = 0;

  // ── calibration ──
  private calHoldStart = 0; // 0 = not holding
  private calStartTs = 0;
  private calHipSamples: number[] = [];
  private calShoulderSamples: number[] = [];
  private hipY0 = 0;
  private shoulderW0 = 0;
  private calibrated = false;

  // ── detection signals ──
  private hipEma = 0;
  private hipEmaReady = false;
  /** raw hip samples for the jump-takeoff window diff (EMA would lag takeoff) */
  private hipHistory: { y: number; t: number }[] = [];
  private heelEma = 0;
  private heelEmaReady = false;
  private heelY0 = 0;
  private crouch = 0;
  private squatState: FsmState = 'neutral';
  private squatPeak = 0;
  private jumpArmed = true;
  private jumpStartTs = 0; // 0 = not airborne
  private jumpMeasuredPeak = 0;
  private heelState: FsmState = 'neutral';
  private heelPeak = 0;
  /** true whenever pose landmarks were usable this frame */
  private trackingOk = false;

  // ── drift guard (M2) ──
  private driftSince = 0;
  private driftActive = false;

  // ── world ──
  private obstacles: Obstacle[] = [];
  private resolved: boolean[] = [];
  private clearedFlags: boolean[] = [];
  private distance = 0;
  private speed: number = COURSE.SPEED_START;
  private lives = COURSE.LIVES;
  private hitFlashAt = 0;

  // ── cue / reaction ──
  private cue: CueState | null = null;
  private cueShownAt: number[] = [];
  private reactionRecorded: boolean[] = [];
  private reactionMsList: number[] = [];

  // ── metric accumulators ──
  private squatReps = 0;
  private jumpReps = 0;
  private squatDepthSum = 0;
  private jumpHeightSum = 0;
  private cleanReps = 0;

  constructor(opts?: { seed?: number; controlMode?: ControlMode; lowImpact?: boolean }) {
    if (opts?.seed !== undefined) this.seed = opts.seed;
    if (opts?.controlMode) this.controlMode = opts.controlMode;
    if (opts?.lowImpact !== undefined) this.lowImpact = opts.lowImpact;
    this.reset();
  }

  // ── GameEngine: lifecycle ─────────────────────────────────────────────

  reset(): void {
    this.phase = 'calibrating';
    this.lastTs = 0;
    this.playStartTs = 0;
    this.calHoldStart = 0;
    this.calStartTs = 0;
    this.calHipSamples = [];
    this.calShoulderSamples = [];
    this.calibrated = false;
    this.hipEmaReady = false;
    this.heelEmaReady = false;
    this.hipHistory = [];
    this.crouch = 0;
    this.squatState = 'neutral';
    this.squatPeak = 0;
    this.jumpArmed = true;
    this.jumpStartTs = 0;
    this.jumpMeasuredPeak = 0;
    this.heelState = 'neutral';
    this.heelPeak = 0;
    this.trackingOk = false;
    this.driftSince = 0;
    this.driftActive = false;

    this.obstacles = generateCourse(this.seed);
    this.resolved = this.obstacles.map(() => false);
    this.clearedFlags = this.obstacles.map(() => false);
    this.cueShownAt = this.obstacles.map(() => 0);
    this.reactionRecorded = this.obstacles.map(() => false);
    this.distance = 0;
    this.speed = COURSE.SPEED_START;
    this.lives = COURSE.LIVES;
    this.hitFlashAt = 0;
    this.cue = null;
    this.reactionMsList = [];
    this.squatReps = 0;
    this.jumpReps = 0;
    this.squatDepthSum = 0;
    this.jumpHeightSum = 0;
    this.cleanReps = 0;
    this.cameraY = CAMERA.EYE;
    this.cameraPitch = 0;
    this.fov = CAMERA.FOV_BASE;

    if (this.controlMode === 'keyboard') {
      // No camera baseline needed — keyboard is instantly "calibrated".
      this.calibrated = true;
      this.phase = 'ready';
    }
  }

  destroy(): void {
    // pure class — nothing to release
  }

  // ── configuration ─────────────────────────────────────────────────────

  setControlMode(mode: ControlMode): void {
    if (mode === this.controlMode) return;
    this.controlMode = mode;
    this.reset();
  }

  setLowImpact(v: boolean): void {
    this.lowImpact = v;
  }

  setSeed(seed: number): void {
    this.seed = seed;
    this.reset();
  }

  setDebug(v: boolean): void {
    this.debug = v;
  }

  setControlInput(input: Partial<ControlInput>): void {
    if (input.crouchHeld !== undefined) this.input.crouchHeld = input.crouchHeld;
    if (input.jumpPressed) this.input.jumpPressed = true;
  }

  getControlMode(): ControlMode {
    return this.controlMode;
  }

  // ── calibration ───────────────────────────────────────────────────────

  processCalibration(landmarks: NormalizedLandmark[]): CalibrationStatus {
    if (this.controlMode === 'keyboard' || this.calibrated) {
      return { isReady: true, progress: 1, message: 'Ready' };
    }
    // Engine clock during calibration comes from a synthetic timestamp
    // sequence maintained by the caller through processFrame; the layer
    // calls processCalibration on each pose frame, so we track our own
    // monotonic sample count converted to time via the samples themselves.
    return this.calibrateFrame(landmarks, this.lastTs);
  }

  /**
   * Time-aware calibration entry — the layer should advance the engine
   * clock by calling processFrame (which no-ops outside 'playing') or by
   * passing timestamps here.
   */
  processCalibrationAt(landmarks: NormalizedLandmark[], timestampMs: number): CalibrationStatus {
    this.lastTs = timestampMs;
    return this.calibrateFrame(landmarks, timestampMs);
  }

  private calibrateFrame(landmarks: NormalizedLandmark[], now: number): CalibrationStatus {
    if (this.calStartTs === 0) this.calStartTs = now;
    if (this.calStartTs !== 0 && now - this.calStartTs > CALIB.TIMEOUT_MS) {
      return {
        isReady: false,
        progress: 0,
        isTimedOut: true,
        message: 'Tap to retry',
      };
    }

    const ok = this.fullBodyVisible(landmarks);
    if (!ok) {
      this.calHoldStart = 0;
      this.calHipSamples = [];
      this.calShoulderSamples = [];
      return {
        isReady: false,
        progress: 0,
        message: 'Get your whole body in frame',
      };
    }

    const hipY = (landmarks[LM.LEFT_HIP].y + landmarks[LM.RIGHT_HIP].y) / 2;
    const shoulderW = Math.abs(landmarks[LM.LEFT_SHOULDER].x - landmarks[LM.RIGHT_SHOULDER].x);

    // wobble check: restart the hold if the hips moved
    if (this.calHipSamples.length > 0) {
      const mean =
        this.calHipSamples.reduce((a, b) => a + b, 0) / this.calHipSamples.length;
      if (Math.abs(hipY - mean) > CALIB.MAX_WOBBLE) {
        this.calHoldStart = 0;
        this.calHipSamples = [];
        this.calShoulderSamples = [];
      }
    }

    if (this.calHoldStart === 0) this.calHoldStart = now;
    this.calHipSamples.push(hipY);
    this.calShoulderSamples.push(shoulderW);

    const heldMs = now - this.calHoldStart;
    const progress = clamp01(heldMs / CALIB.HOLD_MS);
    if (heldMs >= CALIB.HOLD_MS && this.calHipSamples.length >= 10) {
      this.hipY0 =
        this.calHipSamples.reduce((a, b) => a + b, 0) / this.calHipSamples.length;
      this.shoulderW0 =
        this.calShoulderSamples.reduce((a, b) => a + b, 0) /
        this.calShoulderSamples.length;
      const heels = this.heelYOf(landmarks);
      this.heelY0 = heels ?? this.hipY0 + 0.35;
      this.calibrated = true;
      this.phase = 'ready';
      return { isReady: true, progress: 1, message: 'Locked in!' };
    }

    return {
      isReady: false,
      progress,
      message: 'Hold still…',
    };
  }

  resetCalibration(): void {
    this.calibrated = false;
    this.calStartTs = 0;
    this.calHoldStart = 0;
    this.calHipSamples = [];
    this.calShoulderSamples = [];
    if (this.controlMode === 'pose') this.phase = 'calibrating';
  }

  private fullBodyVisible(landmarks: NormalizedLandmark[]): boolean {
    if (!landmarks || landmarks.length < 33) return false;
    const need = [LM.NOSE, LM.LEFT_ANKLE, LM.RIGHT_ANKLE, LM.LEFT_HIP, LM.RIGHT_HIP];
    return need.every((i) => landmarks[i] && landmarks[i].visibility >= CALIB.MIN_VISIBILITY);
  }

  private heelYOf(landmarks: NormalizedLandmark[]): number | null {
    const l = landmarks[LM.LEFT_HEEL];
    const r = landmarks[LM.RIGHT_HEEL];
    if (!l || !r || l.visibility < 0.3 || r.visibility < 0.3) return null;
    return (l.y + r.y) / 2;
  }

  // ── play ──────────────────────────────────────────────────────────────

  startPlaying(): void {
    if (!this.calibrated && this.controlMode === 'pose') return;
    this.phase = 'playing';
    this.playStartTs = this.lastTs;
  }

  processFrame(landmarks: NormalizedLandmark[], timestampMs: number): void {
    const dt = this.lastTs === 0 ? 0 : Math.min(0.1, Math.max(0, (timestampMs - this.lastTs) / 1000));
    this.lastTs = timestampMs;
    if (this.playStartTs === 0 && this.phase === 'playing') this.playStartTs = timestampMs;

    // 1. control signals (both phases update signals so the HUD/pip stay live)
    if (this.controlMode === 'pose') {
      this.updatePoseSignals(landmarks, timestampMs, dt);
    } else {
      this.updateKeyboardSignals(timestampMs, dt);
    }

    if (this.phase !== 'playing' || dt === 0) {
      this.updateCameraFeel(dt);
      return;
    }

    // 2. world advance
    const len = courseLength(this.obstacles);
    const speedT = clamp01(this.distance / len);
    this.speed = COURSE.SPEED_START + (COURSE.SPEED_END - COURSE.SPEED_START) * speedT;
    const prevDistance = this.distance;
    this.distance += this.speed * dt;

    // 3. resolve obstacles whose action plane was crossed this frame
    for (let i = 0; i < this.obstacles.length; i++) {
      if (this.resolved[i]) continue;
      const ob = this.obstacles[i];
      if (prevDistance < ob.atDistance && this.distance >= ob.atDistance) {
        this.resolveObstacle(i, timestampMs);
      }
    }

    // 4. cue for the nearest unresolved obstacle
    this.updateCue(timestampMs);

    // 5. finish conditions
    if (this.lives <= 0 || this.resolved.every(Boolean)) {
      this.phase = 'done';
      this.finalizePendingReps();
    }

    this.updateCameraFeel(dt);
  }

  private resolveObstacle(i: number, now: number): void {
    const ob = this.obstacles[i];
    this.resolved[i] = true;
    const cleared =
      ob.type === 'beam'
        ? this.crouch > DETECT.SQUAT_CLEAR
        : this.jumpY() > DETECT.JUMP_CLEAR;
    this.clearedFlags[i] = cleared;
    if (!cleared) {
      this.lives -= 1;
      this.hitFlashAt = now;
    }
    if (this.cue?.obstacleId === ob.id) this.cue = null;
  }

  private updateCue(now: number): void {
    const idx = this.resolved.findIndex((r) => !r);
    if (idx === -1) {
      this.cue = null;
      return;
    }
    const ob = this.obstacles[idx];
    const timeToPlane = (ob.atDistance - this.distance) / this.speed;
    if (timeToPlane <= COURSE.CUE_WINDOW_S) {
      if (this.cueShownAt[idx] === 0) this.cueShownAt[idx] = now;
      this.cue = {
        type: ob.type,
        progress: clamp01(1 - timeToPlane / COURSE.CUE_WINDOW_S),
        obstacleId: ob.id,
      };
    } else {
      this.cue = null;
    }
  }

  /** Record cue→movement-initiation latency for the active cue. */
  private recordReaction(kind: 'squat' | 'jump', now: number): void {
    if (!this.cue) return;
    const idx = this.cue.obstacleId;
    const wants = this.obstacles[idx].type === 'beam' ? 'squat' : 'jump';
    if (kind !== wants) return;
    if (this.reactionRecorded[idx] || this.cueShownAt[idx] === 0) return;
    this.reactionRecorded[idx] = true;
    this.reactionMsList.push(now - this.cueShownAt[idx]);
  }

  // ── detection: pose ───────────────────────────────────────────────────

  private updatePoseSignals(landmarks: NormalizedLandmark[], now: number, dt: number): void {
    const usable =
      landmarks &&
      landmarks.length >= 33 &&
      landmarks[LM.LEFT_HIP]?.visibility >= 0.4 &&
      landmarks[LM.RIGHT_HIP]?.visibility >= 0.4;
    this.trackingOk = !!usable;

    if (!usable || !this.calibrated) {
      // decay crouch toward 0 so tracking loss never fakes a squat-hold
      this.crouch = Math.max(0, this.crouch - dt * 2);
      this.advanceJumpArc(now, dt);
      return;
    }

    const rawHip = (landmarks[LM.LEFT_HIP].y + landmarks[LM.RIGHT_HIP].y) / 2;
    if (!this.hipEmaReady) {
      this.hipEma = rawHip;
      this.hipEmaReady = true;
    } else {
      this.hipEma = DETECT.EMA_ALPHA * rawHip + (1 - DETECT.EMA_ALPHA) * this.hipEma;
    }
    // raw window for takeoff velocity (prune to ~130ms)
    this.hipHistory.push({ y: rawHip, t: now });
    while (this.hipHistory.length > 1 && now - this.hipHistory[0].t > 130) {
      this.hipHistory.shift();
    }

    const k = this.liveScale(landmarks);
    const drop = (this.hipEma - this.hipY0) / k;
    // NOTE: rise uses the RAW hip — the jump gate must fire ON takeoff, and
    // the EMA lags ~150ms which is exactly the latency we can't afford.
    const riseRaw = (this.hipY0 - rawHip) / k;

    // squat signal + FSM (slow hold signal → EMA is right here)
    this.crouch = clamp01((drop - DETECT.SQUAT_ENGAGE) / DETECT.SQUAT_SPAN);
    this.stepSquatFsm(drop, now);

    // jump FSM (or heel-raise in low-impact mode)
    if (this.lowImpact) {
      this.stepHeelFsm(landmarks, k, now);
    } else {
      // window-diff velocity: raw, ~100ms window — smooths single-frame
      // jitter without EMA takeoff lag
      const oldest = this.hipHistory[0];
      const windowS = (now - oldest.t) / 1000;
      const velKPerS = windowS >= 0.06 ? (oldest.y - rawHip) / k / windowS : 0; // + = up
      if (
        this.jumpArmed &&
        this.jumpStartTs === 0 &&
        velKPerS > DETECT.JUMP_VEL_K_PER_S &&
        riseRaw > DETECT.JUMP_RISE
      ) {
        this.triggerJump(now);
      }
      if (this.jumpStartTs !== 0) {
        this.jumpMeasuredPeak = Math.max(this.jumpMeasuredPeak, riseRaw);
      }
      // return-to-neutral re-arms the jump
      if (!this.jumpArmed && Math.abs(drop) < DETECT.NEUTRAL_BAND && this.jumpStartTs === 0) {
        this.jumpArmed = true;
      }
    }

    this.updateDriftGuard(landmarks, drop, now);
    this.advanceJumpArc(now, dt);

    // slow-adapting standing baseline: only while everything is neutral
    if (
      this.squatState === 'neutral' &&
      this.jumpStartTs === 0 &&
      this.jumpArmed &&
      Math.abs(drop) < DETECT.NEUTRAL_BAND
    ) {
      this.hipY0 = this.hipY0 + DRIFT.BASELINE_ALPHA * (this.hipEma - this.hipY0);
    }
  }

  /**
   * Distance scale k. Frozen calibrated shoulder width by default —
   * live shoulder width is rotation-sensitive; the drift guard surfaces
   * sustained scale changes instead. (Evaluate live-k on real webcam in M2.)
   */
  private liveScale(_landmarks: NormalizedLandmark[]): number {
    return Math.max(0.05, this.shoulderW0);
  }

  private stepSquatFsm(drop: number, now: number): void {
    switch (this.squatState) {
      case 'neutral':
        if (drop > DETECT.SQUAT_ENGAGE) {
          this.squatState = 'active';
          this.squatPeak = this.crouch;
          this.recordReaction('squat', now);
        }
        break;
      case 'active':
        this.squatPeak = Math.max(this.squatPeak, this.crouch);
        if (drop < DETECT.SQUAT_ENGAGE) this.squatState = 'returning';
        break;
      case 'returning':
        // bounce back down before reaching neutral → same rep continues
        if (drop > DETECT.SQUAT_ENGAGE) {
          this.squatState = 'active';
        } else if (Math.abs(drop) < DETECT.NEUTRAL_BAND) {
          this.finishSquatRep();
          this.squatState = 'neutral';
        }
        break;
    }
  }

  private finishSquatRep(): void {
    if (this.squatPeak < DETECT.SQUAT_REP_MIN) {
      this.squatPeak = 0;
      return; // too shallow to count as an attempt
    }
    this.squatReps += 1;
    this.squatDepthSum += this.squatPeak;
    if (this.squatPeak >= DETECT.SQUAT_CLEAN) this.cleanReps += 1;
    this.squatPeak = 0;
  }

  private stepHeelFsm(landmarks: NormalizedLandmark[], k: number, now: number): void {
    const heelY = this.heelYOf(landmarks);
    if (heelY === null) return;
    if (!this.heelEmaReady) {
      this.heelEma = heelY;
      this.heelEmaReady = true;
    } else {
      this.heelEma = DETECT.EMA_ALPHA * heelY + (1 - DETECT.EMA_ALPHA) * this.heelEma;
    }
    const liftK = (this.heelY0 - this.heelEma) / k; // + = heels up

    switch (this.heelState) {
      case 'neutral':
        if (liftK > DETECT.HEEL_TRIGGER && this.jumpStartTs === 0) {
          this.heelState = 'active';
          this.heelPeak = liftK;
          this.triggerJump(now); // heel-raise drives the SAME game-space arc
          this.jumpMeasuredPeak = liftK;
        }
        break;
      case 'active':
        this.heelPeak = Math.max(this.heelPeak, liftK);
        if (liftK < DETECT.HEEL_TRIGGER * 0.5) {
          this.heelState = 'neutral';
        }
        break;
      case 'returning':
        this.heelState = 'neutral';
        break;
    }
  }

  private updateDriftGuard(landmarks: NormalizedLandmark[], drop: number, now: number): void {
    const shoulderW = Math.abs(
      landmarks[LM.LEFT_SHOULDER].x - landmarks[LM.RIGHT_SHOULDER].x,
    );
    const scaleOff =
      Math.abs(shoulderW - this.shoulderW0) / Math.max(0.05, this.shoulderW0) >
      DRIFT.SCALE_BAND;
    if (scaleOff) {
      if (this.driftSince === 0) this.driftSince = now;
      this.driftActive = now - this.driftSince > DRIFT.SUSTAIN_MS;
    } else {
      this.driftSince = 0;
      this.driftActive = false;
    }
  }

  /** Drift guard state for the layer ("Step back / recenter" nudge). */
  getDriftState(): { drifting: boolean } {
    return { drifting: this.driftActive };
  }

  isTracking(): boolean {
    return this.controlMode === 'keyboard' || this.trackingOk;
  }

  // ── detection: keyboard ───────────────────────────────────────────────

  private updateKeyboardSignals(now: number, dt: number): void {
    this.trackingOk = true;
    // crouch ramps toward held direction — same downstream semantics as pose
    const target = this.input.crouchHeld ? 1 : 0;
    const step = KEYBOARD.CROUCH_RATE * dt;
    this.crouch =
      this.crouch < target
        ? Math.min(target, this.crouch + step)
        : Math.max(target, this.crouch - step);

    // synthetic squat FSM bookkeeping so reps count identically
    const pseudoDrop = DETECT.SQUAT_ENGAGE + this.crouch * DETECT.SQUAT_SPAN;
    this.stepSquatFsm(this.input.crouchHeld || this.crouch > 0.01 ? pseudoDrop : 0, now);

    if (this.input.jumpPressed) {
      this.input.jumpPressed = false;
      if (this.jumpArmed && this.jumpStartTs === 0) {
        this.triggerJump(now);
        this.jumpMeasuredPeak = DETECT.JUMP_APEX; // keyboard arc apex
      }
    }
    if (!this.jumpArmed && this.jumpStartTs === 0) this.jumpArmed = true;

    this.advanceJumpArc(now, dt);
  }

  // ── shared jump arc (game-space) ──────────────────────────────────────

  private triggerJump(now: number): void {
    this.jumpStartTs = now;
    this.jumpArmed = false;
    this.jumpMeasuredPeak = 0;
    this.jumpReps += 1;
    this.recordReaction('jump', now);
  }

  private advanceJumpArc(now: number, _dt: number): void {
    if (this.jumpStartTs === 0) return;
    const t = (now - this.jumpStartTs) / 1000;
    if (t >= DETECT.JUMP_DURATION_S) {
      // landing: bank the rep quality. Heel-raise mode measures heel lift,
      // so it normalizes/cleans against the heel thresholds, not jump ones.
      const peak = this.controlMode === 'keyboard' ? DETECT.JUMP_APEX : this.jumpMeasuredPeak;
      const norm = this.lowImpact ? DETECT.HEEL_CLEAN : DETECT.JUMP_APEX;
      const cleanAt = this.lowImpact ? DETECT.HEEL_CLEAN : DETECT.JUMP_CLEAN;
      this.jumpHeightSum += clamp01(peak / norm);
      if (peak >= cleanAt) this.cleanReps += 1;
      this.jumpStartTs = 0;
    }
  }

  /**
   * The run can end mid-rep (final obstacle resolves while airborne or still
   * squatting) — bank those reps' quality so metrics don't lose the last rep.
   */
  private finalizePendingReps(): void {
    if (this.jumpStartTs !== 0) {
      const peak = this.controlMode === 'keyboard' ? DETECT.JUMP_APEX : this.jumpMeasuredPeak;
      const norm = this.lowImpact ? DETECT.HEEL_CLEAN : DETECT.JUMP_APEX;
      const cleanAt = this.lowImpact ? DETECT.HEEL_CLEAN : DETECT.JUMP_CLEAN;
      this.jumpHeightSum += clamp01(peak / norm);
      if (peak >= cleanAt) this.cleanReps += 1;
      this.jumpStartTs = 0;
    }
    if (this.squatState !== 'neutral') {
      this.squatPeak = Math.max(this.squatPeak, this.crouch);
      this.finishSquatRep();
      this.squatState = 'neutral';
    }
  }

  /** Game-space jump height 0..~JUMP_APEX (ballistic arc). */
  private jumpY(): number {
    if (this.jumpStartTs === 0) return 0;
    const u = clamp01((this.lastTs - this.jumpStartTs) / 1000 / DETECT.JUMP_DURATION_S);
    return 4 * DETECT.JUMP_APEX * u * (1 - u);
  }

  // ── camera feel ───────────────────────────────────────────────────────

  private cameraY: number = CAMERA.EYE;
  private cameraPitch = 0;
  private fov: number = CAMERA.FOV_BASE;

  private updateCameraFeel(dt: number): void {
    const targetY =
      CAMERA.EYE -
      CAMERA.CROUCH_DIP * this.crouch +
      (this.jumpY() / DETECT.JUMP_APEX) * CAMERA.JUMP_RISE_M;
    const a = Math.min(1, dt * CAMERA.DAMP);
    this.cameraY += (targetY - this.cameraY) * a;
    const targetPitch = CAMERA.PITCH_CROUCH * this.crouch;
    this.cameraPitch += (targetPitch - this.cameraPitch) * a;
    const speedNorm =
      (this.speed - COURSE.SPEED_START) / (COURSE.SPEED_END - COURSE.SPEED_START);
    this.fov = CAMERA.FOV_BASE + CAMERA.FOV_SPEED_GAIN * clamp01(speedNorm);
  }

  // ── outputs ───────────────────────────────────────────────────────────

  getPhase(): RunnerPhase {
    return this.phase;
  }

  getSceneState(): RunnerSceneState {
    return {
      phase: this.phase,
      distance: this.distance,
      speed: this.speed,
      cameraY: this.cameraY,
      cameraPitch: this.cameraPitch,
      fov: this.fov,
      lives: this.lives,
      hitFlashAt: this.hitFlashAt,
      cue: this.cue,
      obstacles: this.obstacles.map((ob, i) => ({
        id: ob.id,
        type: ob.type,
        zAhead: ob.atDistance - this.distance,
        resolved: this.resolved[i],
        cleared: this.clearedFlags[i],
      })),
      lowImpact: this.lowImpact,
      crouch: this.crouch,
      jumpY: this.jumpY(),
    };
  }

  getHudMetrics(): HudMetrics {
    return {
      primary: { label: 'Dist', value: `${Math.floor(this.distance)}m` },
      secondary: { label: 'Lives', value: this.lives },
      repsDisplay: this.squatReps + this.jumpReps,
      cue: this.cue,
      tracking: this.isTracking(),
      drifting: this.driftActive,
      cleared: this.clearedFlags.filter(Boolean).length,
      total: this.obstacles.length,
    };
  }

  isComplete(): boolean {
    return this.phase === 'done';
  }

  getRawData(): RunnerRawData {
    const resolvedCount = this.resolved.filter(Boolean).length;
    const cleared = this.clearedFlags.filter(Boolean).length;
    const failed = resolvedCount - cleared;
    const totalReps = this.squatReps + this.jumpReps;
    const elapsed =
      this.playStartTs > 0 ? Math.max(0, this.lastTs - this.playStartTs) : 0;
    const avgReaction =
      this.reactionMsList.length > 0
        ? this.reactionMsList.reduce((a, b) => a + b, 0) / this.reactionMsList.length
        : 0;
    return {
      testId: 'KR1',
      distance: finite(Math.round(this.distance * 10) / 10),
      obstaclesTotal: this.obstacles.length,
      obstaclesCleared: cleared,
      obstaclesFailed: failed,
      squatReps: this.squatReps,
      jumpReps: this.jumpReps,
      avgSquatDepth: finite(
        this.squatReps > 0 ? this.squatDepthSum / this.squatReps : 0,
      ),
      avgJumpHeight: finite(
        this.jumpReps > 0 ? this.jumpHeightSum / this.jumpReps : 0,
      ),
      avgReactionMs: finite(Math.round(avgReaction)),
      cleanFormRate: finite(totalReps > 0 ? this.cleanReps / totalReps : 0),
      controlModeKeyboard: this.controlMode === 'keyboard' ? 1 : 0,
      lowImpact: this.lowImpact ? 1 : 0,
      assessmentValid:
        totalReps >= ASSESSMENT.MIN_REPS &&
        resolvedCount >= ASSESSMENT.MIN_OBSTACLES_RESOLVED
          ? 1
          : 0,
      seed: this.seed,
      elapsed: finite(Math.round(elapsed)),
    };
  }

  // ── debug overlay (2D canvas; the visible world is WebGL) ─────────────

  render(ctx: CanvasRenderingContext2D, width: number, height: number): void {
    if (!this.debug) return;
    const barW = 26;
    const x0 = 16;
    const y0 = height - 140;
    const drawBar = (x: number, v: number, gate: number, label: string, color: string) => {
      ctx.fillStyle = 'rgba(2,6,23,0.6)';
      ctx.fillRect(x, y0, barW, 120);
      ctx.fillStyle = color;
      const h = Math.min(1, Math.max(0, v)) * 120;
      ctx.fillRect(x, y0 + 120 - h, barW, h);
      ctx.strokeStyle = '#f8fafc';
      const gy = y0 + 120 - Math.min(1, gate) * 120;
      ctx.beginPath();
      ctx.moveTo(x - 3, gy);
      ctx.lineTo(x + barW + 3, gy);
      ctx.stroke();
      ctx.fillStyle = '#f8fafc';
      ctx.font = '10px monospace';
      ctx.fillText(label, x - 2, y0 + 134);
    };
    drawBar(x0, this.crouch, DETECT.SQUAT_CLEAR, 'crch', '#f59e0b');
    drawBar(x0 + 40, this.jumpY() / DETECT.JUMP_APEX, DETECT.JUMP_CLEAR / DETECT.JUMP_APEX, 'jump', '#06b6d4');
    ctx.fillStyle = '#f8fafc';
    ctx.font = '11px monospace';
    ctx.fillText(
      `d=${this.distance.toFixed(1)} v=${this.speed.toFixed(1)} lives=${this.lives} ${this.driftActive ? 'DRIFT' : ''}`,
      x0,
      y0 - 8,
    );
    void width;
  }
}
