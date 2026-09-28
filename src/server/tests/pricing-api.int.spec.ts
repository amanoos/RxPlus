// @vitest-environment node
// Needs the test database: npm run db:test:up
import { sql } from 'drizzle-orm';
import { createApp, createRouter, toWebHandler } from 'h3';

import { useCostPlusClient, CostPlusUnavailableError, type CostPlusClient } from '../costplus';
import { createDb } from '../db/client';
import { runMigrations } from '../db/migrate';
import { createMedicationsRepository } from '../medications/repository';
import costsRoute from '../routes/api/costs.get';
import pricesRoute from '../routes/api/drugs/[rxcui]/prices.get';
import { useRxNavClient, type RxNavClient, type RxProductDetails } from '../rxnorm';
import { hashPassword } from '../utils/password';

const TEST_DB =
  process.env['TEST_DATABASE_URL'] ?? 'postgres://rxplus:rxplus@localhost:5433/rxplus_test';

const product = (rxcui: string, name: string, ingredient: string): RxProductDetails => ({
  rxcui,
  tty: 'SCD',
  name,
  brandName: null,
  strength: null,
  doseForm: 'Oral Tablet',
  ingredients: [{ rxcui: `i${rxcui}`, name: ingredient }],
});
const PRODUCTS: Record<string, RxProductDetails> = {
  '314076': product('314076', 'lisinopril 10 MG Oral Tablet', 'lisinopril'),
  '617310': product('617310', 'atorvastatin 20 MG Oral Tablet', 'atorvastatin'),
  '1364430': product('1364430', 'apixaban 5 MG Oral Tablet', 'apixaban'),
};
const NDCS: Record<string, string[]> = {
  '314076': ['00093111310', '68180098003'],
  '617310': ['67877051210'],
  '1364430': ['00003089421'],
};
const item = (ndc: string, strength: string, unitBillingPrice: number) => ({
  ndc,
  strength,
  form: 'Tablet',
  brandGeneric: 'Generic',
  unitPrice: unitBillingPrice,
  unitBillingPrice,
  url: `https://www.costplusdrugs.com/medications/${ndc}/`,
});
const SOLD: Record<string, ReturnType<typeof item>[]> = {
  // A different strength's NDC must not match.
  lisinopril: [item('68180098103', '20mg', 0.0187), item('68180098003', '10mg', 0.0131)],
  atorvastatin: [item('67877051210', '20mg', 0.0139)],
};
const FETCHED = Date.parse('2026-09-28T13:14:00Z');

