// @vitest-environment node
// Needs the test database: npm run db:test:up
import { sql } from 'drizzle-orm';
import { createApp, createRouter, toWebHandler } from 'h3';

import { createDb } from '../db/client';
import { runMigrations } from '../db/migrate';
import { medications } from '../db/schema';
import { useMedlinePlusClient, type MedlinePlusClient } from '../medlineplus';
import { OpenFdaUnavailableError, useOpenFdaClient, type OpenFdaClient } from '../openfda';
import factsRoute from '../routes/api/drugs/[rxcui]/index.get';
import reactionsRoute from '../routes/api/drugs/[rxcui]/reported-reactions.get';
import {
  RxNavUnavailableError,
  useRxNavClient,
  type RxNavClient,
  type RxProductDetails,
} from '../rxnorm';
import { hashPassword } from '../utils/password';

const TEST_DB =
  process.env['TEST_DATABASE_URL'] ?? 'postgres://rxplus:rxplus@localhost:5433/rxplus_test';

const zestoretic: RxProductDetails = {
  rxcui: '197885',
  tty: 'SCD',
  name: 'hydrochlorothiazide 12.5 MG / lisinopril 10 MG Oral Tablet',
  brandName: null,
  strength: '12.5 MG / 10 MG',
  doseForm: 'Oral Tablet',
  ingredients: [
    { rxcui: '5487', name: 'hydrochlorothiazide' },
    { rxcui: '29046', name: 'lisinopril' },
  ],
};

