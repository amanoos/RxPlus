// @vitest-environment node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { createRxNavClient, RxNavUnavailableError } from './client';

const BASE = 'https://rxnav.test/REST';
const fixture = (name: string) => readFileSync(join(__dirname, 'fixtures', `${name}.json`), 'utf8');

/** Maps RxNav paths to recorded fixtures; records every requested URL. */
function fixtureFetch(overrides: Record<string, () => Promise<Response>> = {}) {
  const routes: Record<string, string> = {
    '/Prescribe/displaynames.json': 'displaynames-sample',
    '/Prescribe/drugs.json?name=lisinopril': 'drugs-lisinopril',
    '/Prescribe/drugs.json?name=zzqqxx': 'drugs-empty',
  };
  for (const id of ['314076', '104377', '197885', '29046']) {
    routes[`/rxcui/${id}/properties.json`] = `properties-${id}`;
    routes[`/rxcui/${id}/related.json?tty=IN+BN+DF`] = `related-${id}`;
    routes[`/rxcui/${id}/allProperties.json?prop=attributes`] = `attributes-${id}`;
  }
  routes['/rxcui.json?name=Atorvastatin%20calcium&search=2'] = 'rxcui-name-atorvastatin-calcium';
  routes['/rxcui.json?name=Lisinopril&search=2'] = 'rxcui-name-lisinopril';
  routes['/rxcui.json?name=Zzqqxx&search=2'] = 'rxcui-name-none';
  routes['/rxcui/83366/related.json?tty=IN'] = 'related-in-83366';
  routes['/rxcui/29046/related.json?tty=IN'] = 'related-in-29046';
  const calls: string[] = [];
  const fetchFn = vi.fn(async (input: string | URL | Request) => {
    const url = String(input);
    calls.push(url);
    const path = url.slice(BASE.length);
    if (overrides[path]) return overrides[path]();
    const name = routes[path];
    if (name) return new Response(fixture(name), { status: 200 });
    return new Response('{}', { status: 200 });
  });
  return { fetchFn, calls };
}

