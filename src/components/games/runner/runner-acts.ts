/**
 * "The Final Run" — the three-act journey: Kaho → Lohit Paar → Dong.
 *
 * ONE run, ONE assessment, ONE muscle-age. The acts are themed thirds of the
 * same run, derived from the run-progress value that already drives the dawn
 * ramp and the HUD prayer-flag bar. NOTHING here feeds the engine, the
 * detection or the scoring — it is paint and copy, and the muscle-age is
 * identical whether or not a single act boundary is crossed.
 *
 * WHY THIS FILE EXISTS AT ALL: runner-scene.ts imports three and calls
 * document.createElement, and vitest here is node-env with
 * include: ['src/**\/*.test.ts'] — so the scene and both .tsx files cannot be
 * unit-tested. Every piece of act logic therefore lives in this one DOM-free,
 * three-free module, which is the whole automated test surface for the
 * feature. Keep it that way: no three, no DOM, no React.
 */

export type ActId = 1 | 2 | 3;

/** Equal thirds of run progress. Independent of the chosen 30/60/90s length —
 *  the acts are the first/middle/last third of whatever the player picked. */
export const ACT_BOUNDS = {
  ACT2_START: 1 / 3,
  ACT3_START: 2 / 3,
} as const;

/**
 * Which act a run-progress value falls in.
 *
 * Defensive by design: `progress` comes from `1 - timerMs/sessionMs`, and the
 * timer can be null before the run starts, so NaN must land somewhere sane
 * rather than propagating into the scene as an undefined act.
 */
export function actForProgress(p: number): ActId {
  if (!Number.isFinite(p)) return 1;
  if (p >= ACT_BOUNDS.ACT3_START) return 3;
  if (p >= ACT_BOUNDS.ACT2_START) return 2;
  return 1;
}

// ── act metadata (title card + HUD chip copy) ─────────────────────────────

export interface ActMeta {
  id: ActId;
  key: 'kaho' | 'crossing' | 'dong';
  numeral: 'I' | 'II' | 'III';
  name: string;
  /** one line, kept short so the lower-third card never wraps to four lines
   *  on a 360px phone — pinned by a test at <= 62 chars */
  beat: string;
  /** HUD/card accent, CSS hex — cool night → river green → gold */
  accent: string;
}

export const ACTS: readonly [ActMeta, ActMeta, ActMeta] = [
  {
    id: 1,
    key: 'kaho',
    numeral: 'I',
    name: 'Kaho',
    beat: "India's easternmost village. The flags are still.",
    accent: '#A9C9D4',
  },
  {
    id: 2,
    key: 'crossing',
    numeral: 'II',
    name: 'Lohit Paar',
    beat: 'The crossing. The river runs green and cold.',
    accent: '#6FBF9B',
  },
  {
    id: 3,
    key: 'dong',
    numeral: 'III',
    name: 'Dong',
    beat: 'The plateau. The first light in the country.',
    accent: '#E8C46A',
  },
] as const;

export function actMeta(id: ActId): ActMeta {
  return ACTS[id - 1];
}

// ── continuous blend weights (the anti-pop guarantee) ─────────────────────

export interface ActWeights {
  w1: number;
  w2: number;
  w3: number;
}

/** progress units either side of a boundary over which the look cross-fades */
export const ACT_BLEND_BAND = 0.05;

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/**
 * Smooth 3-way crossfade over the act boundaries. w1+w2+w3 === 1 always.
 *
 * OUT-PARAM ON PURPOSE. This is called once per frame by the scene, which has
 * a hard zero-allocation budget (see applyDawn's scratch-colour comment) —
 * returning a fresh object here would allocate 60 times a second. The void
 * return is what stops a caller being tempted to write `const w = ...`.
 */
export function actWeights(p: number, out: ActWeights): void {
  const x = Number.isFinite(p) ? Math.min(1, Math.max(0, p)) : 0;
  const b = ACT_BLEND_BAND;
  // t2: how far we are into act 2 (0 before the first boundary, 1 after)
  const t2 = smoothstep(ACT_BOUNDS.ACT2_START - b, ACT_BOUNDS.ACT2_START + b, x);
  const t3 = smoothstep(ACT_BOUNDS.ACT3_START - b, ACT_BOUNDS.ACT3_START + b, x);
  out.w1 = 1 - t2;
  out.w2 = t2 - t3;
  out.w3 = t3;
}

