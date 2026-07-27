import { describe, expect, it } from 'vitest';
import { gameOverCopy, reportHeading } from '../gameover-copy';

describe('gameOverCopy — every run completes (a miss stumbles, it never ends the run)', () => {
  it('timer expiry is the completion outcome', () => {
    const c = gameOverCopy('time');
    expect(c.title).toBe('You made the plateau');
    expect(c.tone).toBe('win');
  });

  it('there is no loss outcome left to reach', () => {
    // the old 'lives' end reason no longer exists — the ONLY way a run ends
    // is the timer, so nothing may ever render as a failure
    expect(gameOverCopy(null).tone).toBe('win');
    expect(gameOverCopy('time').tone).toBe('win');
    expect(gameOverCopy(null).title).toBe(gameOverCopy('time').title);
  });

  it('report heading is the same arrival regardless of input', () => {
    expect(reportHeading('time')).toBe('You made it to Dong');
    expect(reportHeading(null)).toBe('You made it to Dong');
  });
});
