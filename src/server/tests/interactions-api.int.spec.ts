// @vitest-environment node
// Needs the test database: npm run db:test:up
import { sql } from 'drizzle-orm';
import { createApp, createRouter, toWebHandler } from 'h3';

import { createDb } from '../db/client';
import { runMigrations } from '../db/migrate';
import { ddiDrugs, ddiImports, ddiInteractions, medications } from '../db/schema';
import { OpenFdaUnavailableError, useOpenFdaClient, type OpenFdaClient } from '../openfda';
import checkRoute from '../routes/api/interactions/check.get';
import currentRoute from '../routes/api/interactions/current.get';
import evidenceRoute from '../routes/api/interactions/evidence.get';
import {
  RxNavUnavailableError,
  useRxNavClient,
  type RxNavClient,
  type RxProductDetails,
} from '../rxnorm';
import { hashPassword } from '../utils/password';

const TEST_DB =
  process.env['TEST_DATABASE_URL'] ?? 'postgres://rxplus:rxplus@localhost:5433/rxplus_test';

const product = (
  rxcui: string,
  name: string,
  ingredients: [string, string][],
): RxProductDetails => ({
  rxcui,
  name,
  tty: 'SCD',
  brandName: null,
  strength: null,
  doseForm: 'Oral Tablet',
  ingredients: ingredients.map(([r, n]) => ({ rxcui: r, name: n })),
});
const products: Record<string, RxProductDetails> = {
  '314076': product('314076', 'lisinopril 10 MG Oral Tablet', [['29046', 'lisinopril']]),
  '313096': product('313096', 'spironolactone 25 MG Oral Tablet', [['9997', 'spironolactone']]),
  '617310': product('617310', 'atorvastatin 20 MG Oral Tablet', [['83367', 'atorvastatin']]),
  '555': product('555', 'mystery 5 MG Oral Tablet', [['12345', 'mystery']]),
};

