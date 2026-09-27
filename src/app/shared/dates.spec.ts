import { localToday } from './dates';

describe('localToday', () => {
  it('formats the local calendar day as YYYY-MM-DD', () => {
    expect(localToday(new Date(2026, 0, 5, 23, 30))).toBe('2026-01-05');
    expect(localToday(new Date(2026, 11, 31, 0, 1))).toBe('2026-12-31');
  });
});
