// @vitest-environment node
import { nextScheduledRun } from './service';

describe('next scheduled run', () => {
  const NY = 'America/New_York';

  it('is the coming Monday at 6:00 AM in the server time zone', () => {
    // Sunday 2026-09-27, 11:30 PM in New York (EDT, UTC-4).
    expect(nextScheduledRun(Date.parse('2026-09-28T03:30:00Z'), NY).toISOString()).toBe(
      '2026-09-28T10:00:00.000Z',
    );
  });

  it('moves to the next week once Monday 6:00 AM has passed', () => {
    expect(nextScheduledRun(Date.parse('2026-09-28T10:00:00Z'), NY).toISOString()).toBe(
      '2026-10-05T10:00:00.000Z',
    );
  });

  it('follows daylight saving time', () => {
    // After the switch to EST (UTC-5) on 2026-11-01.
    expect(nextScheduledRun(Date.parse('2026-11-01T12:00:00Z'), NY).toISOString()).toBe(
      '2026-11-02T11:00:00.000Z',
    );
  });
});