describe('pricing API (integration)', () => {
  const { db, pool } = createDb(TEST_DB);
  const meds = createMedicationsRepository(db);
  const rxnav = {
    product: vi.fn(async (rxcui: string) => PRODUCTS[rxcui] ?? null),
    ndcs: vi.fn(async (rxcui: string) => NDCS[rxcui] ?? []),
  };
  const costPlus = {
    lookup: vi.fn<CostPlusClient['lookup']>(async (name) => ({
      items: SOLD[name] ?? [],
      fetchedAt: FETCHED,
    })),
  };
  let handle: (req: Request) => Promise<Response>;
  const get = (path: string) => handle(new Request(`http://localhost${path}`));
  const add = async (rxcui: string, changes: Parameters<typeof meds.update>[1] = {}) => {
    const p = PRODUCTS[rxcui];
    const med = await meds.create({
      rxcui,
      tty: 'SCD',
      name: p.name,
      strength: null,
      doseForm: 'Oral Tablet',
      brandName: null,
      ingredients: p.ingredients,
      notes: null,
      startedOn: null,
    });
    return meds.update(med.id, changes);
  };

  beforeAll(async () => {
    process.env['DATABASE_URL'] = TEST_DB;
    process.env['APP_PASSWORD_HASH'] = await hashPassword('irrelevant-password');
    process.env['SESSION_SECRET'] = 's'.repeat(32);
    await runMigrations(TEST_DB, 'drizzle');
    useRxNavClient(rxnav as unknown as RxNavClient);
    useCostPlusClient(costPlus);
    handle = toWebHandler(
      createApp().use(
        createRouter().get('/api/drugs/:rxcui/prices', pricesRoute).get('/api/costs', costsRoute),
      ),
    );
  });
  beforeEach(async () => {
    vi.clearAllMocks();
    await db.execute(sql`truncate medications`);
  });
  afterAll(async () => {
    useRxNavClient(undefined);
    useCostPlusClient(undefined);
    await pool.end();
  });

  it('prices a product by its NDC, with 30 a month when it is not on the list', async () => {
    const res = await get('/api/drugs/314076/prices');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      rxcui: '314076',
      status: 'found',
      price: {
        unitPrice: 0.0131,
        strength: '10mg',
        form: 'Tablet',
        url: 'https://www.costplusdrugs.com/medications/68180098003/',
      },
      asOf: '2026-09-28T13:14:00.000Z',
      medication: null,
      defaultMonthlyCents: 39,
    });
    expect(costPlus.lookup).toHaveBeenCalledWith('lisinopril');
  });

  it('adds the owner’s figures for a medication on the list', async () => {
    const med = await add('314076', { unitsPerMonth: 30, copayCents: 1000, copayUnits: 90 });
    const body = await (await get('/api/drugs/314076/prices')).json();
    expect(body.medication).toEqual({
      medicationId: med!.id,
      unitsPerMonth: 30,
      copayCents: 1000,
      copayUnits: 90,
      cashCents: 39,
      insuredCents: 333,
      cheaper: 'cash',
      savingsCents: 294,
    });
  });

  it('says when Cost Plus does not sell the product, and 404s an unknown one', async () => {
    const body = await (await get('/api/drugs/1364430/prices')).json();
    expect(body).toMatchObject({ status: 'not-sold', price: null, defaultMonthlyCents: null });
    expect((await get('/api/drugs/999/prices')).status).toBe(404);
    expect((await get('/api/drugs/abc/prices')).status).toBe(400);
  });

  it('answers 503 when Cost Plus is unreachable', async () => {
    costPlus.lookup.mockRejectedValueOnce(new CostPlusUnavailableError('Cost Plus Drugs down'));
    const res = await get('/api/drugs/314076/prices');
    expect(res.status).toBe(503);
  });

  it('lists active medications with monthly figures and totals', async () => {
    // A stopped medication is left out.
    await add('617310', { stoppedOn: '2026-01-01' });
    await add('314076', { copayCents: 1000, copayUnits: 90 });
    await add('617310', { unitsPerMonth: 30, copayCents: 500, copayUnits: 30 });
    await add('1364430', { copayCents: 4700, copayUnits: 30 });

    const { rows, totals } = await (await get('/api/costs')).json();
    expect(
      rows.map((r: { name: string; status: string; cashCents: number | null }) => [
        r.name,
        r.status,
        r.cashCents,
      ]),
    ).toEqual([
      ['apixaban 5 MG Oral Tablet', 'not-sold', null],
      ['atorvastatin 20 MG Oral Tablet', 'found', 42],
      ['lisinopril 10 MG Oral Tablet', 'found', 39],
    ]);
    expect(totals).toEqual({
      cashCents: 81,
      insuredCents: 333 + 500 + 4700,
      medications: 3,
      missingPrice: 1,
      missingCopay: 0,
    });
  });

  it('marks a row unavailable when its lookup fails, and keeps the others', async () => {
    await add('314076');
    await add('617310');
    costPlus.lookup.mockImplementation(async (name) => {
      if (name === 'atorvastatin') throw new CostPlusUnavailableError('Cost Plus Drugs down');
      return { items: SOLD[name] ?? [], fetchedAt: FETCHED };
    });
    const { rows, totals } = await (await get('/api/costs')).json();
    expect(rows.map((r: { status: string }) => r.status).sort()).toEqual(['found', 'unavailable']);
    expect(totals).toMatchObject({ missingPrice: 1, missingCopay: 2 });
  });
});
