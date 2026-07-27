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
      // a stumble on the trail, not a failure — the valley is unforgiving,
      // the runner is not being judged
      return {
        title: 'The trail took you down',
        sub: "The valley's long. Pick the Kosha up and go again.",
        tone: 'lose',
      };
    case 'time':
    default:
      // timer expiry is an ACHIEVEMENT, not a loss — and the safe default
      return {
        title: 'You made the plateau',
        sub: 'Kaho to Dong, on foot, in the dark.',
        tone: 'win',
      };
  }
}

export function reportHeading(reason: EndReason): string {
  return reason === 'lives' ? 'The run broke' : 'You made it to Dong';
}
