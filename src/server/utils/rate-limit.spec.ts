// @vitest-environment node
import { createKeyedRateLimiter, createRateLimiter } from './rate-limit';

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

describe('createKeyedRateLimiter', () => {
  const WINDOW = 15 * 60_000;
  let now = 0;
  const limiter = createKeyedRateLimiter({
    max: 5,
    globalMax: 20,
    windowMs: WINDOW,
    now: () => now,
  });

  beforeEach(() => {
    now = 1_000_000;
    limiter.clear();
  });

  it('blocks one key after its failures, leaving other keys alone', () => {
    for (let i = 0; i < 5; i++) limiter.recordFailure('alice');
    expect(limiter.isBlocked('alice')).toBe(true);
    expect(limiter.isBlocked('bob')).toBe(false);
  });

  it('blocks every key once failures across keys reach the global cap', () => {
    for (let i = 0; i < 20; i++) limiter.recordFailure(`user${i}`);
    expect(limiter.isBlocked('bob')).toBe(true);
    now += WINDOW;
    expect(limiter.isBlocked('bob')).toBe(false);
  });

  it('clears only the key on success; the global count keeps running', () => {
    for (let i = 0; i < 5; i++) limiter.recordFailure('alice');
    limiter.reset('alice');
    expect(limiter.isBlocked('alice')).toBe(false);
    for (let i = 0; i < 15; i++) limiter.recordFailure(`user${i}`);
    expect(limiter.isBlocked('alice')).toBe(true);
  });

  it('forgets failures older than the window', () => {
    for (let i = 0; i < 4; i++) limiter.recordFailure('alice');
    now += WINDOW;
    limiter.recordFailure('alice');
    expect(limiter.isBlocked('alice')).toBe(false);
  });
});
