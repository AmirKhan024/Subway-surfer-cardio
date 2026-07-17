/** Pure-helper tests for the diagnostics logger (node-safe parts only). */
import { describe, it, expect } from 'vitest';
import { formatEntries, roundingReplacer, type LogEntry } from '../run-logger';

describe('run-logger formatting', () => {
  it('roundingReplacer rounds floats to 3dp and leaves ints/strings alone', () => {
    const obj = { a: 0.123456789, b: 3, c: 'x', d: NaN };
    const out = JSON.parse(JSON.stringify(obj, roundingReplacer));
    expect(out.a).toBe(0.123);
    expect(out.b).toBe(3);
    expect(out.c).toBe('x');
    expect(out.d).toBeNull(); // NaN serializes to null (finite check skips it)
  });

  it('formatEntries renders relative times and data payloads', () => {
    const entries: LogEntry[] = [
      { t: 1000, tag: 'RUN_RESET', data: { seed: 1337 } },
      { t: 3500, tag: 'OBSTACLE', data: { id: 0, cleared: true, crouchAtGate: 0.987654 } },
      { t: 4000, tag: 'TRACKING_LOST' },
    ];
    const text = formatEntries(entries);
    const lines = text.split('\n');
    expect(lines).toHaveLength(3);
    expect(lines[0]).toContain('0.00s');
    expect(lines[0]).toContain('RUN_RESET');
    expect(lines[0]).toContain('1337');
    expect(lines[1]).toContain('2.50s');
    expect(lines[1]).toContain('0.988'); // rounded
    expect(lines[2]).toContain('TRACKING_LOST');
  });

  it('formatEntries handles an empty buffer', () => {
    expect(formatEntries([])).toBe('(no events)');
  });
});
