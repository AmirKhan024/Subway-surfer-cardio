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
 *
 * HEAD mode (neck ROM): a third signal source — neck flexion (look down)
 * drives the same crouch/squat path, neck extension (look up) fires the same
 * jump arc. NOTE (safety, per Govind): extension→jump is a gentle POSITION
 * edge-trigger with NO velocity term — a velocity gate would train fast,
 * jerky neck extension, the riskier neck direction. NOTE (Neck Compass):
 * prod's FA3 measures head ROTATION (yaw) via an ear-span proxy — there is
 * no pitch math to reuse, so the signal here is nose-vs-shoulderMid
 * normalized by shoulder width (a RELATIVE head-movement proxy, not
 * goniometric cervical ROM; torso lean confounds it — the nose-vs-earMid
 * candidate is tracked for the debug overlay to evaluate on webcam).
 */
import type {
  GameEngine,
  NormalizedLandmark,
  CalibrationStatus,
  HudMetrics,
} from './types';
import { LM } from './types';
import {
  generateChunk,
  coinsForChunk,
  type Obstacle,
  type Coin,
} from './runner-timeline';
import {
  DETECT,
  CALIB,
  DRIFT,
  COURSE,
  CAMERA,
  KEYBOARD,
  HEAD,
  COIN,
  ASSESSMENT,
  LOCO,
  JUICE,
} from '@/components/games/runner/runner-constants';
import type { RunnerRawData } from '@/types/raw-data';

export type ControlMode = 'pose' | 'keyboard' | 'head';
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

export interface SceneCoin {
  id: number;
  zAhead: number;
  aerial: boolean;
  collected: boolean;
}

/**
 * Diagnostic event emitted by the engine and drained by the layer (which
 * forwards to the browser logger). Keeps the engine pure — it never touches
 * window/console itself.
 */
export interface EngineEvent {
  tag: string;
  data: Record<string, unknown>;
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
  coins: SceneCoin[];
  coinsCollected: number;
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

  // ── game clock / run gate ──
  // The world, session timer, and elapsed advance ONLY while runActive():
  // not manually paused, and (when locomotion gating is on — pose mode)
  // the user is actively moving and tracked. Future reposition handling
  // plugs into the same gate.
  /** accumulated ACTIVE play time in ms (the only time base for the timer) */
  private gameTimeMs = 0;
  private manuallyPaused = false;
  /** locomotion gate value; stays true unless gating is enabled (pose) */
  private locomotionActive = true;
  /** layer enables for pose mode only — head/keyboard keep auto-advance */
  private locomotionGating = false;
  /** session cap in ms; 0 = no timer (legacy/test behavior) */
  private sessionMs = 0;
  /** wall-ts when the world froze; 0 = live. Used to shift pending grace. */
  private frozenAt = 0;
  /** until this ts the world may not cross the nearest unresolved plane —
   *  armed on every gated resume so the player always gets cue + reaction
   *  time (releases early once the correct action is underway). 0 = off. */
  private resumeGraceUntil = 0;
  /** the grace clamp extended the window once the plane was reached (the
   *  glide back can eat the whole window otherwise) — one-shot per grace */
  private resumeHoldExtended = false;
  /** why the run ended; null while running. Drives the game-over/report copy. */
  private endReason: 'time' | 'lives' | null = null;
  /** next chunk index for the endless obstacle stream */
  private chunkIndex = 0;

  // ── calibration ──
  private calHoldStart = 0; // 0 = not holding
  private calStartTs = 0;
  private calTimeoutEmitted = false;
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
  /** last jump initiation (any mode) — drives the intent-based hurdle clear */
  private lastJumpTriggerTs = 0;
  private heelState: FsmState = 'neutral';
  private heelPeak = 0;
  /** true whenever pose landmarks were usable this frame */
  private trackingOk = false;

  // ── head-mode (neck ROM) signals ──
  private neckEma = 0;
  private neckEmaReady = false;
  private neckNeutral = 0;
  private calNeckSamples: number[] = [];
  /** raw peak neck flexion during the current squat-FSM episode (k units) */
  private headFlexPeakRep = 0;
  /** raw peak neck extension during the current jump episode (k units) */
  private headExtPeakRep = 0;
  private prevExtEngaged = false;
  private neckFlexSum = 0;
  private neckExtSum = 0;
  /** current signed neck delta (debug overlay) */
  private neckDeltaNow = 0;
  /** nose-vs-earMid candidate metric (debug overlay comparison) */
  private neckEarDeltaNow = 0;
  private earNeutral = 0;

  // ── drift guard (M2) ──
  private driftSince = 0;
  private driftActive = false;

  // ── locomotion (march/jog in place; pose gating only) ──
  /** calibrated shoulder-mid → hip-mid vertical distance (the scale ref) */
  private torsoLen0 = 0;
  /** slow EMA neutral line for the upper-body bounce */
  private locoBaseline = 0;
  private locoBaselineReady = false;
  /** last nonzero direction of the detrended bounce (+1 up / -1 down) */
  private locoPrevSign = 0;
  /** timestamps of recent qualifying direction-changes (rhythm window) */
  private locoCrossTimes: number[] = [];
  private lastStepTs = 0;
  /** debounced start achieved (requires rhythmic cadence, not one twitch) */
  private locoStarted = false;
  /** locomotion has started at least once this run — re-starts then need
   *  only REARM_CROSSINGS (kills the arm→collapse→full-debounce lurch) */
  private locoEverStarted = false;
  /** last LOCO_DIAG emission ts (debug-only instrumentation throttle) */
  private lastLocoDiagTs = 0;
  /** step phase for the game-feel head-bob (advances π per crossing) */
  private stepPhase = 0;
  /** per-knee baselines + last lifted leg for the knee-lift confirmation */
  private kneeBaseL = 0;
  private kneeBaseR = 0;
  private kneeBaseReady = false;
  private kneeLiftedL = false;
  private kneeLiftedR = false;
  private lastKneeLeg: 'L' | 'R' | null = null;
  /** eased world-speed factor for smooth stop/start (locomotion gating) */
  private speedFactor = 1;

  // ── world ──
  private obstacles: Obstacle[] = [];
  private resolved: boolean[] = [];
  private clearedFlags: boolean[] = [];
  /** hurdles awaiting the post-crossing jump grace before failing */
  private pendingHurdles: {
    index: number;
    crossTs: number;
    crouchAtGate: number;
    jumpYAtGate: number;
  }[] = [];
  // coins are ENGAGEMENT ONLY — they never feed the KR1 scoring bands
  private coins: Coin[] = [];
  /** plane crossed — no further checks (grabbed OR missed) */
  private coinDone: boolean[] = [];
  /** actually grabbed (scene plays the collect pop) */
  private coinCollected: boolean[] = [];
  private coinsCollected = 0;
  private distance = 0;
  private speed: number = COURSE.SPEED_START;
  private lives = COURSE.LIVES;
  private hitFlashAt = 0;

