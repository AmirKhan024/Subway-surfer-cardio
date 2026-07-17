/**
 * Kriya Runner L1 — every tunable in one place.
 *
 * Detection thresholds start from the SPEC's hand-tuned prototype values;
 * tune on a real webcam via the ?debug=1 overlay (M2).
 * Distance-style thresholds are in "k units" — normalized by the calibrated
 * shoulder width so they hold across users and camera distances.
 */

// ── Detection ────────────────────────────────────────────────────────────
export const DETECT = {
  /** crouch starts engaging past this normalized hip drop */
  SQUAT_ENGAGE: 0.15,
  /** crouch reaches 1.0 at ENGAGE + SPAN */
  SQUAT_SPAN: 0.35,
  /** crouch value that clears a beam at the action plane */
  SQUAT_CLEAR: 0.55,
  /** crouch value for a CLEAN squat (strictly above the clear gate so
   *  cleanFormRate measures quality beyond clearing) */
  SQUAT_CLEAN: 0.75,
  /** a squat attempt counts as a rep if peak crouch reaches this */
  SQUAT_REP_MIN: 0.35,

  /** upward hip velocity that (with rise) triggers a jump — k units/second.
   *  NOTE: SPEC's -0.02 was raw units/frame @~30fps; this is the
   *  fps-invariant equivalent normalized by shoulder width. */
  JUMP_VEL_K_PER_S: 3.0,
  /** normalized hip rise that (with velocity) triggers a jump */
  JUMP_RISE: 0.18,
  /** game-space jumpY that clears a hurdle at the action plane */
  JUMP_CLEAR: 0.35,
  /** measured rise (k units) for a CLEAN jump */
  JUMP_CLEAN: 0.5,
  /** game-space ballistic arc: apex + duration */
  JUMP_APEX: 0.55,
  JUMP_DURATION_S: 0.7,

  /** low-impact: heel rise (k units) that triggers / is clean */
  HEEL_TRIGGER: 0.06,
  HEEL_CLEAN: 0.1,

  /** |drop| below this re-arms both FSMs (return-to-neutral gate) */
  NEUTRAL_BAND: 0.08,
  /** EMA smoothing on hip/heel signals (prod per-engine convention) */
  EMA_ALPHA: 0.2,
} as const;

// ── Head / neck-ROM control mode ─────────────────────────────────────────
// All values are neck excursion in k units (normalized by shoulder width),
// relative to the calibrated neutral. NOTE: no velocity threshold exists by
// design — extension→jump is a gentle POSITION edge-trigger, because a
// velocity gate would train fast/jerky neck extension (the riskier neck
// direction). Clean thresholds sit strictly ABOVE the clear gates but well
// inside a comfortable sub-maximal range — never reward end-range forcing.
export const HEAD = {
  /** look-down starts engaging crouch */
  FLEX_ENGAGE: 0.05,
  /** crouch reaches 1.0 at ENGAGE + SPAN (beam clears at crouch>0.55 ⇒ flex ≈ 0.116) */
  FLEX_SPAN: 0.12,
  /** flexion depth for a CLEAN look-down rep (strictly above the ~0.116 clear point) */
  FLEX_CLEAN: 0.16,
  /** extension crossing this (rising edge) triggers the jump arc */
  EXT_RISE: 0.08,
  /** extension for a CLEAN look-up rep */
  EXT_CLEAN: 0.14,
  /** |neckDelta| below this re-arms both FSMs */
  NEUTRAL_BAND: 0.04,
  /** EMA on neckPitch — between FA3's responsive 0.55 and the body EMA 0.2 */
  EMA_ALPHA: 0.35,
  /** plausibility ceiling on RECORDED flexion/extension peaks (FA3-style
   *  physio cap — metrics never reward cranking past comfortable range) */
  MAX_EXCURSION: 0.45,
} as const;