describe('RxNav client', () => {
  let now = 0;
  const create = (fetchFn: typeof fetch) =>
    createRxNavClient({ baseUrl: BASE, fetch: fetchFn, now: () => now });

  beforeEach(() => {
    now = 1_000_000;
  });

  describe('search', () => {
    it('ranks exact, prefix, word-prefix, then substring matches, case-insensitively', async () => {
      const client = create(fixtureFetch().fetchFn);
      const results = await client.search('lisinopril');
      expect(results[0]).toBe('lisinopril');
      expect(results).toContain('hydroCHLOROthiazide / lisinopril');
      expect(results.indexOf('lisinopril')).toBeLessThan(
        results.indexOf('hydroCHLOROthiazide / lisinopril'),
      );
    });

    it('matches tall-man lettered names and caps results at 20', async () => {
      const client = create(fixtureFetch().fetchFn);
      expect(await client.search('METFORMIN')).toContain('metFORMIN');
      expect((await client.search('a')).length).toBeLessThanOrEqual(20);
    });

    it('downloads the name list once and caches it for 24 hours', async () => {
      const { fetchFn, calls } = fixtureFetch();
      const client = create(fetchFn);
      await client.search('lisin');
      await client.search('zest');
      expect(calls.filter((c) => c.includes('displaynames'))).toHaveLength(1);

      now += 24 * 60 * 60 * 1000;
      await client.search('lisin');
      expect(calls.filter((c) => c.includes('displaynames'))).toHaveLength(2);
    });
  });

  describe('products', () => {
    it('returns generic products first, then branded, with brand names from SBD names', async () => {
      const client = create(fixtureFetch().fetchFn);
      const products = await client.products('lisinopril');
      expect(products.length).toBe(22);
      expect(products[0].tty).toBe('SCD');
      expect(products.at(-1)?.tty).toBe('SBD');
      expect(products).toContainEqual({
        rxcui: '104377',
        name: 'lisinopril 10 MG Oral Tablet [Zestril]',
        tty: 'SBD',
        brandName: 'Zestril',
      });
      expect(products).toContainEqual({
        rxcui: '197885',
        name: 'hydrochlorothiazide 12.5 MG / lisinopril 10 MG Oral Tablet',
        tty: 'SCD',
        brandName: null,
      });
    });

    it('returns an empty list for an unknown name', async () => {
      expect(await create(fixtureFetch().fetchFn).products('zzqqxx')).toEqual([]);
    });
  });

  describe('product', () => {
    it('resolves a generic product with strength, form and ingredient', async () => {
      expect(await create(fixtureFetch().fetchFn).product('314076')).toEqual({
        rxcui: '314076',
        tty: 'SCD',
        name: 'lisinopril 10 MG Oral Tablet',
        strength: '10 MG',
        doseForm: 'Oral Tablet',
        brandName: null,
        ingredients: [{ rxcui: '29046', name: 'lisinopril' }],
      });
    });

    it('resolves a branded product with its brand', async () => {
      expect(await create(fixtureFetch().fetchFn).product('104377')).toMatchObject({
        tty: 'SBD',
        name: 'lisinopril 10 MG Oral Tablet [Zestril]',
        brandName: 'Zestril',
        strength: '10 MG',
      });
    });

    it('resolves a combination product with every ingredient', async () => {
      const product = await create(fixtureFetch().fetchFn).product('197885');
      expect(product?.strength).toBe('12.5 MG / 10 MG');
      expect(product?.brandName).toBeNull();
      expect(product?.ingredients).toEqual(
        expect.arrayContaining([
          { rxcui: '29046', name: 'lisinopril' },
          { rxcui: '5487', name: 'hydrochlorothiazide' },
        ]),
      );
    });

    it('returns null for an ingredient or unknown RXCUI', async () => {
      const client = create(fixtureFetch().fetchFn);
      expect(await client.product('29046')).toBeNull();
      expect(await client.product('999999999')).toBeNull();
    });
  });

  describe('ingredientByName', () => {
    it('maps a name to its RxNorm ingredient, via the related IN for salts', async () => {
      const client = create(fixtureFetch().fetchFn);
      expect(await client.ingredientByName('Lisinopril')).toBe('29046');
      expect(await client.ingredientByName('Atorvastatin calcium')).toBe('83367');
    });

    it('returns null for an unknown name', async () => {
      expect(await create(fixtureFetch().fetchFn).ingredientByName('Zzqqxx')).toBeNull();
    });
  });

  describe('failures', () => {
    it('retries once after a network error', async () => {
      let attempts = 0;
      const { fetchFn } = fixtureFetch({
        '/Prescribe/drugs.json?name=lisinopril': async () => {
          attempts++;
          if (attempts === 1) throw new TypeError('fetch failed');
          return new Response(fixture('drugs-lisinopril'));
        },
      });
      expect(await create(fetchFn).products('lisinopril')).toHaveLength(22);
      expect(attempts).toBe(2);
    });

    it('throws RxNavUnavailableError after the retry also fails', async () => {
      const { fetchFn } = fixtureFetch({
        '/Prescribe/drugs.json?name=lisinopril': async () => {
          throw new TypeError('fetch failed');
        },
      });
      await expect(create(fetchFn).products('lisinopril')).rejects.toBeInstanceOf(
        RxNavUnavailableError,
      );
    });

    it('treats a 5xx response as unavailable', async () => {
      const { fetchFn } = fixtureFetch({
        '/Prescribe/drugs.json?name=lisinopril': async () => new Response('oops', { status: 503 }),
      });
      await expect(create(fetchFn).products('lisinopril')).rejects.toBeInstanceOf(
        RxNavUnavailableError,
      );
    });

    it('gives up after the timeout without retrying', async () => {
      vi.useFakeTimers();
      try {
        let attempts = 0;
        const { fetchFn } = fixtureFetch({
          '/Prescribe/drugs.json?name=lisinopril': () => {
            attempts++;
            return new Promise(() => undefined);
          },
        });
        const result = create(fetchFn).products('lisinopril');
        const assertion = expect(result).rejects.toBeInstanceOf(RxNavUnavailableError);
        await vi.advanceTimersByTimeAsync(5000);
        await assertion;
        expect(attempts).toBe(1);
      } finally {
        vi.useRealTimers();
      }
    });

    it('caches product details for 7 days', async () => {
      const { fetchFn, calls } = fixtureFetch();
      const client = create(fetchFn);
      await client.product('314076');
      await client.product('314076');
      expect(calls.filter((c) => c.includes('/rxcui/314076/properties'))).toHaveLength(1);
      now += 7 * 24 * 60 * 60 * 1000;
      await client.product('314076');
      expect(calls.filter((c) => c.includes('/rxcui/314076/properties'))).toHaveLength(2);
    });
  });
});