describe('interactions API (integration)', () => {
  const { db, pool } = createDb(TEST_DB);
  const rxnav = {
    search: vi.fn(),
    products: vi.fn(),
    product: vi.fn<RxNavClient['product']>(),
    ingredientByName: vi.fn(),
    classNames: vi.fn<RxNavClient['classNames']>(),
    brandNames: vi.fn<RxNavClient['brandNames']>(),
  };
  const openFda = { interactionLabel: vi.fn<OpenFdaClient['interactionLabel']>() };
  let handle: (req: Request) => Promise<Response>;
  const get = (path: string) => handle(new Request(`http://localhost${path}`));

  async function seedDdinter() {
    await db.insert(ddiDrugs).values([
      { ddinterId: 'L', name: 'Lisinopril', route: null, ingredientRxcui: '29046' },
      { ddinterId: 'S', name: 'Spironolactone', route: null, ingredientRxcui: '9997' },
      { ddinterId: 'A', name: 'Atorvastatin', route: null, ingredientRxcui: '83367' },
    ]);
    await db.insert(ddiInteractions).values([
      { drugA: 'L', drugB: 'S', level: 'Major' },
      { drugA: 'A', drugB: 'L', level: 'Unknown' },
    ]);
    await db.insert(ddiImports).values({ pairs: 2, drugs: 3, mappedDrugs: 3 });
  }
  async function addMedication(rxcui: string, stoppedOn: string | null = null) {
    const p = products[rxcui];
    await db.insert(medications).values({ ...p, notes: null, startedOn: null, stoppedOn });
  }

  beforeAll(async () => {
    process.env['DATABASE_URL'] = TEST_DB;
    process.env['APP_PASSWORD_HASH'] = await hashPassword('irrelevant-password');
    process.env['SESSION_SECRET'] = 's'.repeat(32);
    await runMigrations(TEST_DB, 'drizzle');
    useRxNavClient(rxnav);
    useOpenFdaClient(openFda);
    handle = toWebHandler(
      createApp().use(
        createRouter()
          .get('/api/interactions/check', checkRoute)
          .get('/api/interactions/current', currentRoute)
          .get('/api/interactions/evidence', evidenceRoute),
      ),
    );
  });
  beforeEach(async () => {
    vi.resetAllMocks();
    rxnav.product.mockImplementation(async (rxcui) => products[rxcui] ?? null);
    rxnav.classNames.mockResolvedValue([]);
    rxnav.brandNames.mockResolvedValue([]);
    await db.execute(sql`truncate medications, ddi_interactions, ddi_drugs, ddi_imports`);
  });
  afterAll(async () => {
    useRxNavClient(undefined);
    useOpenFdaClient(undefined);
    await db.execute(sql`truncate medications, ddi_interactions, ddi_drugs, ddi_imports`);
    await pool.end();
  });

  it('returns 409 no-data before any DDInter import', async () => {
    const res = await get('/api/interactions/current');
    expect(res.status).toBe(409);
    expect(await res.text()).toContain('no-data');
  });

  it('checks a candidate against active medications only', async () => {
    await seedDdinter();
    await addMedication('314076');
    await addMedication('617310', '2026-01-01');
    const res = await get('/api/interactions/check?rxcui=313096');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.results).toEqual([
      expect.objectContaining({
        level: 'Major',
        a: expect.objectContaining({ rxcui: '313096', ingredient: 'spironolactone' }),
        b: expect.objectContaining({ rxcui: '314076', medicationId: expect.any(String) }),
      }),
    ]);
    expect(body.source).toMatchObject({
      name: 'DDInter 2.0',
      license: 'CC BY-NC-SA 4.0',
      importedAt: expect.any(String),
    });
  });

  it('lists interactions among current medications and uncovered ingredients', async () => {
    await seedDdinter();
    await addMedication('314076');
    await addMedication('617310');
    await addMedication('555');
    const body = await (await get('/api/interactions/current')).json();
    expect(body.results.map((r: { level: string }) => r.level)).toEqual(['Unknown']);
    expect(body.notCovered).toEqual([expect.objectContaining({ ingredient: 'mystery' })]);
  });

  it('rejects non-products and maps RxNav outages', async () => {
    await seedDdinter();
    expect((await get('/api/interactions/check?rxcui=29046')).status).toBe(422);
    expect((await get('/api/interactions/check?rxcui=abc')).status).toBe(400);
    rxnav.product.mockRejectedValue(new RxNavUnavailableError('down'));
    expect((await get('/api/interactions/check?rxcui=313096')).status).toBe(503);
  });

  it('returns label evidence for a pair and 503 when openFDA is down', async () => {
    openFda.interactionLabel.mockImplementation(async (rxcui) => ({
      rxcui,
      setId: '00000000-0000-0000-0000-000000000000',
      manufacturer: 'Maker',
      effectiveDate: '2026-09-01',
      text:
        rxcui === '314076'
          ? 'Potassium-sparing diuretics (spironolactone) raise potassium.'
          : 'Nothing relevant.',
      dailyMedUrl: 'https://dailymed.nlm.nih.gov/dailymed/lookup.cfm?setid=x',
    }));
    const path = '/api/interactions/evidence?a=313096&aIngredient=9997&b=314076&bIngredient=29046';
    const evidence = await (await get(path)).json();
    expect(evidence).toHaveLength(2);
    expect(evidence[1].sentences[0]).toContain('spironolactone');

    expect(
      (
        await get(
          '/api/interactions/evidence?a=313096&aIngredient=29046&b=314076&bIngredient=29046',
        )
      ).status,
    ).toBe(400);

    // Saved medications don't need RxNav: names and ingredients come from the database.
    await addMedication('313096');
    await addMedication('314076');
    rxnav.product.mockRejectedValue(new RxNavUnavailableError('slow'));
    expect((await get(path)).status).toBe(200);

    openFda.interactionLabel.mockRejectedValue(new OpenFdaUnavailableError('down'));
    const down = await get(path);
    expect(down.status).toBe(503);
    expect(await down.text()).toContain('FDA label text is unavailable right now.');
  });
});
