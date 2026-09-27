// @vitest-environment node
import { createRateLimiter } from './rate-limit';

describe('createRateLimiter', () => {
  const WINDOW = 15 * 60_000;
  let now = 0;
  const limiter = createRateLimiter({ max: 5, windowMs: WINDOW, now: () => now });

  beforeEach(() => {
    now = 1_000_000;
    limiter.reset();
  });

  it('allows attempts until the limit of failures is reached', () => {
    for (let i = 0; i < 4; i++) limiter.recordFailure();
    expect(limiter.isBlocked()).toBe(false);
    limiter.recordFailure();
    expect(limiter.isBlocked()).toBe(true);
  });

  it('unblocks once the window since the first failure has passed', () => {
    for (let i = 0; i < 5; i++) limiter.recordFailure();
    now += WINDOW - 1;
    expect(limiter.isBlocked()).toBe(true);
    now += 1;
    expect(limiter.isBlocked()).toBe(false);
  });

  it('forgets failures older than the window', () => {
    for (let i = 0; i < 4; i++) limiter.recordFailure();
    now += WINDOW;
    limiter.recordFailure();
    expect(limiter.isBlocked()).toBe(false);
  });

  it('clears failures on reset (successful login)', () => {
    for (let i = 0; i < 5; i++) limiter.recordFailure();
    limiter.reset();
    expect(limiter.isBlocked()).toBe(false);
  });
});
