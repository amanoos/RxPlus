// @vitest-environment node
import type { Digest } from './repository';
import { addDays, dateIn, digestWindow, needsCatchUp } from './run';

const digest = (overrides: Partial<Digest>): Digest => ({
  id: 'd1',
  userId: 'u1',
  status: 'ready',
  trigger: 'schedule',
  windowStart: '2026-09-14',
  windowEnd: '2026-09-21',
  startedAt: new Date('2026-09-21T10:00:00Z'),
  finishedAt: new Date('2026-09-21T10:05:00Z'),
  error: null,
  notes: null,
  claudeCalls: 0,
  ...overrides,
});

describe('digest window', () => {
  it('covers the past week on the first run', () => {
    expect(digestWindow(null, '2026-09-28')).toEqual({ from: '2026-09-21', to: '2026-09-28' });
  });

  it('starts on the last run’s end date, so news entered later that day is not missed', () => {
    expect(digestWindow(digest({}), '2026-09-28')).toEqual({
      from: '2026-09-21',
      to: '2026-09-28',
    });
  });

  it('reads today in the server time zone and does date arithmetic across months', () => {
    // 2026-09-28 02:00 UTC is still Sep 27 in New York.
    expect(dateIn('America/New_York', Date.parse('2026-09-28T02:00:00Z'))).toBe('2026-09-27');
    expect(addDays('2026-10-02', -7)).toBe('2026-09-25');
    expect(addDays('2026-12-30', 3)).toBe('2027-01-02');
  });
});

describe('catch-up decision', () => {
  const started = Date.parse('2026-09-21T10:00:00Z');
  const DAY = 24 * 60 * 60 * 1000;

  it('catches up when the last successful run is more than a week old', () => {
    expect(needsCatchUp(digest({}), started + 7 * DAY + 60_000)).toBe(true);
  });

  it('waits when the last run is within the week, or when there has never been one', () => {
    expect(needsCatchUp(digest({}), started + 7 * DAY - 60_000)).toBe(false);
    expect(needsCatchUp(null, started)).toBe(false);
  });
});
