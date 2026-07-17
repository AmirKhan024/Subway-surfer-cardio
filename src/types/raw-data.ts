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
  /** KR1 = body/keyboard runner (mobility); KR1N = head/neck-ROM runner (rom). */
  testId: 'KR1' | 'KR1N';
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
  /** Head mode only (0 otherwise): mean peak neck flexion / extension in
   *  k units. RELATIVE head-movement range — a proxy, NOT goniometric
   *  cervical ROM (nose-vs-shoulder is confounded by torso lean). */
  avgNeckFlexion: number;
  avgNeckExtension: number;
  /** Mean cue-shown → movement-initiation latency (ms). NOT comparable
   *  across control modes — see controlScheme. */
  avgReactionMs: number;
  /** 0..1 fraction of reps meeting the CLEAN thresholds (strictly above the
   *  clear gates), so this measures quality beyond merely clearing. */
  cleanFormRate: number;
  /** 0 = keyboard, 1 = body pose, 2 = head/neck. Numeric to keep the
   *  all-finite invariant. */
  controlScheme: 0 | 1 | 2;
  /** Back-compat: 1 = keyboard run (derivable from controlScheme === 0). */
  controlModeKeyboard: 0 | 1;
  /** 1 = low-impact mode (heel-raise instead of jump). */
  lowImpact: 0 | 1;
  /** 1 = enough activity for an assessment-grade score
   *  (>= 6 total reps AND >= 8 obstacles resolved). */
  assessmentValid: 0 | 1;
  /** ENGAGEMENT ONLY — coins never enter the KR1/KR1N scoring bands or
   *  musculage (kr1-local.ts must never reference this). */
  coinsCollected: number;
  /** Course seed used for this run (comparability audit trail). */
  seed: number;
  /** ms */
  elapsed: number;
}

export type RawGameData = RunnerRawData;

/** Prod-parity helper (mirrors getTestCategory). KR1N is the neck-ROM
 *  variant → 'rom'; the body/keyboard runner stays 'mobility'. */
export function getTestCategory(testId: string): string {
  if (testId === 'KR1N') return 'rom';
  if (testId.startsWith('KR')) return 'mobility';
  throw new Error(`Unknown testId: ${testId}`);
}
