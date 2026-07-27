import { describe, expect, it } from 'vitest';
import { gameOverCopy, reportHeading } from '../gameover-copy';

describe('gameOverCopy — driven by RUN_DONE reason, never by lives', () => {
  it('timer expiry is an achievement — never the loss copy', () => {
    const c = gameOverCopy('time');
    expect(c.title).toBe('You made the plateau');
    expect(c.tone).toBe('win');
    expect(c.title).not.toContain('took you down');
  });

  it("'lives' is the ONLY reason that reads as a loss", () => {
    expect(gameOverCopy('lives').title).toBe('The trail took you down');
    expect(gameOverCopy('lives').tone).toBe('lose');
    expect(gameOverCopy(null).tone).toBe('win'); // safe default
  });

  it('report heading follows the same rule', () => {
    expect(reportHeading('time')).toBe('You made it to Dong');
    expect(reportHeading('lives')).toBe('The run broke');
  });
});