// ── the finale: the Walong Beat and the Lohit Gold Rush ──────────────────
//
// Both live at the end of Act 3 and both are ENGAGEMENT. Neither adds or
// removes a scored action: the Beat DEFERS obstacles rather than deleting
// them, and the Gold Rush leaves obstacle density completely alone and pours
// on mohurs and Koshas instead. The muscle-age cannot see either one.

export const FINALE = {
  /**
   * The Gold Rush is the last slice of the run. Expressed as a FRACTION with
   * a cap, not fixed seconds: 15s of a 30s session would be half the run, and
   * the session length is the player's choice (30/60/90).
   */
  GOLD_RUSH_FRACTION: 0.22,
  GOLD_RUSH_MAX_MS: 15_000,
  /** the held breath immediately before the rush — same scaling reason */
  BEAT_FRACTION: 0.06,
  BEAT_MAX_MS: 3_000,
  /**
   * No Walong Beat below this session length.
   *
   * MEASURED, not guessed. The Beat defers the remaining trail rather than
   * deleting any of it, but the run still ends on the timer, so whatever is
   * pushed past the end never arrives — a cost of about one obstacle. A 30s
   * run resolves 9 against an assessment-grade floor of 8, so that one
   * obstacle IS the entire margin: with the beat on, a 30s run lands exactly
   * on the floor, and a hurdle still pending in the last 250ms of grace
   * would take it under.
   *
   * A 1.8s pause is barely a held breath anyway. Short sessions get the
   * Gold Rush (which costs nothing) and skip the memorial.
   */
  BEAT_MIN_SESSION_MS: 45_000,
} as const;

export interface FinaleWindows {
  /** progress 0..1 at which the Walong Beat opens */
  beatStart: number;
  /** progress at which it closes — always === rushStart */
  beatEnd: number;
  /** progress at which the Lohit Gold Rush opens, and runs to the finish */
  rushStart: number;
}

/**
 * Where the two finale moments sit for a given session length.
 *
 * 30s → beat 1.8s, rush 6.6s · 60s → 3.0s / 13.2s · 90s → 3.0s / 15.0s.
 * A run with no timer (sessionMs <= 0) has no finale at all: the windows
 * collapse to 1, so both predicates are false forever.
 */
export function finaleWindows(sessionMs: number): FinaleWindows {
  if (!Number.isFinite(sessionMs) || sessionMs <= 0) {
    return { beatStart: 1, beatEnd: 1, rushStart: 1 };
  }
  const rushMs = Math.min(FINALE.GOLD_RUSH_MAX_MS, sessionMs * FINALE.GOLD_RUSH_FRACTION);
  // short sessions have no obstacle margin to spend on a pause — see
  // BEAT_MIN_SESSION_MS. beatMs 0 collapses the window, so isWalongBeat is
  // false for the whole run and beatStart === beatEnd === rushStart.
  const beatMs =
    sessionMs < FINALE.BEAT_MIN_SESSION_MS
      ? 0
      : Math.min(FINALE.BEAT_MAX_MS, sessionMs * FINALE.BEAT_FRACTION);
  const rushStart = Math.max(0, 1 - rushMs / sessionMs);
  const beatStart = Math.max(0, rushStart - beatMs / sessionMs);
  return { beatStart, beatEnd: rushStart, rushStart };
}

/** The held breath at the memorial — no obstacles, near silence. */
export function isWalongBeat(p: number, sessionMs: number): boolean {
  if (!Number.isFinite(p)) return false;
  const w = finaleWindows(sessionMs);
  return p >= w.beatStart && p < w.beatEnd;
}

/** The gold finale — mohurs, Koshas and the horn, at unchanged difficulty. */
export function isGoldRush(p: number, sessionMs: number): boolean {
  if (!Number.isFinite(p)) return false;
  return p >= finaleWindows(sessionMs).rushStart;
}

