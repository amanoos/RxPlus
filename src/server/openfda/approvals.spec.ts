// @vitest-environment node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { createOpenFdaClient, OpenFdaUnavailableError } from './client';

const BASE = 'https://openfda.test/drug';
const fixture = (name: string) => readFileSync(join(__dirname, 'fixtures', `${name}.json`), 'utf8');

/** Routes Drugs@FDA searches by ingredient and NDA/ANDA, and label searches by name. */
function fixtureFetch() {
  const calls: URL[] = [];
  const fetchFn = vi.fn(async (input: string | URL | Request) => {
    const url = new URL(String(input));
    calls.push(url);
    const search = url.searchParams.get('search') ?? '';
    if (url.pathname.endsWith('/drugsfda.json')) {
      const ingredient = /active_ingredients\.name:"?([A-Z ]+)/
        .exec(search)?.[1]
        .trim()
        .toLowerCase();
      const kind = search.includes('application_number:ANDA') ? 'anda' : 'nda';
      const name = `drugsfda-${kind}-${ingredient}`;
      try {
        const body = fixture(name);
        return new Response(body, { status: body.includes('NOT_FOUND') ? 404 : 200 });
      } catch {
        return new Response(fixture('label-none'), { status: 404 });
      }
    }
    if (url.pathname.endsWith('/label.json')) {
      const name = /generic_name:"([A-Z ]+)"/.exec(search)?.[1].toLowerCase();
      try {
        return new Response(fixture(`indications-${name}`));
      } catch {
        return new Response(fixture('label-none'), { status: 404 });
      }
    }
    return new Response('{}', { status: 404 });
  });
  return { fetchFn, calls };
}

describe('openFDA Drugs@FDA facts', () => {
  const create = (fetchFn: typeof fetch) => createOpenFdaClient({ baseUrl: BASE, fetch: fetchFn });

  it('searches NDAs and ANDAs by ingredient, salts included', async () => {
    const { fetchFn, calls } = fixtureFetch();
    await create(fetchFn).approvalFacts('Enalapril');
    expect(calls.map((u) => u.searchParams.get('search')).sort()).toEqual([
      'products.active_ingredients.name:ENALAPRIL* AND application_number:ANDA*',
      'products.active_ingredients.name:ENALAPRIL* AND application_number:NDA*',
    ]);
  });

  it('finds the first approval and whether a generic exists', async () => {
    const client = create(fixtureFetch().fetchFn);
    expect(await client.approvalFacts('lisinopril')).toEqual({
      firstApproved: '1987-12-29',
      genericAvailable: true,
    });
    expect(await client.approvalFacts('enalapril')).toEqual({
      firstApproved: '1985-12-24',
      genericAvailable: true,
    });
    // New in 2024, no generic yet (the ANDA search finds nothing).
    expect(await client.approvalFacts('aprocitentan')).toEqual({
      firstApproved: '2024-03-19',
      genericAvailable: false,
    });
  });

  it('counts a combination-only drug as approved but not as its own generic', async () => {
    // Sacubitril is only sold with valsartan: approved in 2015; generics are combinations.
    expect(await create(fixtureFetch().fetchFn).approvalFacts('sacubitril')).toEqual({
      firstApproved: '2015-07-07',
      genericAvailable: false,
    });
  });

  it('never counts a metabolite as the drug (enalaprilat vs enalapril)', async () => {
    const app = (number: string, ingredient: string, date: string) => ({
      application_number: number,
      products: [{ active_ingredients: [{ name: ingredient }] }],
      submissions: [
        { submission_type: 'ORIG', submission_status: 'AP', submission_status_date: date },
      ],
    });
    // The wildcard search finds both; only the enalaprilat ones are earliest / generic.
    const fetchFn = vi.fn(async (input: string | URL | Request) => {
      const search = new URL(String(input)).searchParams.get('search') ?? '';
      const results = search.includes('ANDA')
        ? [app('ANDA000002', 'ENALAPRILAT', '19950101')]
        : [
            app('NDA000001', 'ENALAPRILAT', '19800101'),
            app('NDA018998', 'ENALAPRIL MALEATE', '19851224'),
          ];
      return new Response(JSON.stringify({ results }));
    });
    expect(await create(fetchFn).approvalFacts('enalapril')).toEqual({
      firstApproved: '1985-12-24',
      genericAvailable: false,
    });
  });

  it('uses a phrase for multi-word names and returns nothing for blank ones', async () => {
    const { fetchFn, calls } = fixtureFetch();
    const client = create(fetchFn);
    expect(await client.approvalFacts('insulin glargine')).toEqual({
      firstApproved: null,
      genericAvailable: false,
    });
    expect(calls[0].searchParams.get('search')).toMatch(
      /^products\.active_ingredients\.name:"INSULIN GLARGINE" AND/,
    );
    expect(await client.approvalFacts('  ')).toEqual({
      firstApproved: null,
      genericAvailable: false,
    });
  });

  it('reports outages as unavailable', async () => {
    const down = vi.fn(async () => new Response('', { status: 500 }));
    await expect(create(down).approvalFacts('lisinopril')).rejects.toBeInstanceOf(
      OpenFdaUnavailableError,
    );
  });
});

describe('openFDA label indications', () => {
  const create = (fetchFn: typeof fetch) => createOpenFdaClient({ baseUrl: BASE, fetch: fetchFn });

  it('collects the indications of several single-ingredient labels', async () => {
    const texts = await create(fixtureFetch().fetchFn).indications('sildenafil');
    expect(texts.length).toBeGreaterThan(1);
    expect(texts.length).toBeLessThanOrEqual(5);
    // Different labels, different uses: both appear.
    expect(texts.some((t) => /erectile dysfunction/i.test(t))).toBe(true);
    expect(texts.some((t) => /pulmonary arterial hypertension/i.test(t))).toBe(true);
    expect(new Set(texts).size).toBe(texts.length);
  });

  it('returns plain text', async () => {
    const texts = await create(fixtureFetch().fetchFn).indications('hydralazine');
    expect(texts[0]).toMatch(/essential hypertension/i);
    expect(texts.join(' ')).not.toMatch(/<[a-z]+[ >]/);
  });

  it('returns nothing when no label is found', async () => {
    expect(await create(fixtureFetch().fetchFn).indications('zzqx')).toEqual([]);
  });
});
