/**
 * Game-over copy selection — pure and node-testable, so the "never show
 * 'Out of lives' with hearts remaining" rule is pinned by a test instead
 * of living only inside JSX. Branches on the engine's RUN_DONE reason,
 * NEVER on lives/resolved counts.
 */
/**
 * There is exactly ONE way a run ends now: the timer. Missing an obstacle
 * makes the runner stumble and carry on, so the old win/lose split is gone —
 * everyone who starts finishes.
 *
 * `null` is kept as a defensive input (a run torn down before RUN_DONE) and
 * resolves to the same completion copy.
 */
export type EndReason = 'time' | null;

export interface GameOverCopy {
  title: string;
  sub: string;
  /** always 'win': reaching the plateau is the only outcome there is */
  tone: 'win';
}

export function gameOverCopy(_reason: EndReason): GameOverCopy {
  // Warm, but deliberately NOT a celebration of how well it went — the stats
  // and the Musculage carry that. Over-congratulating a poor run would make
  // the good ones mean nothing.
  return {
    title: 'You made the plateau',
    sub: 'Kaho to Dong, on foot, in the dark.',
    tone: 'win',
  };
}

export function reportHeading(_reason: EndReason): string {
  return 'You made it to Dong';
}
