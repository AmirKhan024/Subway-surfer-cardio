import { describe, expect, it } from 'vitest';
import { gameOverCopy, reportHeading } from '../gameover-copy';

describe('gameOverCopy — driven by RUN_DONE reason, never by lives', () => {
  it("timer expiry is an achievement — never 'Out of lives'", () => {
    const c = gameOverCopy('time');
    expect(c.title).toBe("Time's up!");
    expect(c.tone).toBe('win');
    expect(c.title).not.toContain('Out of lives');
  });

  it("'lives' is the ONLY reason that reads as a loss", () => {
    expect(gameOverCopy('lives').title).toBe('Out of lives');
    expect(gameOverCopy('lives').tone).toBe('lose');
    expect(gameOverCopy('course').tone).toBe('win');
    expect(gameOverCopy(null).tone).toBe('win'); // safe default
  });

  it('report heading follows the same rule', () => {
    expect(reportHeading('time')).toBe('Session complete!');
    expect(reportHeading('lives')).toBe('Run over');
  });
});
