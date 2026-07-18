/**
 * Kriya Runner L1 — fixed-course obstacle timeline (seeded, deterministic).
 *
 * NOTE (seed policy): a single fixed seed would let users memorize the course
 * and inflate scores across attempts — a false musculage trend. Policy:
 * the FIRST run of a session uses ASSESSMENT_SEED; "Run again" rotates
 * through SEED_POOL. Every seed produces a matched-difficulty course
 * (same obstacle count, same 10/10 type mix, movement-paced min gaps),
 * so metrics stay comparable across seeds. The seed is recorded in
 * RunnerRawData for the audit trail.
 */
import { COURSE, COIN } from '@/components/games/runner/runner-constants';

export type ObstacleType = 'hurdle' | 'beam';

export interface Obstacle {
  id: number;
  type: ObstacleType;
  /** distance (meters from run start) of the action plane */
  atDistance: number;
}

export interface Coin {
  id: number;
  atDistance: number;
  /** aerial coins sit above a hurdle and need jumpY >= COIN.AERIAL_JUMPY */
  aerial: boolean;
}

/** Deterministic 32-bit PRNG (mulberry32). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Speed at a world distance (linear ramp over a FIXED distance — endless-safe). */
export function speedAtDistance(d: number): number {
  const t = Math.max(0, Math.min(1, d / COURSE.RAMP_DISTANCE_M));
  return COURSE.SPEED_START + (COURSE.SPEED_END - COURSE.SPEED_START) * t;
}

/** Per-chunk RNG stream: deterministic for (seed, chunkIndex), independent
 *  across chunks so a run is reproducible for its seed. */
function chunkRng(seed: number, chunkIndex: number): () => number {
  return mulberry32((seed ^ Math.imul(chunkIndex + 1, 0x85ebca6b)) >>> 0);
}

/**
 * Generate one obstacle CHUNK (endless mode appends these as you run).
 * Matched difficulty per chunk: exactly half hurdles / half beams, never
 * 3 of a type in a row within the chunk, and every gap >= MIN_GAP_S at the
 * local speed so a full human rep always fits between obstacles.
 * The first obstacle sits one gap past `startDistance`; ids continue from
 * `startId` so scene mesh keys stay globally unique.
 */
export function generateChunk(
  seed: number,
  chunkIndex: number,
  startDistance: number,
  startId: number,
): Obstacle[] {
  const rng = chunkRng(seed, chunkIndex);
  const n = COURSE.OBSTACLES;

  // 10/10 type mix, seeded, with two hard constraints: never 3 of a type in
  // a row, and never paint into a corner where the tail would force one.
  // Feasibility: a run of type T needs separators from the other type O, so
  // remaining[T] <= 2*(remaining[O]+1) - trailingRun(T) must hold after
  // every pick. (Cross-chunk 3-runs are possible at seams — rare + harmless.)
  const remaining: Record<ObstacleType, number> = { hurdle: n / 2, beam: n / 2 };
  const types: ObstacleType[] = [];
  const other = (t: ObstacleType): ObstacleType => (t === 'hurdle' ? 'beam' : 'hurdle');
  const trailingRun = (t: ObstacleType): number => {
    let run = 0;
    for (let i = types.length - 1; i >= 0 && types[i] === t; i--) run++;
    return run;
  };
  const feasibleAfter = (pick: ObstacleType): boolean => {
    const r = { ...remaining, [pick]: remaining[pick] - 1 };
    if (r[pick] < 0) return false;
    const runPick = trailingRun(pick) + 1;
    if (runPick >= 3) return false;
    for (const t of ['hurdle', 'beam'] as const) {
      const trail = t === pick ? runPick : 0;
      if (r[t] > 2 * (r[other(t)] + 1) - trail) return false;
    }
    return true;
  };
  for (let i = 0; i < n; i++) {
    const preferred: ObstacleType = rng() < 0.5 ? 'hurdle' : 'beam';
    const pick = feasibleAfter(preferred) ? preferred : other(preferred);
    types.push(pick);
    remaining[pick] -= 1;
  }

  const obstacles: Obstacle[] = [];
  let d = startDistance;
  for (let i = 0; i < n; i++) {
    if (i > 0 || chunkIndex > 0) {
      // chunk 0 places its first obstacle exactly at the lead-in distance;
      // later chunks (and every subsequent obstacle) space by a paced gap
      const gapSeconds = COURSE.MIN_GAP_S + rng() * COURSE.EXTRA_GAP_S;
      d += speedAtDistance(d) * gapSeconds;
    }
    obstacles.push({ id: startId + i, type: types[i], atDistance: d });
  }
  return obstacles;
}

/** Chunk 0 (compat wrapper) — the run's opening obstacles from the lead-in. */
export function generateCourse(seed: number): Obstacle[] {
  return generateChunk(seed, 0, COURSE.LEAD_IN_M, 0);
}

/** Total course length in meters (last obstacle + a short run-out). */
export function courseLength(obstacles: Obstacle[]): number {
  return obstacles[obstacles.length - 1].atDistance + 20;
}

/**
 * Seeded coin placement — ENGAGEMENT ONLY (coins never enter the scoring
 * bands). Ground lines of 3–5 coins fill the safe middle of each obstacle
 * gap (≥ CLEARANCE_M from both planes so collecting never fights clearing),
 * plus one aerial coin just past every hurdle that rewards a real jump.
 * Separate PRNG stream (seed ^ 0x9e3779b9) so coin layout never perturbs
 * the obstacle course for a given seed.
 */
export function generateCoins(seed: number, obstacles: Obstacle[]): Coin[] {
  return coinsForChunk(seed, 0, obstacles, 0);
}

/** Chunk-aware coin placement; ids continue from startId (scene mesh keys). */
export function coinsForChunk(
  seed: number,
  chunkIndex: number,
  obstacles: Obstacle[],
  startId: number,
): Coin[] {
  const rng = mulberry32((seed ^ 0x9e3779b9 ^ Math.imul(chunkIndex, 0xc2b2ae35)) >>> 0);
  const coins: Coin[] = [];
  let id = startId;

  for (let i = 0; i < obstacles.length; i++) {
    // aerial coin above/just past each hurdle
    if (obstacles[i].type === 'hurdle') {
      coins.push({ id: id++, atDistance: obstacles[i].atDistance + COIN.AERIAL_OFFSET_M, aerial: true });
    }
    // ground line in the gap AFTER this obstacle (before the next one)
    const gapStart = obstacles[i].atDistance + COIN.CLEARANCE_M;
    const gapEnd =
      (i + 1 < obstacles.length ? obstacles[i + 1].atDistance : obstacles[i].atDistance + 18) -
      COIN.CLEARANCE_M;
    const lineLen = COIN.LINE_MIN + Math.floor(rng() * (COIN.LINE_MAX - COIN.LINE_MIN + 1));
    const needed = (lineLen - 1) * COIN.LINE_SPACING_M;
    if (gapEnd - gapStart < needed) continue; // gap too tight — skip cleanly
    const start = gapStart + rng() * (gapEnd - gapStart - needed);
    for (let c = 0; c < lineLen; c++) {
      coins.push({ id: id++, atDistance: start + c * COIN.LINE_SPACING_M, aerial: false });
    }
  }
  return coins;
}

/** Pick the seed for a given attempt number (0 = assessment run). */
export function seedForAttempt(attempt: number): number {
  const pool = COURSE.SEED_POOL;
  return pool[attempt % pool.length];
}