// ── Calibration ──────────────────────────────────────────────────────────
export const CALIB = {
  /** stable full-body hold required to lock the baseline (time-based) */
  HOLD_MS: 1500,
  /** landmark visibility gate for nose + ankles + hips */
  MIN_VISIBILITY: 0.5,
  /** max hipY wobble (raw units) allowed during the hold */
  MAX_WOBBLE: 0.02,
  /** calibration gives up and shows "tap to retry" after this */
  TIMEOUT_MS: 30000,
} as const;

// ── Drift guard (M2) ─────────────────────────────────────────────────────
export const DRIFT = {
  /** very slow EMA on the standing baseline — only while FSMs are neutral */
  BASELINE_ALPHA: 0.02,
  /** shoulderW departing calibrated value by this ratio flags drift */
  SCALE_BAND: 0.35,
  /** sustained drift longer than this surfaces the recenter nudge */
  SUSTAIN_MS: 2000,
} as const;

// ── Course / world ───────────────────────────────────────────────────────
export const COURSE = {
  OBSTACLES: 20,
  /** run speed ramp, m/s */
  SPEED_START: 6,
  SPEED_END: 9,
  /** distance before the first obstacle, m */
  LEAD_IN_M: 30,
  /** movement-paced spacing: minimum seconds between obstacles */
  MIN_GAP_S: 2.6,
  /** random extra gap, seconds (seeded) */
  EXTRA_GAP_S: 1.0,
  /** obstacle telegraph window, seconds-to-plane */
  CUE_WINDOW_S: 2.0,
  LIVES: 3,
  /** fixed seed for the first (assessment) run of a session */
  ASSESSMENT_SEED: 1337,
  /** matched-difficulty pool for "Run again" replays (course memorization
   *  would otherwise inflate scores across attempts) */
  SEED_POOL: [1337, 2861, 4242, 7351, 9090],
} as const;

// ── Coins (engagement ONLY — never enter the KR1 scoring bands) ──────────
export const COIN = {
  /** ground-line length range per obstacle gap */
  LINE_MIN: 3,
  LINE_MAX: 5,
  /** coin spacing within a line, meters */
  LINE_SPACING_M: 1.6,
  /** keep every ground coin at least this far from any action plane */
  CLEARANCE_M: 4,
  /** aerial coin sits this far past each hurdle's plane */
  AERIAL_OFFSET_M: 0.5,
  /** game-space jumpY needed to grab an aerial coin */
  AERIAL_JUMPY: 0.35,
  /** visual spin, radians/second */
  SPIN_RAD_S: 3,
} as const;

// ── Camera feel ──────────────────────────────────────────────────────────
export const CAMERA = {
  /** standing eye height, meters (scene units) */
  EYE: 1.6,
  /** how far the eye dips at full crouch, meters */
  CROUCH_DIP: 0.75,
  /** eye rise at jump apex, meters */
  JUMP_RISE_M: 0.9,
  /** EMA damping factor: cam += (target-cam)*min(1, dt*DAMP) */
  DAMP: 18,
  /** downward pitch at full crouch, radians */
  PITCH_CROUCH: -0.12,
  FOV_BASE: 65,
  FOV_SPEED_GAIN: 8,
} as const;

// ── Keyboard control ─────────────────────────────────────────────────────
export const KEYBOARD = {
  /** crouch ramp rate while the key is held, per second */
  CROUCH_RATE: 4,
} as const;

// ── Assessment validity (low-rep runs give noisy cleanFormRate) ──────────
export const ASSESSMENT = {
  MIN_REPS: 6,
  MIN_OBSTACLES_RESOLVED: 8,
} as const;

// ── Palette (prototype reference; gameplay signal colors) ────────────────
export const COLORS = {
  jump: '#06b6d4', // cyan = jump
  squat: '#f59e0b', // amber = squat
  danger: '#ef4444',
  text: '#f8fafc',
  muted: '#cbd5e1',
} as const;
