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
  /** game-space ballistic arc: apex + duration (VISUAL feel only — hurdle
   *  success is intent-based, see JUMP_PRE/POST below) */
  JUMP_APEX: 0.55,
  JUMP_DURATION_S: 0.7,
  /** a hurdle clears if a jump was INITIATED within this window before the
   *  crossing (covers the whole 700ms arc + a landed-early margin). Fixes
   *  "I clearly jumped but lost a life": the old single-frame arc sample
   *  (jumpY>0.35) only accepted takeoffs ~0.14–0.56s before the plane. */
  JUMP_PRE_WINDOW_MS: 750,
  /** ...or up to this long AFTER the crossing (deferred resolution grace) */
  JUMP_POST_GRACE_MS: 250,

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

// ── Locomotion (march/jog in place — pose mode only) ─────────────────────
// Every threshold is normalized by the calibrated torso length (shoulder-mid
// → hip-mid), NEVER raw pixels/frame units — that's what keeps detection
// identical across screen sizes, camera distances, and resolutions.
export const LOCO = {
  /** min normalized bounce amplitude (torso units) that reads as a step */
  MIN_AMP: 0.015,
  /** excursions beyond this are jump/squat territory — never steps */
  MAX_AMP: 0.22,
  /** valid gap between qualifying direction-changes (ms) ≈ 0.8–3.5 Hz */
  CROSS_MIN_MS: 140,
  CROSS_MAX_MS: 650,
  /** rhythmic crossings needed inside START_WINDOW_MS to debounce the start */
  START_CROSSINGS: 4,
  START_WINDOW_MS: 2200,
  /** momentum: locomotion stays active this long after the last step */
  STEP_TIMEOUT_MS: 1200,
  /** slow EMA for the neutral line the bounce is measured against */
  BASELINE_ALPHA: 0.06,
  /** knee-lift confirmation (legs in frame): lift height in torso units */
  KNEE_LIFT: 0.12,
  /** smooth-stop/start rates for the world speed factor (fraction per s) */
  ACCEL_PER_S: 2.5,
  DECEL_PER_S: 1.8,
  /** never coast closer than this to an unresolved obstacle plane (m) */
  STOP_MARGIN_M: 0.6,
  /** reaction-based coast margin: stop at least speed×this short of the
   *  plane (so a resume always has visible cue runway ahead) */
  STOP_REACTION_S: 0.75,
  /** after a gated resume the world may not cross the nearest unresolved
   *  plane for this long — guarantees cue + reaction time (releases early
   *  the moment the player performs the correct action) */
  RESUME_REACTION_MS: 900,
  /** hold this short of the plane during resume grace (cue reads ~full) */
  RESUME_HOLD_EPS_M: 0.05,
  /** once the world actually reaches the plane, hold at least this long —
   *  the resume glide can eat most of RESUME_REACTION_MS, so the plane
   *  itself guarantees a visible beat to act in */
  RESUME_HOLD_MIN_MS: 450,
  /** hold speedFactor flat this long after a locomotion drop before
   *  decaying — a brief detection gap must not visibly slow the world */
  GAP_GRACE_MS: 450,
  /** once locomotion has started this run, a re-start needs only this many
   *  rhythmic crossings (first start keeps the full anti-twitch debounce) */
  REARM_CROSSINGS: 2,
} as const;

// ── Game-feel juice (all scaled by bobScale → reduced-motion-safe) ──────
export const JUICE = {
  /** landing spring: initial dip (m), oscillation Hz, exponential damping */
  LAND_DIP_M: 0.06,
  LAND_HZ: 5.0,
  LAND_DAMP: 7,
  LAND_DURATION_S: 0.7,
  /** FOV punches (deg) + exponential decay rate (per s) */
  FOV_PUNCH_JUMP: 5,
  FOV_PUNCH_LAND: 3,
  FOV_PUNCH_DECAY: 5,
  /** jogging head-bob: amplitude (m) + fallback cadence (Hz). The bob is a
   *  figure-8: vertical at footfall rate + horizontal sway at half rate. */
  JOG_BOB_M: 0.035,
  JOG_BOB_HZ: 2.2,
  JOG_SWAY_M: 0.02,
  /** landing hitstop: world distance pauses this long on a pose landing
   *  (the single biggest "weight" read — tiny by design, never reads as lag) */
  HITSTOP_MS: 60,
  /** landing screen shake: amplitude (m), oscillation Hz, exp decay (per s) —
   *  X-only and subtle: FPP shake is a nausea risk. HZ stays ≤14 so the
   *  33ms-sampled decay test keeps a healthy peak margin (Nyquist). */
  SHAKE_M: 0.03,
  SHAKE_HZ: 14,
  SHAKE_DECAY: 11,
  /** jump anticipation: pre-rise crouch-load dip depth (m) + duration (s) */
  JUMP_DIP_M: 0.03,
  JUMP_DIP_S: 0.07,
  /** duck feel (pose only): descent speed multiplier on the camera damp,
   *  release-overshoot spring (m / Hz / exp damp / lifetime), and the FOV
   *  widen (deg at full crouch) for the "compressed under it" read */
  DUCK_DAMP_MULT: 1.8,
  /** slow-ish spring: its peak (~110ms) must land AFTER the camera has
   *  climbed back from the dip, or the overshoot decays before it shows */
  DUCK_OVER_M: 0.04,
  DUCK_OVER_HZ: 2.2,
  DUCK_OVER_DAMP: 4,
  DUCK_OVER_DURATION_S: 0.8,
  CROUCH_FOV: 4,
} as const;

// ── Course / world ───────────────────────────────────────────────────────
export const COURSE = {
  /** obstacles per generated CHUNK (endless: chunks append as you run) */
  OBSTACLES: 20,
  /** run speed ramp, m/s */
  SPEED_START: 6,
  SPEED_END: 9,
  /** speed ramps from START to END over this fixed distance (endless-safe;
   *  ≈ the old 20-obstacle course length, preserving the original feel) */
  RAMP_DISTANCE_M: 300,
  /** append the next chunk when the player is this close to generated end */
  SPAWN_AHEAD_M: 120,
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
  /** head mode: upward camera tilt at EXT_CLEAN look-up, radians — neck
   *  mode's own light feedback (it has no physical jump/landing) */
  HEAD_LOOK_PITCH: 0.1,
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
