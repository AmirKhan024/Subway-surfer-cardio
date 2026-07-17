/**
 * Raw game data for Kriya Runner — Level 1.
 *
 * Mirrors the production kriya-v3 discriminated-union pattern
 * (src/types/raw-data.ts). At integration time RunnerRawData is added to
 * prod's RawGameData union; here it is the only member.
 *
 * INVARIANT: every field except `testId` is a FINITE number — the production
 * /api/score/compute customMetrics Zod filter drops anything else, and our
 * tests pin this invariant.
 */

export interface RunnerRawData {
  testId: 'KR1';
  /** Meters covered (engagement/endurance proxy). */
  distance: number;
  /** Obstacles in the fixed course (20). */
  obstaclesTotal: number;
  /** Cleared with the correct movement at the action plane. */
  obstaclesCleared: number;
  /** Hit / mistimed. */
  obstaclesFailed: number;
  squatReps: number;
  /** Jump reps — heel-raise reps in low-impact mode. */
  jumpReps: number;
  /** 0..1 mean normalized hip drop over squat reps. */
  avgSquatDepth: number;
  /** 0..1 mean normalized peak hip rise over jump reps. */
  avgJumpHeight: number;
  /** Mean cue-shown → movement-initiation latency (ms). NOT comparable
   *  across control modes — see controlModeKeyboard. */
  avgReactionMs: number;
  /** 0..1 fraction of reps meeting the CLEAN thresholds (strictly above the
   *  clear gates), so this measures quality beyond merely clearing. */
  cleanFormRate: number;
  /** 1 = keyboard run (reaction = keypress latency), 0 = body control
   *  (reaction = movement-initiation latency). Numeric to keep the
   *  all-finite invariant. */
  controlModeKeyboard: 0 | 1;
  /** 1 = low-impact mode (heel-raise instead of jump). */
  lowImpact: 0 | 1;
  /** 1 = enough activity for an assessment-grade score
   *  (>= 6 total reps AND >= 8 obstacles resolved). */
  assessmentValid: 0 | 1;
  /** Course seed used for this run (comparability audit trail). */
  seed: number;
  /** ms */
  elapsed: number;
}

export type RawGameData = RunnerRawData;

/** Prod-parity helper (prefix-based, mirrors getTestCategory). */
export function getTestCategory(testId: string): string {
  if (testId.startsWith('KR')) return 'mobility';
  throw new Error(`Unknown testId: ${testId}`);
}
