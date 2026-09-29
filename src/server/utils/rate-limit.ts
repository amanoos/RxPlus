export interface RateLimiterOptions {
  max: number;
  windowMs: number;
  now?: () => number;
}

/** In-memory failure counter for one bucket. */
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

export interface KeyedRateLimiterOptions extends RateLimiterOptions {
  /** Failures across all keys that block every key. */
  globalMax: number;
}

/**
 * Failure counters per key (a username) plus one across all keys, so guessing
 * spread over many usernames is blocked too. In memory: one process.
 */
export function createKeyedRateLimiter({
  max,
  globalMax,
  windowMs,
  now = Date.now,
}: KeyedRateLimiterOptions) {
  const perKey = new Map<string, number[]>();
  let all: number[] = [];
  const prune = () => {
    const cutoff = now() - windowMs;
    all = all.filter((t) => t > cutoff);
    for (const [key, times] of perKey) {
      const recent = times.filter((t) => t > cutoff);
      if (recent.length) perKey.set(key, recent);
      else perKey.delete(key);
    }
  };

  return {
    isBlocked(key: string): boolean {
      prune();
      return all.length >= globalMax || (perKey.get(key)?.length ?? 0) >= max;
    },
    recordFailure(key: string): void {
      prune();
      all.push(now());
      perKey.set(key, [...(perKey.get(key) ?? []), now()]);
    },
    /** A successful login clears that key only; the global count keeps running. */
    reset(key: string): void {
      perKey.delete(key);
    },
    /** Tests only. */
    clear(): void {
      perKey.clear();
      all = [];
    },
  };
}

/** 5 failed logins for one username, or 20 in all, within 15 minutes block until the window passes. */
export const loginLimiter = createKeyedRateLimiter({
  max: 5,
  globalMax: 20,
  windowMs: 15 * 60_000,
});
