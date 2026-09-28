// @vitest-environment node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { createCostPlusClient, CostPlusUnavailableError, parseDollars } from './client';

const fixture = (name: string) => readFileSync(join(import.meta.dirname, 'fixtures', name), 'utf8');
const BASE = 'https://costplus.test/main';

describe('Cost Plus Drugs client', () => {
  let now = 1_000_000;
  const waits: number[] = [];
  const create = (fetchFn: typeof fetch) =>
    createCostPlusClient({
      baseUrl: BASE,
      fetch: fetchFn,
      now: () => now,
      sleep: async (ms) => {
        waits.push(ms);
      },
    });
  const answer = (name: string) =>
    vi.fn(async (input: string | URL | Request) => {
      void input;
      return new Response(fixture(name), { status: 200 });
    });

  beforeEach(() => {
    now = 1_000_000;
    waits.length = 0;
  });

  it('asks by ingredient name and parses each product sold', async () => {
    const fetchFn = answer('lisinopril.json');
    const { items, fetchedAt } = await create(fetchFn).lookup('Lisinopril');
    expect(fetchedAt).toBe(now);
    expect(String(fetchFn.mock.calls[0][0])).toBe(`${BASE}?medication_name=lisinopril`);
    expect(items.find((i) => i.strength === '10mg')).toEqual({
      ndc: '68180098003',
      strength: '10mg',
      form: 'Tablet',
      brandGeneric: 'Generic',
      unitPrice: 0.011,
      unitBillingPrice: 0.0131,
      url: 'https://www.costplusdrugs.com/medications/lisinopril-10mg-tablet/',
    });
    expect(items.every((i) => /^\d{11}$/.test(i.ndc))).toBe(true);
  });

  it('returns nothing for a drug it does not sell, or a name without letters', async () => {
    const fetchFn = answer('none.json');
    expect((await create(fetchFn).lookup('apixaban')).items).toEqual([]);
    expect((await create(fetchFn).lookup('()')).items).toEqual([]);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('keeps answers for a day and spaces requests', async () => {
    const fetchFn = answer('lisinopril.json');
    const client = create(fetchFn);
    await client.lookup('lisinopril');
    await client.lookup('lisinopril');
    expect(fetchFn).toHaveBeenCalledTimes(1);
    await client.lookup('atorvastatin');
    expect(waits).toEqual([500]);
    now += 24 * 60 * 60 * 1000 + 1;
    await client.lookup('lisinopril');
    expect(fetchFn).toHaveBeenCalledTimes(3);
  });

  it('skips items without an NDC, a price or a secure link', async () => {
    const body = JSON.stringify({
      results: [
        { ndc: '123', unit_billing_price: '$0.01', url: 'https://x' },
        { ndc: '68180098003', unit_billing_price: 'call us', url: 'https://x' },
        { ndc: '68180098003', unit_billing_price: '$0.01', url: 'http://x' },
        { ndc: '68180-0980-03', unit_billing_price: '$0.01', url: 'https://x' },
      ],
    });
    const { items } = await create(vi.fn(async () => new Response(body))).lookup('lisinopril');
    expect(items.map((i) => [i.ndc, i.unitPrice])).toEqual([['68180098003', 0.01]]);
  });

  it('reports errors and unexpected answers as unavailable', async () => {
    const down = vi.fn(async () => new Response('', { status: 500 }));
    await expect(create(down).lookup('lisinopril')).rejects.toBeInstanceOf(
      CostPlusUnavailableError,
    );
    const odd = vi.fn(async () => new Response('{"error":"x"}'));
    await expect(create(odd).lookup('lisinopril')).rejects.toThrow('unexpected answer');
  });

  it('parses dollar amounts', () => {
    expect(parseDollars('$0.0131')).toBe(0.0131);
    expect(parseDollars('12')).toBe(12);
    expect(parseDollars('')).toBeNull();
    expect(parseDollars(undefined)).toBeNull();
  });
});
