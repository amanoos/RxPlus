// @vitest-environment node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { createOpenFdaClient, OpenFdaUnavailableError } from './client';

const BASE = 'https://openfda.test/drug';
const fixture = (name: string) => readFileSync(join(__dirname, 'fixtures', `${name}.json`), 'utf8');

function fixtureFetch() {
  const calls: URL[] = [];
  const fetchFn = vi.fn(async (input: string | URL | Request) => {
    const url = new URL(String(input));
    calls.push(url);
    const search = url.searchParams.get('search') ?? '';
    if (url.pathname.endsWith('/label.json')) {
      return search.includes('openfda.rxcui:314076')
        ? new Response(fixture('summary-label-314076'))
        : new Response(fixture('label-none'), { status: 404 });
    }
    if (url.pathname.endsWith('/event.json')) {
      if (!search.includes('"LISINOPRIL"')) {
        return new Response(fixture('faers-none'), { status: 404 });
      }
      return url.searchParams.has('count')
        ? new Response(fixture('faers-count-lisinopril'))
        : new Response(fixture('faers-total-lisinopril'));
    }
    return new Response('{}', { status: 404 });
  });
  return { fetchFn, calls };
}

describe('openFDA summaryLabel', () => {
  let now = 0;
  const create = (fetchFn: typeof fetch) =>
    createOpenFdaClient({ baseUrl: BASE, fetch: fetchFn, now: () => now });

  beforeEach(() => {
    now = 1_000_000;
  });

  it('asks for the newest label that has indications', async () => {
    const { fetchFn, calls } = fixtureFetch();
    await create(fetchFn).summaryLabel('314076');
    expect(calls[0].searchParams.get('search')).toBe(
      'openfda.rxcui:314076 AND _exists_:indications_and_usage',
    );
    expect(calls[0].searchParams.get('sort')).toBe('effective_time:desc');
  });

  it('returns the label reference and the summary sections as plain text', async () => {
    const label = await create(fixtureFetch().fetchFn).summaryLabel('314076');
    expect(label).toMatchObject({
      rxcui: '314076',
      setId: expect.stringMatching(/^[0-9a-f-]{36}$/),
      version: '2',
      effectiveDate: '2026-09-10',
      manufacturer: 'REMEDYREPACK INC.',
      dailyMedUrl: expect.stringContaining('dailymed.nlm.nih.gov'),
    });
    expect(label?.sections.map((s) => s.name)).toEqual([
      'indications_and_usage',
      'boxed_warning',
      'contraindications',
      'warnings_and_cautions',
      'adverse_reactions',
      'clinical_studies',
      'mechanism_of_action',
      'information_for_patients',
    ]);
    const indications = label?.sections[0].text ?? '';
    expect(indications).toMatch(/hypertension/i);
    expect(indications).not.toMatch(/<[a-z]/i);
  });

  it('returns null when no label exists, and caches with an explicit refresh', async () => {
    const { fetchFn, calls } = fixtureFetch();
    const client = create(fetchFn);
    expect(await client.summaryLabel('999')).toBeNull();
    await client.summaryLabel('314076');
    await client.summaryLabel('314076');
    expect(calls.filter((c) => c.searchParams.get('search')?.includes('314076'))).toHaveLength(1);
    await client.summaryLabel('314076', { refresh: true });
    expect(calls.filter((c) => c.searchParams.get('search')?.includes('314076'))).toHaveLength(2);
  });

  it('falls back to the older "warnings" section', async () => {
    const legacy = JSON.parse(fixture('summary-label-314076'));
    const result = legacy.results[0];
    result.warnings = result.warnings_and_cautions;
    delete result.warnings_and_cautions;
    const client = create(vi.fn(async () => new Response(JSON.stringify(legacy))));
    const label = await client.summaryLabel('314076');
    expect(label?.sections.map((s) => s.name)).toContain('warnings');
  });
});

describe('openFDA reportedReactions', () => {
  const create = (fetchFn: typeof fetch) => createOpenFdaClient({ baseUrl: BASE, fetch: fetchFn });

  it('returns the top reported reactions and the total number of reports', async () => {
    const { fetchFn, calls } = fixtureFetch();
    const result = await create(fetchFn).reportedReactions('lisinopril');
    expect(result.total).toBe(304318);
    expect(result.reactions).toHaveLength(10);
    expect(result.reactions[0]).toEqual({ term: 'FATIGUE', count: expect.any(Number) });
    const countCall = calls.find((c) => c.searchParams.has('count'));
    expect(countCall?.searchParams.get('search')).toBe(
      'patient.drug.openfda.generic_name.exact:"LISINOPRIL"',
    );
    expect(countCall?.searchParams.get('count')).toBe('patient.reaction.reactionmeddrapt.exact');
  });

  it('returns no reports for an unknown ingredient', async () => {
    expect(await create(fixtureFetch().fetchFn).reportedReactions('zzqqxx')).toEqual({
      total: 0,
      reactions: [],
    });
  });

  it('reports openFDA outages', async () => {
    const down = vi.fn(async () => new Response('{}', { status: 503 }));
    await expect(create(down).reportedReactions('lisinopril')).rejects.toBeInstanceOf(
      OpenFdaUnavailableError,
    );
  });
});
