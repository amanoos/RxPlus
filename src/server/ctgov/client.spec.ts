// @vitest-environment node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { createCtGovClient, CtGovUnavailableError } from './client';

const fixture = (name: string) => readFileSync(join(import.meta.dirname, 'fixtures', name), 'utf8');

function stubFetch(
  completed = 'completed-lisinopril.json',
  recruiting = 'recruiting-lisinopril.json',
) {
  const calls: URL[] = [];
  const fetchFn = vi.fn(async (input: string | URL | Request) => {
    const url = new URL(String(input));
    calls.push(url);
    const status = url.searchParams.get('filter.overallStatus');
    return new Response(fixture(status === 'COMPLETED' ? completed : recruiting), { status: 200 });
  });
  return { fetchFn, calls };
}

describe('ClinicalTrials.gov client', () => {
  const create = (fetchFn: typeof fetch) =>
    createCtGovClient({ baseUrl: 'https://ctgov.test/api/v2', fetch: fetchFn });

  it('asks for completed trials with results and recruiting trials, newest update first', async () => {
    const { fetchFn, calls } = stubFetch();
    await create(fetchFn).trials('Lisinopril');
    expect(calls.map((u) => u.pathname)).toEqual(['/api/v2/studies', '/api/v2/studies']);
    expect(Object.fromEntries(calls[0].searchParams)).toEqual({
      'query.intr': 'lisinopril',
      sort: 'LastUpdatePostDate:desc',
      fields: 'NCTId,BriefTitle,OverallStatus,Phase,HasResults,StartDate,LastUpdatePostDate',
      'filter.overallStatus': 'COMPLETED',
      aggFilters: 'results:with',
      pageSize: '3',
    });
    expect(Object.fromEntries(calls[1].searchParams)).toMatchObject({
      'filter.overallStatus': 'RECRUITING',
      pageSize: '5',
    });
  });

  it('keeps up to 3 completed trials, then fills to 5 with recruiting ones', async () => {
    const { fetchFn } = stubFetch();
    const trials = await create(fetchFn).trials('lisinopril');
    expect(trials.map((t) => [t.nctId, t.status])).toEqual([
      ['NCT05049616', 'COMPLETED'],
      ['NCT01669434', 'COMPLETED'],
      ['NCT02603809', 'COMPLETED'],
      ['NCT07685938', 'RECRUITING'],
      ['NCT07594535', 'RECRUITING'],
    ]);
    expect(trials[0]).toEqual({
      nctId: 'NCT05049616',
      title: expect.stringMatching(/^Oral Combined Hydrochlorothiazide\/Lisinopril/),
      status: 'COMPLETED',
      phases: ['PHASE4'],
      hasResults: true,
      startDate: '2021-10-18',
      lastUpdate: '2025-11-10',
    });
    expect(trials[4]).toMatchObject({ hasResults: false, phases: ['PHASE4'] });
  });

  it('uses recruiting trials alone when none have results, and nothing when none match', async () => {
    const onlyRecruiting = stubFetch('none.json');
    expect(await create(onlyRecruiting.fetchFn).trials('lisinopril')).toHaveLength(5);
    const nothing = stubFetch('none.json', 'none.json');
    expect(await create(nothing.fetchFn).trials('zzqxnotadrug')).toEqual([]);
    const blank = stubFetch();
    expect(await create(blank.fetchFn).trials('  []  ')).toEqual([]);
    expect(blank.fetchFn).not.toHaveBeenCalled();
  });

  it('caches per ingredient and reports outages as unavailable', async () => {
    const { fetchFn } = stubFetch();
    const client = create(fetchFn);
    await client.trials('lisinopril');
    await client.trials('LISINOPRIL');
    expect(fetchFn).toHaveBeenCalledTimes(2);

    const down = vi.fn(async () => new Response('', { status: 400 }));
    await expect(create(down).trials('lisinopril')).rejects.toBeInstanceOf(CtGovUnavailableError);
  });
});