/**
 * Progress from which the SKY is bright enough that the HUD needs dark-on-light
 * treatment: heavier chip backings, a scrim under the cue label, and unlit
 * prayer flags lifted off the floor.
 *
 * Pinned to the DAWN ramp, not guessed — 0.72 leads the saffron stop at p 0.75
 * by roughly one blend band, so the chrome has already firmed up by the time
 * the sky turns. The isGoldRush term is belt-and-braces: the rush opens at
 * p ≈ 0.78 (30s) to 0.83 (90s), i.e. AFTER the sky is already bright, so 0.72
 * is the load-bearing half.
 *
 * Paint only. Nothing downstream of this reaches the engine or the scoring.
 */
export const BRIGHT_SKY_START = 0.72;

export function isBrightSky(p: number, sessionMs: number | null): boolean {
  if (!Number.isFinite(p)) return false;
  if (p >= BRIGHT_SKY_START) return true;
  return sessionMs !== null && isGoldRush(p, sessionMs);
}

// ── the prop plan ─────────────────────────────────────────────────────────

/** The three recycled trailside rows, sized and indexed exactly as buildWorld
 *  lays them out: A = 14 slope props, B = 10 trail-edge, C = 8 near markers. */
export type PropRow = 'A' | 'B' | 'C';
export const PROP_ROW_SIZES: Record<PropRow, number> = { A: 14, B: 10, C: 8 };

export type PropKind =
  | 'pine'
  | 'bamboo'
  | 'gonpa'
  | 'flags'
  | 'mani'
  | 'marker'
  | 'scree';

/**
 * What a given slot shows in a given act.
 *
 * THREE INVARIANTS, all unit-tested:
 *  1. Every slot has a kind in EVERY act — so hiding a prop can never leave a
 *     gap in the world.
 *  2. Row C is act-invariant. Those are the near-lane markers that carry most
 *     of the sense of speed; changing them would read as the world glitching.
 *  3. Act 1 reproduces today's world EXACTLY, so this change cannot regress
 *     the frame the player sees at run start.
 */
export function propKindFor(row: PropRow, i: number, act: ActId): PropKind {
  if (row === 'C') return 'marker';
  if (row === 'B') {
    // prayer flags run the whole journey — they are one of the few saturated
    // things in the dark and the region puts them on every pass and bridge
    if (act === 2) return i % 2 === 0 ? 'flags' : 'bamboo';
    // mani stacks are the village's; above the treeline the trail edge is
    // bare stone. (Measured: leaving act 3's row B as act 1's made only
    // 10 of 32 slots differ between the opening and the finish, which is not
    // enough for "clearly distinct" — this takes it to 15.)
    if (act === 3) return i % 2 === 0 ? 'flags' : 'scree';
    return i % 2 === 0 ? 'flags' : 'mani';
  }
  // row A
  if (act === 1) return i === 9 ? 'gonpa' : i % 3 === 1 ? 'bamboo' : 'pine';
  // the gonpa is Kaho's landmark; it does not follow you out of the village
  if (act === 2) return i % 2 === 0 ? 'bamboo' : 'pine';
  return i % 3 === 0 ? 'pine' : 'scree'; // slopes thinning to scree on the plateau
}

/** Every distinct kind a slot ever needs — drives the variant pre-build, so
 *  single-variant slots cost nothing extra. */
export function propKindsForSlot(row: PropRow, i: number): PropKind[] {
  const out: PropKind[] = [];
  for (const act of [1, 2, 3] as ActId[]) {
    const k = propKindFor(row, i, act);
    if (!out.includes(k)) out.push(k);
  }
  return out;
}

// ── prop recycling maths (lifted out of the scene so it is testable) ──────

/**
 * Which lap of the recycling loop a prop is on. The scene's old form used `%`
 * and could not observe this; the lap COUNT is what makes "the prop just
 * teleported behind the camera" detectable, which is the only moment a prop
 * may safely change its identity.
 */
export function propLap(d: number, baseZ: number, loopLen: number): number {
  return Math.floor((d - baseZ) / loopLen);
}

/**
 * Prop z BEFORE the scene's +10 nudge. Arithmetically identical to the old
 * `z = (baseZ - d) % loopLen; if (z<0) z += loopLen; -(z ? z : loopLen)` —
 * the old `z ? z : loopLen` special case is exactly the frac===0 case and is
 * absorbed here. Pinned against the old formula by a regression test.
 */