  // ── cue / reaction ──
  private cue: CueState | null = null;
  private cueShownAt: number[] = [];
  private reactionRecorded: boolean[] = [];
  private reactionMsList: number[] = [];

  // ── diagnostics (drained by the layer; engine stays pure) ──
  private events: EngineEvent[] = [];
  private emit(tag: string, data: Record<string, unknown> = {}): void {
    if (this.events.length < 256) this.events.push({ tag, data });
  }
  /** Returns and clears the pending diagnostic events (cheap array swap). */
  drainEvents(): EngineEvent[] {
    if (this.events.length === 0) return this.events;
    const out = this.events;
    this.events = [];
    return out;
  }

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
    this.lastJumpTriggerTs = 0;
    this.pendingHurdles = [];
    this.heelState = 'neutral';
    this.heelPeak = 0;
    this.trackingOk = false;
    this.driftSince = 0;
    this.driftActive = false;
    this.torsoLen0 = 0;
    this.locoBaselineReady = false;
    this.locoPrevSign = 0;
    this.locoCrossTimes = [];
    this.lastStepTs = 0;
    this.locoStarted = false;
    this.locoEverStarted = false;
    this.lastLocoDiagTs = 0;
    this.stepPhase = 0;
    this.kneeBaseReady = false;
    this.kneeLiftedL = false;
    this.kneeLiftedR = false;
    this.lastKneeLeg = null;
    this.speedFactor = 1;
    this.neckEmaReady = false;
    this.neckNeutral = 0;
    this.calNeckSamples = [];
    this.headFlexPeakRep = 0;
    this.headExtPeakRep = 0;
    this.prevExtEngaged = false;
    this.neckFlexSum = 0;
    this.neckExtSum = 0;
    this.neckDeltaNow = 0;
    this.neckEarDeltaNow = 0;
    this.earNeutral = 0;

    // endless: chunk 0 now, more appended as the player approaches the end
    this.obstacles = generateChunk(this.seed, 0, COURSE.LEAD_IN_M, 0);
    this.chunkIndex = 1;
    this.resolved = this.obstacles.map(() => false);
    this.clearedFlags = this.obstacles.map(() => false);
    this.coins = coinsForChunk(this.seed, 0, this.obstacles, 0);
    this.coinDone = this.coins.map(() => false);
    this.coinCollected = this.coins.map(() => false);
    this.coinsCollected = 0;
    this.cueShownAt = this.obstacles.map(() => 0);
    this.reactionRecorded = this.obstacles.map(() => false);
    this.distance = 0;
    this.speed = COURSE.SPEED_START;
    this.lives = COURSE.LIVES;
    this.hitFlashAt = 0;
    // game clock (sessionMs/locomotionGating are config — they survive reset)
    this.gameTimeMs = 0;
    this.manuallyPaused = false;
    this.locomotionActive = true;
    this.frozenAt = 0;
    this.resumeGraceUntil = 0;
    this.resumeHoldExtended = false;
    this.endReason = null;
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
    this.landSpringT = -1;
    this.fovPunch = 0;
    this.jogBobT = 0;

    if (this.controlMode === 'keyboard') {
      // No camera baseline needed — keyboard is instantly "calibrated".
      this.calibrated = true;
      this.phase = 'ready';
    }
    this.emit('RUN_RESET', {
      seed: this.seed,
      controlMode: this.controlMode,
      lowImpact: this.lowImpact,
      obstacles: this.obstacles.length,
    });
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

  /**
   * Camera-bob amplitude 0..1 (comfort/accessibility; respects
   * prefers-reduced-motion upstream). Scales the FEEDBACK only — detection
   * gates and scoring are untouched.
   */
  setBobScale(v: number): void {
    this.bobScale = clamp01(v);
  }

  setControlInput(input: Partial<ControlInput>): void {
    if (input.crouchHeld !== undefined) this.input.crouchHeld = input.crouchHeld;
    if (input.jumpPressed) this.input.jumpPressed = true;
  }

  /** Real pause: freezes world, session timer, and elapsed via the run gate. */
  setPaused(paused: boolean): void {
    this.manuallyPaused = paused;
  }

  isPaused(): boolean {
    return this.manuallyPaused;
  }

  /** Session length in ms; 0 disables the timer (legacy behavior). */
  setSessionMs(ms: number): void {
    this.sessionMs = Math.max(0, ms);
  }

  /**
   * Enable locomotion gating (pose mode only — the layer decides). When on,
   * the world advances only while the user marches/jogs and is tracked.
   * Off by default so head/keyboard (and the test suite) keep auto-advance.
   */
  setLocomotionGating(on: boolean): void {
    this.locomotionGating = on;
  }

  /** ms remaining in the session, or null when no timer is set. */
  getTimerRemainingMs(): number | null {
    return this.sessionMs > 0 ? Math.max(0, this.sessionMs - this.gameTimeMs) : null;
  }

  /** The single gate world/timer advancement runs through. */
  isRunActive(): boolean {
    if (this.manuallyPaused) return false;
    if (this.locomotionGating && (!this.locomotionActive || !this.trackingOk)) return false;
    return true;
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
      if (!this.calTimeoutEmitted) {
        this.calTimeoutEmitted = true;
        this.emit('CALIB_TIMEOUT', { heldMs: now - this.calHoldStart });
      }
      return {
        isReady: false,
        progress: 0,
        isTimedOut: true,
        message: 'Tap to retry',
      };
    }

    const isHead = this.controlMode === 'head';
    const ok = isHead ? this.headVisible(landmarks) : this.fullBodyVisible(landmarks);
    if (!ok) {
      this.calHoldStart = 0;
      this.calHipSamples = [];
      this.calShoulderSamples = [];
      this.calNeckSamples = [];
      return {
        isReady: false,
        progress: 0,
        message: isHead
          ? 'Face the camera — head and shoulders in frame'
          : 'Get your whole body in frame',
      };
    }

    const shoulderW = Math.abs(landmarks[LM.LEFT_SHOULDER].x - landmarks[LM.RIGHT_SHOULDER].x);
    // head mode is seated-friendly: stability tracks the NOSE, and hips are
    // never read (they may be out of frame)
    const shoulderMidY = (landmarks[LM.LEFT_SHOULDER].y + landmarks[LM.RIGHT_SHOULDER].y) / 2;
    const stabilityY = isHead
      ? landmarks[LM.NOSE].y
      : (landmarks[LM.LEFT_HIP].y + landmarks[LM.RIGHT_HIP].y) / 2;

