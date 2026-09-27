// @vitest-environment node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { createOpenFdaClient, OpenFdaUnavailableError, redactKey } from './client';

const BASE = 'https://openfda.test/drug';
const fixture = (name: string) => readFileSync(join(__dirname, 'fixtures', `${name}.json`), 'utf8');

function fixtureFetch(override?: (url: URL) => Promise<Response>) {
  const calls: URL[] = [];
  const fetchFn = vi.fn(async (input: string | URL | Request) => {
    const url = new URL(String(input));
    calls.push(url);
    if (override) return override(url);
    const rxcui = /openfda\.rxcui:(\d+)/.exec(url.searchParams.get('search') ?? '')?.[1];
    const known = ['314076', '617310', '313096'];
    return rxcui && known.includes(rxcui)
      ? new Response(fixture(`label-${rxcui}`))
      : new Response(fixture('label-none'), { status: 404 });
  });
  return { fetchFn, calls };
}

describe('openFDA client', () => {
  let now = 0;
  const create = (fetchFn: typeof fetch, apiKey?: string) =>
    createOpenFdaClient({ baseUrl: BASE, apiKey, fetch: fetchFn, now: () => now });

  beforeEach(() => {
    now = 1_000_000;
  });

  it('asks only for labels that have an interactions section, newest first', async () => {
    const { fetchFn, calls } = fixtureFetch();
    await create(fetchFn).interactionLabel('314076');
    const url = calls[0];
    expect(`${url.origin}${url.pathname}`).toBe(`${BASE}/label.json`);
    expect(url.searchParams.get('search')).toBe(
      'openfda.rxcui:314076 AND _exists_:drug_interactions',
    );
    expect(url.searchParams.get('sort')).toBe('effective_time:desc');
    expect(url.searchParams.get('limit')).toBe('1');
    expect(url.searchParams.has('api_key')).toBe(false);
  });

  it('sends the API key when configured', async () => {
    const { fetchFn, calls } = fixtureFetch();
    await create(fetchFn, 'secret-key').interactionLabel('314076');
    expect(calls[0].searchParams.get('api_key')).toBe('secret-key');
  });

  it('returns the label with interaction text and table text stripped of HTML', async () => {
    const label = await create(fixtureFetch().fetchFn).interactionLabel('617310');
    expect(label).toMatchObject({
      rxcui: '617310',
      manufacturer: expect.any(String),
      effectiveDate: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      setId: expect.stringMatching(/^[0-9a-f-]{36}$/),
    });
    expect(label?.text).toMatch(/clarithromycin/i);
    expect(label?.text).not.toMatch(/<[a-z]/i);
    expect(label?.dailyMedUrl).toBe(
      `https://dailymed.nlm.nih.gov/dailymed/lookup.cfm?setid=${label?.setId}`,
    );
  });

  it('returns null when no label with an interactions section exists', async () => {
    expect(await create(fixtureFetch().fetchFn).interactionLabel('999999999')).toBeNull();
  });

  it('caches labels for 7 days', async () => {
    const { fetchFn, calls } = fixtureFetch();
    const client = create(fetchFn);
    await client.interactionLabel('314076');
    await client.interactionLabel('314076');
    expect(calls).toHaveLength(1);
    now += 7 * 24 * 60 * 60 * 1000;
    await client.interactionLabel('314076');
    expect(calls).toHaveLength(2);
  });

  it('retries once on network errors, then reports unavailable', async () => {
    let attempts = 0;
    const { fetchFn } = fixtureFetch(async () => {
      attempts++;
      throw new TypeError('fetch failed');
    });
    await expect(create(fetchFn).interactionLabel('314076')).rejects.toBeInstanceOf(
      OpenFdaUnavailableError,
    );
    expect(attempts).toBe(2);
  });

  it('treats 429 and 5xx as unavailable and never leaks the key in the error', async () => {
    for (const status of [429, 503]) {
      const { fetchFn } = fixtureFetch(async () => new Response('{}', { status }));
      const error = await create(fetchFn, 'secret-key')
        .interactionLabel('314076')
        .catch((e: unknown) => e);
      expect(error).toBeInstanceOf(OpenFdaUnavailableError);
      expect(String((error as Error).message)).not.toContain('secret-key');
    }
  });

  it('gives up after the timeout without retrying', async () => {
    vi.useFakeTimers();
    try {
      let attempts = 0;
      const { fetchFn } = fixtureFetch(() => {
        attempts++;
        return new Promise(() => undefined);
      });
      const result = create(fetchFn).interactionLabel('314076');
      const assertion = expect(result).rejects.toBeInstanceOf(OpenFdaUnavailableError);
      await vi.advanceTimersByTimeAsync(5000);
      await assertion;
      expect(attempts).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('redacts api_key from URLs', () => {
    expect(redactKey('https://api.fda.gov/drug/label.json?search=x&api_key=abc123')).toBe(
      'https://api.fda.gov/drug/label.json?search=x&api_key=REDACTED',
    );
  });
});
