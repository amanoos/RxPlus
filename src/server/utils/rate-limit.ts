export interface RateLimiterOptions {
  max: number;
  windowMs: number;
  now?: () => number;
}

/**
 * In-memory failure counter. A single global bucket is enough for a single-user,
 * single-process app, and it also blocks guessing spread across clients.
 */
export function createRateLimiter({ max, windowMs, now = Date.now }: RateLimiterOptions) {
  let failures: number[] = [];
  const prune = () => {
    const cutoff = now() - windowMs;
    failures = failures.filter((t) => t > cutoff);
  };

  return {
    isBlocked(): boolean {
      prune();
      return failures.length >= max;
    },
    recordFailure(): void {
      prune();
      failures.push(now());
    },
    reset(): void {
      failures = [];
    },
  };
}

/** 5 failed logins within 15 minutes locks further attempts until the window passes. */
export const loginLimiter = createRateLimiter({ max: 5, windowMs: 15 * 60_000 });