    // wobble check: restart the hold if the anchor moved
    if (this.calHipSamples.length > 0) {
      const mean =
        this.calHipSamples.reduce((a, b) => a + b, 0) / this.calHipSamples.length;
      if (Math.abs(stabilityY - mean) > CALIB.MAX_WOBBLE) {
        this.calHoldStart = 0;
        this.calHipSamples = [];
        this.calShoulderSamples = [];
        this.calNeckSamples = [];
        this.emit('CALIB_WOBBLE_RESET', { y: stabilityY, mean });
      }
    }

    if (this.calHoldStart === 0) this.calHoldStart = now;
    this.calHipSamples.push(stabilityY);
    this.calShoulderSamples.push(shoulderW);
    if (isHead) {
      const k = Math.max(0.05, shoulderW);
      this.calNeckSamples.push((shoulderMidY - landmarks[LM.NOSE].y) / k);
    }

    const heldMs = now - this.calHoldStart;
    const progress = clamp01(heldMs / CALIB.HOLD_MS);
    if (heldMs >= CALIB.HOLD_MS && this.calHipSamples.length >= 10) {
      this.shoulderW0 =
        this.calShoulderSamples.reduce((a, b) => a + b, 0) /
        this.calShoulderSamples.length;
      if (isHead) {
        this.neckNeutral =
          this.calNeckSamples.reduce((a, b) => a + b, 0) / this.calNeckSamples.length;
        this.earNeutral = this.earPitchOf(landmarks) ?? 0;
      } else {
        this.hipY0 =
          this.calHipSamples.reduce((a, b) => a + b, 0) / this.calHipSamples.length;
        const heels = this.heelYOf(landmarks);
        this.heelY0 = heels ?? this.hipY0 + 0.35;
        // locomotion scale reference: torso length (shoulder-mid → hip-mid).
        // Normalizing the bounce by this — never raw frame units — is what
        // keeps march detection identical across devices/distances.
        const sMidY =
          (landmarks[LM.LEFT_SHOULDER].y + landmarks[LM.RIGHT_SHOULDER].y) / 2;
        const hMidY = (landmarks[LM.LEFT_HIP].y + landmarks[LM.RIGHT_HIP].y) / 2;
        this.torsoLen0 = Math.max(0.08, Math.abs(hMidY - sMidY));
      }
      this.calibrated = true;
      this.phase = 'ready';
      this.emit('CALIB_LOCK', {
        hipY0: this.hipY0,
        shoulderW0: this.shoulderW0,
        neckNeutral: isHead ? this.neckNeutral : undefined,
        heldMs,
      });
      return { isReady: true, progress: 1, message: 'Locked in!' };
    }

