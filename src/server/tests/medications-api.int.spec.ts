// @vitest-environment node
// Needs the test database: npm run db:test:up
import { sql } from 'drizzle-orm';
import { createApp, createRouter, toWebHandler } from 'h3';

import { createDb } from '../db/client';
import { runMigrations } from '../db/migrate';
import removeRoute from '../routes/api/medications/[id].delete';
import patchRoute from '../routes/api/medications/[id].patch';
import listRoute from '../routes/api/medications/index.get';
import createRoute from '../routes/api/medications/index.post';
import { RxNavUnavailableError, useRxNavClient, type RxNavClient } from '../rxnorm';
import { hashPassword } from '../utils/password';

const TEST_DB =
  process.env['TEST_DATABASE_URL'] ?? 'postgres://rxplus:rxplus@localhost:5433/rxplus_test';

const lisinopril = {
  rxcui: '314076',
  tty: 'SCD' as const,
  name: 'lisinopril 10 MG Oral Tablet',
  brandName: null,
  strength: '10 MG',
  doseForm: 'Oral Tablet',
  ingredients: [{ rxcui: '29046', name: 'lisinopril' }],
};

describe('medications API (integration)', () => {
  const rxnavStub = {
    search: vi.fn<RxNavClient['search']>(),
    products: vi.fn<RxNavClient['products']>(),
    product: vi.fn<RxNavClient['product']>(),
    ingredientByName: vi.fn<RxNavClient['ingredientByName']>(),
    classNames: vi.fn<RxNavClient['classNames']>(),
    brandNames: vi.fn<RxNavClient['brandNames']>(),
    drugFacts: vi.fn<RxNavClient['drugFacts']>(),
    epcClasses: vi.fn<RxNavClient['epcClasses']>(),
    classMembers: vi.fn<RxNavClient['classMembers']>(),
    diseaseMembers: vi.fn<RxNavClient['diseaseMembers']>(),
    diseaseDescendants: vi.fn<RxNavClient['diseaseDescendants']>(),
    toIngredient: vi.fn<RxNavClient['toIngredient']>(),
    usProduct: vi.fn<RxNavClient['usProduct']>(),
  };
  const { db, pool } = createDb(TEST_DB);
  let handle: (req: Request) => Promise<Response>;

  const call = (method: string, path: string, body?: unknown) =>
    handle(
      new Request(`http://localhost${path}`, {
        method,
        headers: body ? { 'content-type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      }),
    );
  const add = (body: unknown) => call('POST', '/api/medications', body);

  beforeAll(async () => {
    process.env['DATABASE_URL'] = TEST_DB;
    process.env['APP_PASSWORD_HASH'] = await hashPassword('irrelevant-password');
    process.env['SESSION_SECRET'] = 's'.repeat(32);
    await runMigrations(TEST_DB, 'drizzle');
    useRxNavClient(rxnavStub);
    handle = toWebHandler(
      createApp().use(
        createRouter()
          .get('/api/medications', listRoute)
          .post('/api/medications', createRoute)
          .patch('/api/medications/:id', patchRoute)
          .delete('/api/medications/:id', removeRoute),
      ),
    );
  });
  beforeEach(async () => {
    vi.resetAllMocks();
    rxnavStub.product.mockImplementation(async (rxcui) =>
      rxcui === lisinopril.rxcui ? lisinopril : null,
    );
    await db.execute(sql`truncate table medications`);
  });
  afterAll(async () => {
    useRxNavClient(undefined);
    await pool.end();
  });

  it('adds a medication using RxNorm data, not client-supplied names', async () => {
    const res = await add({
      rxcui: '314076',
      notes: '  with breakfast ',
      startedOn: '2026-01-15',
      name: 'FORGED NAME',
    });
    expect(res.status).toBe(201);
    const created = await res.json();
    expect(created).toMatchObject({
      rxcui: '314076',
      name: 'lisinopril 10 MG Oral Tablet',
      strength: '10 MG',
      doseForm: 'Oral Tablet',
      ingredients: [{ rxcui: '29046', name: 'lisinopril' }],
      notes: 'with breakfast',
      startedOn: '2026-01-15',
      stoppedOn: null,
    });

    const list = await (await call('GET', '/api/medications')).json();
    expect(list).toHaveLength(1);
  });

  it('rejects a duplicate active product with 409', async () => {
    await add({ rxcui: '314076' });
    const res = await add({ rxcui: '314076' });
    expect(res.status).toBe(409);
    expect(await res.text()).toContain('already on your active list');
  });

  it('rejects an RXCUI that is not an SCD/SBD product with 422', async () => {
    expect((await add({ rxcui: '29046' })).status).toBe(422);
  });

  it('returns 503 when RxNav is down, without saving', async () => {
    rxnavStub.product.mockRejectedValue(new RxNavUnavailableError('down'));
    expect((await add({ rxcui: '314076' })).status).toBe(503);
    expect(await (await call('GET', '/api/medications')).json()).toEqual([]);
  });

  it.each([
    [{}],
    [{ rxcui: 'abc' }],
    [{ rxcui: '314076', notes: 'x'.repeat(1001) }],
    [{ rxcui: '314076', startedOn: '15/01/2026' }],
  ])('rejects invalid input %j with 400', async (body) => {
    expect((await add(body)).status).toBe(400);
  });

  it('stops, restarts and edits a medication', async () => {
    const { id } = await (await add({ rxcui: '314076', startedOn: '2026-01-15' })).json();

    const stopped = await call('PATCH', `/api/medications/${id}`, { stoppedOn: '2026-06-01' });
    expect(stopped.status).toBe(200);
    expect(await stopped.json()).toMatchObject({ stoppedOn: '2026-06-01' });

    const restarted = await call('PATCH', `/api/medications/${id}`, { stoppedOn: null });
    expect(await restarted.json()).toMatchObject({ stoppedOn: null });

    const edited = await call('PATCH', `/api/medications/${id}`, { notes: '' });
    expect(await edited.json()).toMatchObject({ notes: null });
  });

  it('sets, keeps and clears what a medication is taken for', async () => {
    const { id } = await (await add({ rxcui: '314076' })).json();
    const set = await call('PATCH', `/api/medications/${id}`, {
      takenFor: { id: 'D006973', name: 'Hypertension' },
    });
    expect(await set.json()).toMatchObject({ takenForId: 'D006973', takenForName: 'Hypertension' });

    // Other edits leave it alone.
    const edited = await call('PATCH', `/api/medications/${id}`, { notes: 'morning' });
    expect(await edited.json()).toMatchObject({ takenForId: 'D006973', notes: 'morning' });

    const cleared = await call('PATCH', `/api/medications/${id}`, { takenFor: null });
    expect(await cleared.json()).toMatchObject({ takenForId: null, takenForName: null });

    for (const takenFor of [
      { id: 'hypertension', name: 'x' },
      { id: 'D006973', name: '' },
    ]) {
      expect((await call('PATCH', `/api/medications/${id}`, { takenFor })).status).toBe(400);
    }
  });

  it('refuses a stop date before the start date', async () => {
    const { id } = await (await add({ rxcui: '314076', startedOn: '2026-01-15' })).json();
    const res = await call('PATCH', `/api/medications/${id}`, { stoppedOn: '2026-01-01' });
    expect(res.status).toBe(400);
  });

  it('returns 409 when restarting would duplicate an active product', async () => {
    const { id } = await (await add({ rxcui: '314076' })).json();
    await call('PATCH', `/api/medications/${id}`, { stoppedOn: '2026-06-01' });
    await add({ rxcui: '314076' });
    expect((await call('PATCH', `/api/medications/${id}`, { stoppedOn: null })).status).toBe(409);
  });

  it('deletes permanently and 404s afterwards', async () => {
    const { id } = await (await add({ rxcui: '314076' })).json();
    expect((await call('DELETE', `/api/medications/${id}`)).status).toBe(204);
    expect((await call('DELETE', `/api/medications/${id}`)).status).toBe(404);
    expect((await call('PATCH', `/api/medications/${id}`, { notes: 'x' })).status).toBe(404);
  });

  it('rejects a malformed id with 400', async () => {
    expect((await call('DELETE', '/api/medications/not-a-uuid')).status).toBe(400);
  });
});