describe('drug-info API (integration)', () => {
  const { db, pool } = createDb(TEST_DB);
  const rxnav = {
    search: vi.fn(),
    products: vi.fn(),
    product: vi.fn<RxNavClient['product']>(),
    ingredientByName: vi.fn(),
    classNames: vi.fn(),
    brandNames: vi.fn(),
    drugFacts: vi.fn<RxNavClient['drugFacts']>(),
    epcClasses: vi.fn<RxNavClient['epcClasses']>(),
    classMembers: vi.fn<RxNavClient['classMembers']>(),
    diseaseMembers: vi.fn<RxNavClient['diseaseMembers']>(),
    diseaseDescendants: vi.fn<RxNavClient['diseaseDescendants']>(),
    toIngredient: vi.fn<RxNavClient['toIngredient']>(),
    usProduct: vi.fn<RxNavClient['usProduct']>(),
    ndcs: vi.fn<RxNavClient['ndcs']>(),
  };
  const openFda = {
    interactionLabel: vi.fn(),
    summaryLabel: vi.fn<OpenFdaClient['summaryLabel']>(),
    reportedReactions: vi.fn<OpenFdaClient['reportedReactions']>(),
    approvalFacts: vi.fn(),
    indications: vi.fn(),
  };
  const medline = { drugPage: vi.fn<MedlinePlusClient['drugPage']>() };
  let handle: (req: Request) => Promise<Response>;
  const get = (path: string) => handle(new Request(`http://localhost${path}`));

  beforeAll(async () => {
    process.env['DATABASE_URL'] = TEST_DB;
    process.env['APP_PASSWORD_HASH'] = await hashPassword('irrelevant-password');
    process.env['SESSION_SECRET'] = 's'.repeat(32);
    await runMigrations(TEST_DB, 'drizzle');
    useRxNavClient(rxnav as unknown as RxNavClient);
    useOpenFdaClient(openFda as unknown as OpenFdaClient);
    useMedlinePlusClient(medline);
    handle = toWebHandler(
      createApp().use(
        createRouter()
          .get('/api/drugs/:rxcui', factsRoute)
          .get('/api/drugs/:rxcui/reported-reactions', reactionsRoute),
      ),
    );
  });
  beforeEach(async () => {
    vi.resetAllMocks();
    rxnav.product.mockImplementation(async (rxcui) => (rxcui === '197885' ? zestoretic : null));
    rxnav.drugFacts.mockImplementation(async (ing) =>
      ing === '29046'
        ? {
            epcClasses: ['Angiotensin Converting Enzyme Inhibitor'],
            atcClasses: [],
            mayTreat: ['Heart Failure', 'Hypertension'],
            mayPrevent: [],
            avoidWith: ['Angioedema'],
            uses: [
              { id: 'D006333', name: 'Heart Failure' },
              { id: 'D006973', name: 'Hypertension' },
            ],
          }
        : {
            epcClasses: ['Thiazide Diuretic'],
            atcClasses: [],
            mayTreat: ['Edema', 'Hypertension'],
            mayPrevent: [],
            avoidWith: ['Anuria'],
            uses: [
              { id: 'D004487', name: 'Edema' },
              { id: 'D006973', name: 'Hypertension' },
            ],
          },
    );
    openFda.summaryLabel.mockResolvedValue({
      rxcui: '197885',
      setId: '00000000-0000-0000-0000-000000000001',
      version: '3',
      manufacturer: 'Maker',
      effectiveDate: '2026-09-01',
      dailyMedUrl: 'https://dailymed.nlm.nih.gov/dailymed/lookup.cfm?setid=x',
      sections: [{ name: 'indications_and_usage', text: 'secret section text' }],
    });
    medline.drugPage.mockImplementation(async (ing) =>
      ing === '29046'
        ? { title: 'Lisinopril', url: 'https://medlineplus.gov/druginfo/meds/a692051.html' }
        : null,
    );
    await db.execute(sql`truncate medications`);
  });
  afterAll(async () => {
    useRxNavClient(undefined);
    useOpenFdaClient(undefined);
    useMedlinePlusClient(undefined);
    await pool.end();
  });

  it('merges facts for every ingredient, with the label reference and MedlinePlus links', async () => {
    const res = await get('/api/drugs/197885');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      rxcui: '197885',
      name: zestoretic.name,
      epcClasses: ['Angiotensin Converting Enzyme Inhibitor', 'Thiazide Diuretic'],
      mayTreat: ['Edema', 'Heart Failure', 'Hypertension'],
      avoidWith: ['Angioedema', 'Anuria'],
      uses: [
        { id: 'D004487', name: 'Edema' },
        { id: 'D006333', name: 'Heart Failure' },
        { id: 'D006973', name: 'Hypertension' },
      ],
      label: {
        setId: '00000000-0000-0000-0000-000000000001',
        version: '3',
        effectiveDate: '2026-09-01',
      },
      medlinePlus: [
        {
          ingredient: 'lisinopril',
          title: 'Lisinopril',
          url: expect.stringContaining('medlineplus.gov'),
        },
      ],
      unavailable: [],
    });
    // The page gets the label reference, never the label text itself.
    expect(JSON.stringify(body)).not.toContain('secret section text');
  });

  it('uses a saved medication without calling RxNav for the product', async () => {
    await db.insert(medications).values({ ...zestoretic, notes: null, startedOn: null });
    rxnav.product.mockRejectedValue(new RxNavUnavailableError('slow'));
    expect((await get('/api/drugs/197885')).status).toBe(200);
  });

  it('still answers when optional sources are down, and says which', async () => {
    rxnav.drugFacts.mockRejectedValue(new RxNavUnavailableError('slow'));
    openFda.summaryLabel.mockRejectedValue(new OpenFdaUnavailableError('down'));
    const body = await (await get('/api/drugs/197885')).json();
    expect(body.label).toBeNull();
    expect(body.unavailable).toEqual(expect.arrayContaining(['RxClass', 'FDA label']));
  });

  it('rejects non-products, bad ids and product lookup outages', async () => {
    expect((await get('/api/drugs/29046')).status).toBe(422);
    expect((await get('/api/drugs/abc')).status).toBe(400);
    rxnav.product.mockRejectedValue(new RxNavUnavailableError('down'));
    expect((await get('/api/drugs/197885')).status).toBe(503);
  });

  it('returns FAERS counts per ingredient with the disclaimer', async () => {
    openFda.reportedReactions.mockImplementation(async (ingredient) => ({
      total: ingredient === 'lisinopril' ? 304318 : 5000,
      reactions: [{ term: 'COUGH', count: 100 }],
    }));
    const body = await (await get('/api/drugs/197885/reported-reactions')).json();
    expect(body.ingredients.map((i: { ingredient: string }) => i.ingredient)).toEqual([
      'hydrochlorothiazide',
      'lisinopril',
    ]);
    expect(body.ingredients[1]).toMatchObject({ total: 304318 });
    expect(body.disclaimer).toContain('A report doesn’t prove the drug caused the reaction');
  });

  it('returns 503 for FAERS when openFDA is down', async () => {
    openFda.reportedReactions.mockRejectedValue(new OpenFdaUnavailableError('down'));
    expect((await get('/api/drugs/197885/reported-reactions')).status).toBe(503);
  });
});