    return {
      isReady: false,
      progress,
      message: isHead ? 'Hold still, chin level…' : 'Hold still…',
    };
  }

  /** Head mode needs only nose + both shoulders — works seated. */
  private headVisible(landmarks: NormalizedLandmark[]): boolean {
    if (!landmarks || landmarks.length < 33) return false;
    const need = [LM.NOSE, LM.LEFT_SHOULDER, LM.RIGHT_SHOULDER];
    return need.every((i) => landmarks[i] && landmarks[i].visibility >= CALIB.MIN_VISIBILITY);
  }

  /** nose-vs-earMid pitch candidate (k units); null if ears not visible. */
  private earPitchOf(landmarks: NormalizedLandmark[]): number | null {
    const le = landmarks[LM.LEFT_EAR];
    const re = landmarks[LM.RIGHT_EAR];
    if (!le || !re || le.visibility < 0.3 || re.visibility < 0.3) return null;
    const earMidY = (le.y + re.y) / 2;
    const k = Math.max(0.05, this.shoulderW0 || 0.2);
    return (earMidY - landmarks[LM.NOSE].y) / k;
  }

  resetCalibration(): void {
    this.calibrated = false;
    this.calStartTs = 0;
    this.calHoldStart = 0;
    this.calTimeoutEmitted = false;
    this.emit('CALIB_RETRY', {});
    this.calHipSamples = [];
    this.calShoulderSamples = [];
    this.calNeckSamples = [];
    if (this.controlMode !== 'keyboard') this.phase = 'calibrating';
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
    if (!this.calibrated && this.controlMode !== 'keyboard') return;
    this.phase = 'playing';
    this.playStartTs = this.lastTs;
    // gated runs begin at rest — the world moves when the user does
    this.speedFactor = this.locomotionGating ? 0 : 1;
  }

  processFrame(landmarks: NormalizedLandmark[], timestampMs: number): void {
    const dt = this.lastTs === 0 ? 0 : Math.min(0.1, Math.max(0, (timestampMs - this.lastTs) / 1000));
    this.lastTs = timestampMs;
    if (this.playStartTs === 0 && this.phase === 'playing') this.playStartTs = timestampMs;

    // 1. control signals (both phases update signals so the HUD/pip stay live)
    if (this.controlMode === 'pose') {
      this.updatePoseSignals(landmarks, timestampMs, dt);
    } else if (this.controlMode === 'head') {
      this.updateHeadSignals(landmarks, timestampMs, dt);
    } else {
      this.updateKeyboardSignals(timestampMs, dt);
    }

    if (this.phase !== 'playing' || dt === 0) {
      this.updateCameraFeel(dt);
      return;
    }

    // 1b. the run gate — while inactive the world holds (obstacles, timer,
    // elapsed all freeze) and resumes smoothly. A camera/rest problem must
    // never cost a life or skew the score.
    if (!this.isRunActive()) {
      if (this.frozenAt === 0) {
        this.frozenAt = timestampMs;
        this.emit('RUN_FREEZE', { paused: this.manuallyPaused, tracking: this.trackingOk });
      }
      // Locomotion stops decelerate to a halt (never a hard stop — that feels
      // broken), clamped so the coast can NEVER cross an unresolved obstacle
      // plane. Manual pause freezes instantly — that's user intent.
      if (!this.manuallyPaused && this.locomotionGating && this.speedFactor > 0) {
        // gap grace: a brief detection hiccup must not visibly slow the
        // world — hold speed flat, then decay (clamp below still protects)
        if (timestampMs - this.frozenAt >= LOCO.GAP_GRACE_MS) {
          this.speedFactor = Math.max(0, this.speedFactor - LOCO.DECEL_PER_S * dt);
        }
        let step = this.speed * this.speedFactor * dt;
        // reaction-based margin: halt far enough back that the resume ramp
        // still leaves visible cue runway before the plane
        const stopMargin = Math.max(LOCO.STOP_MARGIN_M, this.speed * LOCO.STOP_REACTION_S);
        for (let i = 0; i < this.obstacles.length; i++) {
          if (!this.resolved[i] && this.obstacles[i].atDistance > this.distance) {
            step = Math.min(
              step,
              Math.max(0, this.obstacles[i].atDistance - stopMargin - this.distance),
            );
            break;
          }
        }
        this.distance += step;
      }
      this.updateCameraFeel(dt);
      return;
    }
    if (this.frozenAt !== 0) {
      // shift pending hurdle grace by the frozen span so a freeze mid-grace
      // can't cause an instant unfair fail on resume
      const frozenSpan = timestampMs - this.frozenAt;
      for (const p of this.pendingHurdles) p.crossTs += frozenSpan;
      this.frozenAt = 0;
      // fairness: after any gated resume the nearest unresolved plane may
      // not be crossed until the player has had a real reaction window
      if (this.locomotionGating) {
        this.resumeGraceUntil = timestampMs + LOCO.RESUME_REACTION_MS;
        this.resumeHoldExtended = false;
      }
      this.emit('RUN_RESUME', { frozenMs: Math.round(frozenSpan) });
    }
    this.speedFactor = Math.min(1, this.speedFactor + LOCO.ACCEL_PER_S * dt);
    this.gameTimeMs += dt * 1000;

    // 2. world advance (endless: spawn the next chunk before we get there)
    this.appendChunksIfNeeded();
    const speedT = clamp01(this.distance / COURSE.RAMP_DISTANCE_M);
    this.speed = COURSE.SPEED_START + (COURSE.SPEED_END - COURSE.SPEED_START) * speedT;
    const prevDistance = this.distance;
    this.distance += this.speed * this.speedFactor * dt;

    // 2b. resume grace: hold just short of the nearest unresolved plane
    // until the reaction window elapses — unless the player is already
    // performing the correct action, in which case release immediately so
    // the crossing happens while the intent is fresh.
    if (this.resumeGraceUntil !== 0) {
      if (timestampMs >= this.resumeGraceUntil) {
        this.resumeGraceUntil = 0;
      } else {
        for (let i = 0; i < this.obstacles.length; i++) {
          if (this.resolved[i] || this.obstacles[i].atDistance <= prevDistance) continue;
          const ob = this.obstacles[i];
          const acted =
            ob.type === 'beam'
              ? this.crouch > DETECT.SQUAT_CLEAR
              : this.jumpStartTs !== 0 ||
                (this.lastJumpTriggerTs > 0 &&
                  timestampMs - this.lastJumpTriggerTs <= DETECT.JUMP_PRE_WINDOW_MS);
          if (acted) {
            this.resumeGraceUntil = 0;
          } else {
            const hold = Math.max(prevDistance, ob.atDistance - LOCO.RESUME_HOLD_EPS_M);
            if (this.distance > hold) {
              this.distance = hold;
              // the glide back to the plane may have eaten most of the
              // window — guarantee a visible beat AT the plane (one-shot)
              if (!this.resumeHoldExtended) {
                this.resumeHoldExtended = true;
                this.resumeGraceUntil = Math.max(
                  this.resumeGraceUntil,
                  timestampMs + LOCO.RESUME_HOLD_MIN_MS,
                );
              }
            }
          }
          break;
        }
      }
    }

    // 3. resolve obstacles whose action plane was crossed this frame
    for (let i = 0; i < this.obstacles.length; i++) {
      if (this.resolved[i]) continue;
      const ob = this.obstacles[i];
      if (prevDistance < ob.atDistance && this.distance >= ob.atDistance) {
        this.resolveObstacle(i, timestampMs);
      }
    }

    // 3b. coins crossed this frame (ground auto-collect; aerial needs height)
    for (let i = 0; i < this.coins.length; i++) {
      if (this.coinDone[i]) continue;
      const coin = this.coins[i];
      if (prevDistance < coin.atDistance && this.distance >= coin.atDistance) {
        this.coinDone[i] = true;
        const grabbed = coin.aerial ? this.jumpY() >= COIN.AERIAL_JUMPY : true;
        if (grabbed) {
          this.coinCollected[i] = true;
          this.coinsCollected += 1;
          this.emit('COIN', { id: coin.id, aerial: coin.aerial, total: this.coinsCollected });
        }
        // missed aerial: just slides past the player, no pop
      }
    }

    // 3c. decide hurdles waiting out the post-crossing jump grace
    this.processPendingHurdles(timestampMs);

    // 4. cue for the nearest unresolved obstacle
    this.updateCue(timestampMs);

    // 5. finish conditions (endless: only the timer or the lives end a run)
    const timeUp = this.sessionMs > 0 && this.gameTimeMs >= this.sessionMs;
    if (this.lives <= 0 || timeUp) {
      this.phase = 'done';
      this.finalizePendingReps();
      this.endReason = timeUp ? 'time' : 'lives';
      this.emit('RUN_DONE', {
        lives: this.lives,
        resolved: this.resolved.filter(Boolean).length,
        cleared: this.clearedFlags.filter(Boolean).length,
        distance: this.distance,
        reason: this.endReason,
      });
    }

    this.updateCameraFeel(dt);
  }

  private resolveObstacle(i: number, now: number): void {
    const ob = this.obstacles[i];

    if (ob.type === 'beam') {
      // squat is a HOLD signal — sampling at the crossing is reliable
      this.finishObstacle(i, now, this.crouch > DETECT.SQUAT_CLEAR, {
        crouchAtGate: this.crouch,
        jumpYAtGate: this.jumpY(),
      });
      return;
    }

    // NOTE (hurdles): success is INTENT-based, not an arc sample. The old
    // single-frame jumpY>JUMP_CLEAR check only accepted takeoffs ~0.14-0.56s
    // before the plane — real jumps slightly early/late cost a life. Now:
    // cleared if airborne at the crossing OR a jump was initiated within
    // JUMP_PRE_WINDOW_MS; otherwise the fail is DEFERRED by
    // JUMP_POST_GRACE_MS so a just-late jump still counts. jumpY() remains
    // visual-only (camera bob, aerial coins, debug bars).
    const msSinceJump = this.lastJumpTriggerTs > 0 ? now - this.lastJumpTriggerTs : Infinity;
    const intentCleared = this.jumpStartTs !== 0 || msSinceJump <= DETECT.JUMP_PRE_WINDOW_MS;
    if (intentCleared) {
      this.finishObstacle(i, now, true, {
        crouchAtGate: this.crouch,
        jumpYAtGate: this.jumpY(),
        intentCleared: true,
        msSinceJump: Number.isFinite(msSinceJump) ? Math.round(msSinceJump) : -1,
      });
    } else {
      this.pendingHurdles.push({
        index: i,
        crossTs: now,
        crouchAtGate: this.crouch,
        jumpYAtGate: this.jumpY(),
      });
    }
  }

  /** Decide pending hurdles: a jump initiated during the grace retro-clears. */
  private processPendingHurdles(now: number): void {
    if (this.pendingHurdles.length === 0) return;
    const remaining: typeof this.pendingHurdles = [];
    for (const p of this.pendingHurdles) {
      if (this.lastJumpTriggerTs >= p.crossTs) {
        this.finishObstacle(p.index, now, true, {
          crouchAtGate: p.crouchAtGate,
          jumpYAtGate: p.jumpYAtGate,
          intentCleared: true,
          retroCleared: true,
          msSinceJump: -Math.round(this.lastJumpTriggerTs - p.crossTs), // negative = after
        });
      } else if (now >= p.crossTs + DETECT.JUMP_POST_GRACE_MS) {
        this.finishObstacle(p.index, now, false, {
          crouchAtGate: p.crouchAtGate,
          jumpYAtGate: p.jumpYAtGate,
          graceExpired: true,
        });
      } else {
        remaining.push(p);
      }
    }
    this.pendingHurdles = remaining;
  }

  private finishObstacle(
    i: number,
    now: number,
    cleared: boolean,
    logData: Record<string, unknown>,
  ): void {
    const ob = this.obstacles[i];
    this.resolved[i] = true;
    this.clearedFlags[i] = cleared;
    if (!cleared) {
      this.lives -= 1;
      this.hitFlashAt = now;
    }
    if (this.cue?.obstacleId === ob.id) this.cue = null;
    // the "why did I fail that one" log: signal values AT the gate
    this.emit('OBSTACLE', {
      id: ob.id,
      type: ob.type,
      cleared,
      livesLeft: this.lives,
      ...logData,
    });
  }

  private updateCue(now: number): void {
    // first unresolved obstacle AHEAD of the player (a pending-grace hurdle
    // behind us must not re-show its cue)
    const idx = this.obstacles.findIndex(
      (ob, i) => !this.resolved[i] && ob.atDistance >= this.distance,
    );
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
      // re-arm once landed and roughly upright. NOTE: relaxed from the strict
      // neutral band (|drop|<0.08) to drop<SQUAT_ENGAGE — landing slightly
      // forward/crouched used to wedge the jump disarmed. The velocity gate
      // still prevents false re-triggers.
      if (!this.jumpArmed && drop < DETECT.SQUAT_ENGAGE && this.jumpStartTs === 0) {
        this.jumpArmed = true;
      }
    }

    this.updateDriftGuard(landmarks, drop, now);
    this.updateLocomotion(landmarks, now);
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

  // ── locomotion: march/jog in place (pose mode) ────────────────────────

  /**
   * Primary signal = rhythmic small-amplitude vertical bounce of the
   * shoulder-mid, normalized by the calibrated torso length. The upper body
   * is ALWAYS in frame (legs often aren't on laptop setups), so this works
   * regardless of framing. Secondary confirmation = alternating knee lifts
   * when the legs are visible. Large excursions (jump/squat) are excluded
   * and momentum carries locomotion THROUGH those actions so a jump never
   * stalls the runner.
   */
  private updateLocomotion(landmarks: NormalizedLandmark[], now: number): void {
    if (this.torsoLen0 <= 0) return;
    const ls = landmarks[LM.LEFT_SHOULDER];
    const rs = landmarks[LM.RIGHT_SHOULDER];
    if (!ls || !rs || ls.visibility < 0.4 || rs.visibility < 0.4) {
      this.updateLocomotionActive(now, false);
      return;
    }
    const sMidY = (ls.y + rs.y) / 2;
    if (!this.locoBaselineReady) {
      this.locoBaseline = sMidY;
      this.locoBaselineReady = true;
    }
    // the jump/squat FSMs own big excursions; suspend step detection there
    // (momentum keeps locomotion alive — see updateLocomotionActive)
    const fsmActive = this.jumpStartTs !== 0 || this.crouch > 0.25;

    // detrended bounce in torso units (+ = above neutral)
    const osc = (this.locoBaseline - sMidY) / this.torsoLen0;

    // neutral line adapts only in calm, small-excursion moments
    if (!fsmActive && Math.abs(osc) < LOCO.MAX_AMP) {
      this.locoBaseline += LOCO.BASELINE_ALPHA * (sMidY - this.locoBaseline);
    }

    if (!fsmActive && Math.abs(osc) <= LOCO.MAX_AMP) {
      const sign = osc > LOCO.MIN_AMP ? 1 : osc < -LOCO.MIN_AMP ? -1 : 0;
      if (sign !== 0 && sign !== this.locoPrevSign) {
        if (this.locoPrevSign !== 0) this.registerStepEvent(now);
        this.locoPrevSign = sign;
      }
      // knee-lift confirmation (earlier/stronger when legs are in frame)
      this.updateKneeLift(landmarks, now);
    }

    this.updateLocomotionActive(now, fsmActive);
  }

  /** Alternating knee raises feed the same step stream as the bounce. */
  private updateKneeLift(landmarks: NormalizedLandmark[], now: number): void {
    const lk = landmarks[LM.LEFT_KNEE];
    const rk = landmarks[LM.RIGHT_KNEE];
    if (!lk || !rk || lk.visibility < 0.5 || rk.visibility < 0.5) return;
    if (!this.kneeBaseReady) {
      this.kneeBaseL = lk.y;
      this.kneeBaseR = rk.y;
      this.kneeBaseReady = true;
      return;
    }
    this.kneeBaseL += LOCO.BASELINE_ALPHA * (lk.y - this.kneeBaseL);
    this.kneeBaseR += LOCO.BASELINE_ALPHA * (rk.y - this.kneeBaseR);
    const liftL = (this.kneeBaseL - lk.y) / this.torsoLen0 > LOCO.KNEE_LIFT;
    const liftR = (this.kneeBaseR - rk.y) / this.torsoLen0 > LOCO.KNEE_LIFT;
    if (liftL && !this.kneeLiftedL && this.lastKneeLeg !== 'L') {
      this.lastKneeLeg = 'L';
      this.registerStepEvent(now);
    }
    if (liftR && !this.kneeLiftedR && this.lastKneeLeg !== 'R') {
      this.lastKneeLeg = 'R';
      this.registerStepEvent(now);
    }
    this.kneeLiftedL = liftL;
    this.kneeLiftedR = liftR;
  }

  /** A qualifying rhythm event: validates cadence, drives start + momentum. */
  private registerStepEvent(now: number): void {
    const last = this.locoCrossTimes[this.locoCrossTimes.length - 1];
    const gap = last !== undefined ? now - last : Infinity;
    if (gap < LOCO.CROSS_MIN_MS) return; // jitter — too fast to be a step
    if (gap > LOCO.CROSS_MAX_MS) {
      // rhythm broken — restart the cadence window
      this.locoCrossTimes = [now];
      return;
    }
    this.locoCrossTimes.push(now);
    if (this.locoCrossTimes.length > 8) this.locoCrossTimes.shift();
    this.lastStepTs = now;
    this.stepPhase += Math.PI;
    if (!this.locoStarted) {
      // first start keeps the full anti-twitch debounce; once locomotion has
      // been established this run, recovery after a brief stall is fast —
      // demanding 4 fresh crossings mid-run reads as "pushed backward"
      const needed = this.locoEverStarted ? LOCO.REARM_CROSSINGS : LOCO.START_CROSSINGS;
      const inWindow = this.locoCrossTimes.filter((t) => now - t <= LOCO.START_WINDOW_MS);
      if (inWindow.length >= needed) {
        this.locoStarted = true;
        this.locoEverStarted = true;
        this.emit('LOCO_START', { needed });
      }
    }
  }

  /** Momentum + decay: active while stepping recently OR mid-jump/squat. */
  private updateLocomotionActive(now: number, fsmActive: boolean): void {
    if (!this.locomotionGating) return; // inert unless the layer enabled gating
    const wasActive = this.locomotionActive;
    if (!this.locoStarted) {
      this.locomotionActive = false;
    } else if (fsmActive) {
      // a jump/squat is not "stopping" — momentum carries through the action
      this.lastStepTs = Math.max(this.lastStepTs, now - LOCO.STEP_TIMEOUT_MS / 2);
      this.locomotionActive = true;
    } else {
      this.locomotionActive = now - this.lastStepTs <= LOCO.STEP_TIMEOUT_MS;
      if (!this.locomotionActive) {
        // fully stopped: require a fresh debounced start to move again
        this.locoStarted = false;
        this.locoCrossTimes = [];
      }
    }
    if (wasActive !== this.locomotionActive) {
      this.emit(this.locomotionActive ? 'LOCO_ON' : 'LOCO_OFF', {
        msSinceStep: this.lastStepTs > 0 ? Math.round(now - this.lastStepTs) : -1,
        speedFactor: Math.round(this.speedFactor * 100) / 100,
      });
    }
    // debug-only startup/lurch instrumentation (?debug=1): throttled trace of
    // the locomotion state machine — zero prod-path cost beyond one boolean
    if (this.debug && now - this.lastLocoDiagTs >= 250) {
      this.lastLocoDiagTs = now;
      this.emit('LOCO_DIAG', {
        sf: Math.round(this.speedFactor * 100) / 100,
        started: this.locoStarted,
        active: this.locomotionActive,
        crossings: this.locoCrossTimes.length,
        msSinceStep: this.lastStepTs > 0 ? Math.round(now - this.lastStepTs) : -1,
      });
    }
  }

  /** Layer-facing locomotion snapshot (hints + auto-pause UX). */
  getLocomotionState(): {
    gated: boolean;
    started: boolean;
    active: boolean;
    msSinceStep: number;
  } {
    return {
      gated: this.locomotionGating,
      started: this.locoStarted,
      active: this.locomotionActive,
      msSinceStep: this.lastStepTs > 0 ? Math.max(0, this.lastTs - this.lastStepTs) : -1,
    };
  }

  // ── detection: head / neck ROM ────────────────────────────────────────

  /**
   * Neck flexion (look down) drives the SAME crouch/squat path; neck
   * extension (look up) fires the SAME jump arc. Downstream (gates, cue,
   * camera bob, lives, scoring) is untouched.
   *
   * NOTE (safety): extension→jump is a POSITION edge-trigger crossing
   * HEAD.EXT_RISE — deliberately NO velocity term, so nothing ever rewards
   * a fast/jerky look-up. Re-arms only after return-to-neutral.
   */
  private updateHeadSignals(landmarks: NormalizedLandmark[], now: number, dt: number): void {
    const usable =
      landmarks &&
      landmarks.length >= 33 &&
      landmarks[LM.NOSE]?.visibility >= 0.4 &&
      landmarks[LM.LEFT_SHOULDER]?.visibility >= 0.4 &&
      landmarks[LM.RIGHT_SHOULDER]?.visibility >= 0.4;
    this.trackingOk = !!usable;

    if (!usable || !this.calibrated) {
      this.crouch = Math.max(0, this.crouch - dt * 2);
      this.advanceJumpArc(now, dt);
      return;
    }

    const k = this.liveScale(landmarks);
    const shoulderMidY = (landmarks[LM.LEFT_SHOULDER].y + landmarks[LM.RIGHT_SHOULDER].y) / 2;
    const neckPitchRaw = (shoulderMidY - landmarks[LM.NOSE].y) / k;
    if (!this.neckEmaReady) {
      this.neckEma = neckPitchRaw;
      this.neckEmaReady = true;
    } else {
      this.neckEma = HEAD.EMA_ALPHA * neckPitchRaw + (1 - HEAD.EMA_ALPHA) * this.neckEma;
    }
    const neckDelta = this.neckEma - this.neckNeutral; // + = looking UP
    this.neckDeltaNow = neckDelta;
    // torso-invariant metric candidate for the webcam comparison (debug only)
    const earPitch = this.earPitchOf(landmarks);
    this.neckEarDeltaNow = earPitch !== null ? earPitch - this.earNeutral : 0;

    const flex = Math.max(0, -neckDelta); // look-down magnitude
    const ext = Math.max(0, neckDelta); // look-up magnitude

    // ── flexion → the shared squat/crouch path ──
    this.crouch = clamp01((flex - HEAD.FLEX_ENGAGE) / HEAD.FLEX_SPAN);
    if (this.squatState !== 'neutral' || flex > HEAD.NEUTRAL_BAND) {
      this.headFlexPeakRep = Math.max(this.headFlexPeakRep, flex);
    }
    // synthetic drop keeps the shared FSM's thresholds meaningful (keyboard
    // uses the same mapping); 0 once flexion is back inside the neutral band
    const pseudoDrop =
      flex > HEAD.NEUTRAL_BAND ? DETECT.SQUAT_ENGAGE + this.crouch * DETECT.SQUAT_SPAN : 0;
    this.stepSquatFsm(pseudoDrop, now);

    // ── extension → the shared jump arc (position edge-trigger) ──
    const extEngaged = ext > HEAD.EXT_RISE;
    if (extEngaged && !this.prevExtEngaged && this.jumpArmed && this.jumpStartTs === 0) {
      this.triggerJump(now);
      this.headExtPeakRep = ext;
    }
    this.prevExtEngaged = extEngaged;
    if (this.jumpStartTs !== 0 || !this.jumpArmed) {
      this.headExtPeakRep = Math.max(this.headExtPeakRep, ext);
    }
    if (!this.jumpArmed && this.jumpStartTs === 0 && Math.abs(neckDelta) < HEAD.NEUTRAL_BAND) {
      this.jumpArmed = true;
    }

    this.updateDriftGuard(landmarks, neckDelta, now);
    this.advanceJumpArc(now, dt);

    // slow-adapting neutral (posture settles over a run) — only while idle
    if (
      this.squatState === 'neutral' &&
      this.jumpStartTs === 0 &&
      this.jumpArmed &&
      Math.abs(neckDelta) < HEAD.NEUTRAL_BAND
    ) {
      this.neckNeutral = this.neckNeutral + DRIFT.BASELINE_ALPHA * (this.neckEma - this.neckNeutral);
    }
  }

  private stepSquatFsm(drop: number, now: number): void {
    switch (this.squatState) {
      case 'neutral':
        if (drop > DETECT.SQUAT_ENGAGE) {
          this.squatState = 'active';
          this.squatPeak = this.crouch;
          this.recordReaction('squat', now);
          // audio hook: REP fires at rep COMPLETION, too late for a sound
          this.emit('SQUAT_START', { mode: this.controlMode });
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
    // frozen world: repositioning/paused movement never counts as a rep
    if (this.phase === 'playing' && !this.isRunActive()) {
      this.squatPeak = 0;
      this.headFlexPeakRep = 0;
      return;
    }
    if (this.squatPeak < DETECT.SQUAT_REP_MIN) {
      this.squatPeak = 0;
      this.headFlexPeakRep = 0;
      return; // too shallow to count as an attempt
    }
    this.squatReps += 1;
    this.squatDepthSum += this.squatPeak;
    // NOTE (head mode, per Govind): the ONE authoritative clean definition
    // is the RAW neck excursion vs HEAD.FLEX_CLEAN — never the derived
    // game-space crouch (DETECT.SQUAT_CLEAN is body-mode-only).
    const isHead = this.controlMode === 'head';
    const clean = isHead
      ? this.headFlexPeakRep >= HEAD.FLEX_CLEAN
      : this.squatPeak >= DETECT.SQUAT_CLEAN;
    if (clean) this.cleanReps += 1;
    if (isHead) {
      this.neckFlexSum += Math.min(this.headFlexPeakRep, HEAD.MAX_EXCURSION);
      this.emit('REP', {
        kind: 'neck-flexion',
        peak: this.headFlexPeakRep,
        clean,
      });
    } else {
      this.emit('REP', { kind: 'squat', peak: this.squatPeak, clean });
    }
    this.squatPeak = 0;
    this.headFlexPeakRep = 0;
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
    const wasDrifting = this.driftActive;
    if (scaleOff) {
      if (this.driftSince === 0) this.driftSince = now;
      this.driftActive = now - this.driftSince > DRIFT.SUSTAIN_MS;
    } else {
      this.driftSince = 0;
      this.driftActive = false;
    }
    if (this.driftActive !== wasDrifting) {
      this.emit(this.driftActive ? 'DRIFT_ON' : 'DRIFT_OFF', {
        shoulderW,
        shoulderW0: this.shoulderW0,
      });
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
    // frozen world (paused / not marching / untracked): movement is not a rep
    // and must not arm the intent-based hurdle clear
    if (this.phase === 'playing' && !this.isRunActive()) return;
    this.jumpStartTs = now;
    this.lastJumpTriggerTs = now;
    this.jumpArmed = false;
    this.jumpMeasuredPeak = 0;
    this.jumpReps += 1;
    this.recordReaction('jump', now);
    // juice is BODY-mode feel only — neck ROM has no physical jump/landing
    if (this.controlMode === 'pose') this.fovPunch += JUICE.FOV_PUNCH_JUMP;
    this.emit('JUMP_TRIGGER', { mode: this.controlMode, lowImpact: this.lowImpact });
  }

  private advanceJumpArc(now: number, _dt: number): void {
    if (this.jumpStartTs === 0) return;
    const t = (now - this.jumpStartTs) / 1000;
    if (t >= DETECT.JUMP_DURATION_S) {
      this.bankJumpRep(false);
      this.jumpStartTs = 0;
      // landing beat: BODY-mode feel only (neck ROM has no physical landing)
      if (this.controlMode === 'pose') {
        this.landSpringT = 0;
        this.fovPunch += JUICE.FOV_PUNCH_LAND;
      }
      this.emit('LAND', { mode: this.controlMode });
    }
  }

  /**
   * Landing: bank the rep quality. Each mode judges "clean" against ITS OWN
   * measured excursion — heel lift for low-impact, RAW neck extension vs
   * HEAD.EXT_CLEAN for head mode (never the game arc), hip rise for body.
   */
  private bankJumpRep(finalized: boolean): void {
    if (this.controlMode === 'head') {
      const peak = this.headExtPeakRep;
      const clean = peak >= HEAD.EXT_CLEAN;
      if (clean) this.cleanReps += 1;
      this.neckExtSum += Math.min(peak, HEAD.MAX_EXCURSION);
      this.jumpHeightSum += 1; // game-space arc is fixed in head mode
      this.emit('REP', { kind: 'neck-extension', peak, clean, ...(finalized && { finalized }) });
      this.headExtPeakRep = 0;
      return;
    }
    const peak = this.controlMode === 'keyboard' ? DETECT.JUMP_APEX : this.jumpMeasuredPeak;
    const norm = this.lowImpact ? DETECT.HEEL_CLEAN : DETECT.JUMP_APEX;
    const cleanAt = this.lowImpact ? DETECT.HEEL_CLEAN : DETECT.JUMP_CLEAN;
    this.jumpHeightSum += clamp01(peak / norm);
    const clean = peak >= cleanAt;
    if (clean) this.cleanReps += 1;
    this.emit('REP', {
      kind: this.lowImpact ? 'heel' : 'jump',
      peak,
      clean,
      ...(finalized && { finalized }),
    });
  }

  /**
   * The run can end mid-rep (final obstacle resolves while airborne or still
   * squatting) — bank those reps' quality so metrics don't lose the last rep.
   */
  private finalizePendingReps(): void {
    if (this.jumpStartTs !== 0) {
      this.bankJumpRep(true);
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
  private bobScale = 1;
  /** landing spring clock, -1 = inactive (seconds since land) */
  private landSpringT = -1;
  /** decaying FOV punch (deg) added on jump lift + landing impact */
  private fovPunch = 0;
  /** jogging head-bob oscillator phase */
  private jogBobT = 0;

  private updateCameraFeel(dt: number): void {
    // landing impact: damped spring = quick dip + tiny overshoot-and-settle
    let landOffset = 0;
    if (this.landSpringT >= 0) {
      this.landSpringT += dt;
      if (this.landSpringT >= JUICE.LAND_DURATION_S) {
        this.landSpringT = -1;
      } else {
        landOffset =
          -JUICE.LAND_DIP_M *
          Math.exp(-JUICE.LAND_DAMP * this.landSpringT) *
          Math.cos(2 * Math.PI * JUICE.LAND_HZ * this.landSpringT);
      }
    }
    // jogging head-bob: synced to detected cadence, fades with the world
    // speed factor so it breathes to a stop with the runner
    let jogBob = 0;
    if (this.locomotionGating && this.locomotionActive) {
      this.jogBobT += dt * 2 * Math.PI * JUICE.JOG_BOB_HZ;
      jogBob = JUICE.JOG_BOB_M * Math.sin(this.jogBobT) * this.speedFactor;
    }
    const targetY =
      CAMERA.EYE +
      this.bobScale *
        (-CAMERA.CROUCH_DIP * this.crouch +
          (this.jumpY() / DETECT.JUMP_APEX) * CAMERA.JUMP_RISE_M +
          landOffset +
          jogBob);
    const a = Math.min(1, dt * CAMERA.DAMP);
    this.cameraY += (targetY - this.cameraY) * a;
    const targetPitch = CAMERA.PITCH_CROUCH * this.crouch * this.bobScale;
    this.cameraPitch += (targetPitch - this.cameraPitch) * a;
    this.fovPunch = Math.max(0, this.fovPunch - this.fovPunch * JUICE.FOV_PUNCH_DECAY * dt);
    const speedNorm =
      (this.speed - COURSE.SPEED_START) / (COURSE.SPEED_END - COURSE.SPEED_START);
    this.fov =
      CAMERA.FOV_BASE +
      CAMERA.FOV_SPEED_GAIN * clamp01(speedNorm) +
      this.fovPunch * (this.bobScale > 0 ? 1 : 0);
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
      // WINDOWED for endless mode: per-frame mapping must not grow with the
      // run. The band [-15, 130] fully covers the scene's create range
      // (zAhead -5..95) plus margin on both sides so its dispose branch
      // always sees an item one last time before it leaves the window.
      obstacles: this.obstacles.reduce<SceneObstacle[]>((out, ob, i) => {
        const zAhead = ob.atDistance - this.distance;
        if (zAhead > -15 && zAhead < 130) {
          out.push({
            id: ob.id,
            type: ob.type,
            zAhead,
            resolved: this.resolved[i],
            cleared: this.clearedFlags[i],
          });
        }
        return out;
      }, []),
      coins: this.coins.reduce<SceneCoin[]>((out, c, i) => {
        const zAhead = c.atDistance - this.distance;
        if (zAhead > -15 && zAhead < 130) {
          out.push({ id: c.id, zAhead, aerial: c.aerial, collected: this.coinCollected[i] });
        }
        return out;
      }, []),
      coinsCollected: this.coinsCollected,
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
      coins: this.coinsCollected,
      timerMs: this.getTimerRemainingMs(),
      paused: this.manuallyPaused,
      runActive: this.isRunActive(),
    };
  }

  isComplete(): boolean {
    return this.phase === 'done';
  }

  /** Why the run ended (null while running) — never infer this from lives. */
  getEndReason(): 'time' | 'lives' | null {
    return this.endReason;
  }

  /** Endless stream: append chunks so obstacles always exist well ahead. */
  private appendChunksIfNeeded(): void {
    while (
      this.obstacles[this.obstacles.length - 1].atDistance - this.distance <
      COURSE.SPAWN_AHEAD_M
    ) {
      const startAt = this.obstacles[this.obstacles.length - 1].atDistance;
      const chunk = generateChunk(this.seed, this.chunkIndex, startAt, this.obstacles.length);
      const chunkCoins = coinsForChunk(this.seed, this.chunkIndex, chunk, this.coins.length);
      this.chunkIndex += 1;
      for (const ob of chunk) {
        this.obstacles.push(ob);
        this.resolved.push(false);
        this.clearedFlags.push(false);
        this.cueShownAt.push(0);
        this.reactionRecorded.push(false);
      }
      for (const c of chunkCoins) {
        this.coins.push(c);
        this.coinDone.push(false);
        this.coinCollected.push(false);
      }
      this.emit('CHUNK_SPAWN', { chunk: this.chunkIndex - 1, totalObstacles: this.obstacles.length });
    }
  }

  getRawData(): RunnerRawData {
    const resolvedCount = this.resolved.filter(Boolean).length;
    const cleared = this.clearedFlags.filter(Boolean).length;
    const failed = resolvedCount - cleared;
    const totalReps = this.squatReps + this.jumpReps;
    // ACTIVE play time — pauses/freezes never inflate the Time stat
    const elapsed = this.gameTimeMs;
    const avgReaction =
      this.reactionMsList.length > 0
        ? this.reactionMsList.reduce((a, b) => a + b, 0) / this.reactionMsList.length
        : 0;
    const isHead = this.controlMode === 'head';
    return {
      // NOTE: KR1N = the neck-ROM variant (ROM category); KR1 = body/keyboard
      // (mobility). Distinct testId keeps one test = one clinical signal.
      testId: isHead ? 'KR1N' : 'KR1',
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
      /** RELATIVE head-movement range in k units — a proxy, NOT goniometric
       *  cervical ROM (nose-vs-shoulder is confounded by torso lean). */
      avgNeckFlexion: finite(isHead && this.squatReps > 0 ? this.neckFlexSum / this.squatReps : 0),
      avgNeckExtension: finite(isHead && this.jumpReps > 0 ? this.neckExtSum / this.jumpReps : 0),
      avgReactionMs: finite(Math.round(avgReaction)),
      cleanFormRate: finite(totalReps > 0 ? this.cleanReps / totalReps : 0),
      controlScheme: this.controlMode === 'keyboard' ? 0 : this.controlMode === 'pose' ? 1 : 2,
      controlModeKeyboard: this.controlMode === 'keyboard' ? 1 : 0,
      lowImpact: this.lowImpact ? 1 : 0,
      assessmentValid:
        totalReps >= ASSESSMENT.MIN_REPS &&
        resolvedCount >= ASSESSMENT.MIN_OBSTACLES_RESOLVED
          ? 1
          : 0,
      coinsCollected: this.coinsCollected,
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
    if (this.controlMode === 'head') {
      // raw neck signals with their CLEAN gates + the ear-based metric
      // candidate for the webcam comparison (see class NOTE)
      const flex = Math.max(0, -this.neckDeltaNow);
      const ext = Math.max(0, this.neckDeltaNow);
      drawBar(x0 + 80, flex / HEAD.MAX_EXCURSION, HEAD.FLEX_CLEAN / HEAD.MAX_EXCURSION, 'flex', '#f59e0b');
      drawBar(x0 + 120, ext / HEAD.MAX_EXCURSION, HEAD.EXT_CLEAN / HEAD.MAX_EXCURSION, 'ext', '#06b6d4');
      ctx.fillStyle = '#f8fafc';
      ctx.font = '10px monospace';
      ctx.fillText(
        `neckΔ=${this.neckDeltaNow.toFixed(3)} earΔ=${this.neckEarDeltaNow.toFixed(3)}`,
        x0 + 80,
        y0 - 20,
      );
    }
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
