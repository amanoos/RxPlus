// @vitest-environment node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { createMedlinePlusClient } from './client';

const fixture = (name: string) => readFileSync(join(__dirname, 'fixtures', `${name}.json`), 'utf8');

describe('MedlinePlus Connect client', () => {
  const calls: URL[] = [];
  const client = createMedlinePlusClient({
    baseUrl: 'https://medlineplus.test/service',
    fetch: async (input) => {
      const url = new URL(String(input));
      calls.push(url);
      return new Response(
        fixture(
          url.searchParams.get('mainSearchCriteria.v.c') === '29046'
            ? 'connect-29046'
            : 'connect-none',
        ),
      );
    },
  });

  it('prefers the drug page and strips tracking parameters', async () => {
    expect(await client.drugPage('29046')).toEqual({
      title: 'Lisinopril',
      url: 'https://medlineplus.gov/druginfo/meds/a692051.html',
    });
    expect(calls[0].searchParams.get('mainSearchCriteria.v.cs')).toBe('2.16.840.1.113883.6.88');
    expect(calls[0].searchParams.get('knowledgeResponseType')).toBe('application/json');
  });

  it('returns null when MedlinePlus has nothing', async () => {
    expect(await client.drugPage('1')).toBeNull();
  });
});
