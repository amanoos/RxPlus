// @vitest-environment node
import { createApp, createRouter, toWebHandler } from 'h3';

import productsRoute from '../routes/api/rxnorm/products.get';
import searchRoute from '../routes/api/rxnorm/search.get';
import { RxNavUnavailableError, type RxNavClient } from '../rxnorm/client';
import { useRxNavClient } from '../rxnorm';

describe('RxNorm proxy API', () => {
  const client = {
    search: vi.fn<RxNavClient['search']>(),
    products: vi.fn<RxNavClient['products']>(),
    product: vi.fn<RxNavClient['product']>(),
    ingredientByName: vi.fn<RxNavClient['ingredientByName']>(),
    classNames: vi.fn<RxNavClient['classNames']>(),
    brandNames: vi.fn<RxNavClient['brandNames']>(),
  };
  const handle = toWebHandler(
    createApp().use(
      createRouter()
        .get('/api/rxnorm/search', searchRoute)
        .get('/api/rxnorm/products', productsRoute),
    ),
  );
  const get = (path: string) => handle(new Request(`http://localhost${path}`));

  beforeAll(() => useRxNavClient(client));
  afterAll(() => useRxNavClient(undefined));
  beforeEach(() => vi.resetAllMocks());

  it('searches drug names', async () => {
    client.search.mockResolvedValue(['lisinopril']);
    const res = await get('/api/rxnorm/search?q=%20lisin%20');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(['lisinopril']);
    expect(client.search).toHaveBeenCalledWith('lisin');
  });

  it.each(['', '?q=', '?q=a', `?q=${'x'.repeat(101)}`])(
    'rejects bad search input %j',
    async (qs) => {
      expect((await get(`/api/rxnorm/search${qs}`)).status).toBe(400);
      expect(client.search).not.toHaveBeenCalled();
    },
  );

  it('lists products for a drug', async () => {
    const product = {
      rxcui: '314076',
      name: 'lisinopril 10 MG Oral Tablet',
      tty: 'SCD' as const,
      brandName: null,
    };
    client.products.mockResolvedValue([product]);
    const res = await get('/api/rxnorm/products?name=lisinopril');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([product]);
  });

  it('rejects a missing product name', async () => {
    expect((await get('/api/rxnorm/products')).status).toBe(400);
  });

  it('returns 503 with a generic message when RxNav is unavailable', async () => {
    client.search.mockRejectedValue(new RxNavUnavailableError('RxNav unreachable: ECONNRESET'));
    client.products.mockRejectedValue(new RxNavUnavailableError('RxNav timed out'));
    for (const path of ['/api/rxnorm/search?q=lisin', '/api/rxnorm/products?name=lisinopril']) {
      const res = await get(path);
      expect(res.status).toBe(503);
      const text = await res.text();
      expect(text).toContain('Drug lookup is unavailable right now.');
      expect(text).not.toContain('ECONNRESET');
    }
  });
});
