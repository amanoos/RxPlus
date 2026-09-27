/** Shared plumbing for calls to public upstream APIs (RxNav, openFDA, PubMed, …). */

export interface GetJsonOptions {
  fetch: typeof fetch;
  timeoutMs: number;
  /** Builds the client's own "unavailable" error. */
  unavailable: (message: string) => Error;
  /** Builds the error for a 429 (default: `unavailable`), e.g. so a client can back off and retry. */
  rateLimited?: () => Error;
}

export interface JsonResponse {
  status: number;
  body: unknown;
}

export interface TextResponse {
  status: number;
  text: string;
}

class RetryableError extends Error {}

/**
 * GET JSON with a timeout (never retried) and one retry on network errors and 5xx.
 * 429, invalid JSON and repeated failures become `unavailable`; other statuses are returned.
 */
export async function getJson(url: string, options: GetJsonOptions): Promise<JsonResponse> {
  const { status, text } = await withRetry(url, options, 'application/json');
  try {
    return { status, body: text ? JSON.parse(text) : null };
  } catch {
    throw options.unavailable('unreadable response');
  }
}

/** Like getJson, for non-JSON bodies (e.g. PubMed's XML). */
export function getText(
  url: string,
  options: GetJsonOptions & { accept?: string },
): Promise<TextResponse> {
  return withRetry(url, options, options.accept ?? '*/*');
}

async function withRetry(
  url: string,
  options: GetJsonOptions,
  accept: string,
): Promise<TextResponse> {
  try {
    return await attempt(url, options, accept);
  } catch (error) {
    if (!(error instanceof RetryableError)) throw error;
    try {
      return await attempt(url, options, accept);
    } catch (retryError) {
      if (!(retryError instanceof RetryableError)) throw retryError;
      throw options.unavailable(`unreachable: ${retryError.message}`);
    }
  }
}

async function attempt(
  url: string,
  { fetch: fetchFn, timeoutMs, unavailable, rateLimited }: GetJsonOptions,
  accept: string,
): Promise<TextResponse> {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  let response: Response;
  try {
    response = await Promise.race([
      fetchFn(url, { signal: controller.signal, headers: { accept } }),
      new Promise<never>((_, reject) =>
        controller.signal.addEventListener('abort', () => reject(new Error('aborted'))),
      ),
    ]);
  } catch (error) {
    if (timedOut) throw unavailable('timed out');
    throw new RetryableError(error instanceof Error ? error.message : String(error));
  } finally {
    clearTimeout(timer);
  }

  if (response.status >= 500) throw new RetryableError(`responded ${response.status}`);
  if (response.status === 429) throw rateLimited?.() ?? unavailable('rate limited (429)');
  try {
    return { status: response.status, text: await response.text() };
  } catch {
    throw unavailable('unreadable response');
  }
}

/** Promise cache with per-entry TTL; failed loads are never cached. */
export function createTtlCache(now: () => number) {
  const entries = new Map<string, { expires: number; value: Promise<unknown> }>();
  return function cached<T>(
    key: string,
    ttlMs: number,
    load: () => Promise<T>,
    { refresh = false }: { refresh?: boolean } = {},
  ): Promise<T> {
    const hit = entries.get(key);
    if (!refresh && hit && hit.expires > now()) return hit.value as Promise<T>;
    const value = load();
    entries.set(key, { expires: now() + ttlMs, value });
    value.catch(() => entries.delete(key));
    return value;
  };
}