export function propZLocal(d: number, baseZ: number, loopLen: number): number {
  const rel = d - baseZ;
  const lap = Math.floor(rel / loopLen);
  return rel - lap * loopLen - loopLen;
}

/**
 * How far ahead of the boundary a WRAPPING prop adopts the next act.
 *
 * Props only change out of sight, so what a wrapping prop adopts is what the
 * player will run INTO next. A small lead means the world ahead has already
 * become the new place by the time the title card fires. Set to 0 to disable.
 */
export const ACT_PROP_LEAD = 0.05;

export function actForWrap(p: number): ActId {
  return actForProgress((Number.isFinite(p) ? p : 0) + ACT_PROP_LEAD);
}

// ── the dawn ramp ─────────────────────────────────────────────────────────
//
// Relocated here from runner-scene.ts unchanged in substance: it is pure data
// (numbers and hex ints, no three, no DOM), and moving it is what makes the
// dawn/act alignment machine-checkable — that a stop lands on an act
// boundary, that the obstacle-readability floor holds, that the sun never
// clears the ridge before Dong.

/**
 * Kaho (dark) → Dong plateau (first light).
 *
 * The whole level is ONE colour ramp; it is the signature of the re-skin.
 * Driven by run progress (0..1) handed in by the layer — see scene update().
 * Restraint early is deliberate: ambient starts very low so the sunrise has
 * somewhere to climb to.
 *
 * ACT ALIGNMENT (three-act change): the held-night stop moved 0.45 → 0.333 so
 * night ends exactly where Kaho ends, and first light moved 0.60 → 0.52 so it
 * lands in the middle of the Crossing rather than after it. Only those two `p`
 * values changed — every colour, every intensity, and the whole violet →
 * saffron → gold sunrise from 0.68 onward is byte-identical to what shipped.
 */
export type DawnStop = {
  p: number;
  sky: number;
  sunC: number;
  sunI: number;
  ambC: number;
  ambI: number;
  /** sun disc height; stays behind the ridge line until Dong */
  sunY: number;
};

export const DAWN: DawnStop[] = [
  // NIGHT — held through Kaho. Light tints stay COOL blue-grey on purpose: the
  // trail texture is warm gravel, and a warm key light this early made the
  // whole ground read amber long before the sun was meant to clear the ridge.
  // ambI never drops below ~0.34 — the obstacles must stay readable in the
  // dark or a missed cue costs a real stumble (this is also an assessment).
  { p: 0.0, sky: 0x10162e, sunC: 0x1b2742, sunI: 0.12, ambC: 0x2b3a52, ambI: 0.34, sunY: -10 },
  // end of Kaho — the night is at its top, the climb starts on the crossing
  { p: 1 / 3, sky: 0x141b33, sunC: 0x24304d, sunI: 0.18, ambC: 0x30405e, ambI: 0.4, sunY: -8 },
  // FIRST LIGHT — mid-Crossing, grey-blue on the water
  { p: 0.52, sky: 0x2b3a4e, sunC: 0x53637a, sunI: 0.42, ambC: 0x4a5a6e, ambI: 0.55, sunY: -4 },
  // pre-dawn violet. Without this stop the blue→saffron lerp passes straight
  // through a muddy grey-brown; real dawn goes indigo → rose → orange.
  { p: 0.68, sky: 0x6b4a5e, sunC: 0x9c6a72, sunI: 0.8, ambC: 0x6d5566, ambI: 0.74, sunY: 4 },
  // SUNRISE — the rim clears the ridge here, in the last quarter
  { p: 0.75, sky: 0xe8913a, sunC: 0xffb066, sunI: 1.35, ambC: 0xbe8a62, ambI: 0.95, sunY: 20 },
  { p: 0.9, sky: 0xf5c542, sunC: 0xffd07a, sunI: 1.75, ambC: 0xdcb679, ambI: 1.2, sunY: 31 },
  // FINISH — warm gold, intensity CAPPED. Not white: an over-exposed cream
  // frame throws away the payoff the whole ramp was built for.
  { p: 1.0, sky: 0xffcb5c, sunC: 0xffdf9a, sunI: 1.95, ambC: 0xf0c98a, ambI: 1.35, sunY: 40 },
];

/** hard translucent green of the Lohit — NOT blue, NOT plains-brown */
export const LOHIT_GREEN = 0x1e7a5e;
