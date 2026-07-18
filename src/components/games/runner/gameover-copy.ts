/**
 * Game-over copy selection — pure and node-testable, so the "never show
 * 'Out of lives' with hearts remaining" rule is pinned by a test instead
 * of living only inside JSX. Branches on the engine's RUN_DONE reason,
 * NEVER on lives/resolved counts.
 */
export type EndReason = 'time' | 'lives' | null;

export interface GameOverCopy {
  title: string;
  sub: string;
  /** 'win' = celebratory badge; 'lose' = soft encouraging badge */
  tone: 'win' | 'lose';
}

export function gameOverCopy(reason: EndReason): GameOverCopy {
  switch (reason) {
    case 'lives':
      return {
        title: 'Out of lives',
        sub: "Nice run — you'll get further next time.",
        tone: 'lose',
      };
    case 'time':
    default:
      // timer expiry is an ACHIEVEMENT, not a loss — and the safe default
      return {
        title: "Time's up!",
        sub: 'You went the full session — great work!',
        tone: 'win',
      };
  }
}

export function reportHeading(reason: EndReason): string {
  return reason === 'lives' ? 'Run over' : 'Session complete!';
}
