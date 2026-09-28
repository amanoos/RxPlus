// @vitest-environment node
// Needs the test database: npm run db:test:up
import { sql } from 'drizzle-orm';
import { createApp, createRouter, toWebHandler } from 'h3';

import { settleAlternativeJobs } from '../alternatives/builder';
import { createDb } from '../db/client';
import { runMigrations } from '../db/migrate';
import { medications } from '../db/schema';
import { useOpenFdaClient, type OpenFdaClient } from '../openfda';
import unhideRoute from '../routes/api/alternatives/[ingredient]/hidden/[rxcui].delete';
import hideRoute from '../routes/api/alternatives/[ingredient]/hidden/[rxcui].post';
import listRoute from '../routes/api/drugs/[rxcui]/alternatives/index.get';
import refreshRoute from '../routes/api/drugs/[rxcui]/alternatives/refresh.post';
import { useRxNavClient, type RxNavClient, type RxProductDetails } from '../rxnorm';
import type { RxConcept } from '../rxnorm/client';
import { hashPassword } from '../utils/password';

const TEST_DB =
  process.env['TEST_DATABASE_URL'] ?? 'postgres://rxplus:rxplus@localhost:5433/rxplus_test';

const LISINOPRIL: RxProductDetails = {
  rxcui: '314076',
  tty: 'SCD',
  name: 'lisinopril 10 MG Oral Tablet',
  brandName: null,
  strength: '10 MG',
  doseForm: 'Oral Tablet',
  ingredients: [{ rxcui: '29046', name: 'lisinopril' }],
};
const IN = (rxcui: string, name: string): RxConcept => ({ rxcui, name, tty: 'IN' });
const ACE = { id: 'N0000175562', name: 'Angiotensin Converting Enzyme Inhibitor' };
const CLASSES: Record<string, { id: string; name: string }> = {
  '29046': ACE,
  '3827': ACE,
  '52175': { id: 'N0000175561', name: 'Angiotensin 2 Receptor Blocker' },
  '2679059': { id: 'N0000191266', name: 'Endothelin Receptor Antagonist' },
};

describe('alternatives API (integration)', () => {
  const { db, pool } = createDb(TEST_DB);
  const rxnav = {
    product: vi.fn(async (rxcui: string) => (rxcui === '314076' ? LISINOPRIL : null)),
    drugFacts: vi.fn(async () => ({
      epcClasses: [ACE.name],
      atcClasses: [],
      mayTreat: ['Heart Failure', 'Hypertension'],
      mayPrevent: [],
      avoidWith: [],
      uses: [
        { id: 'D006333', name: 'Heart Failure' },
        { id: 'D006973', name: 'Hypertension' },
      ],
    })),
    epcClasses: vi.fn(async (rxcui: string) => (CLASSES[rxcui] ? [CLASSES[rxcui]] : [])),
    classMembers: vi.fn(async () => [IN('29046', 'lisinopril'), IN('3827', 'enalapril')]),
    diseaseMembers: vi.fn(async (id: string) =>
      id === 'D006973'
        ? [
            IN('29046', 'lisinopril'),
            IN('3827', 'enalapril'),
            IN('52175', 'losartan'),
            IN('2679059', 'aprocitentan'),
          ]
        : [],
    ),
    diseaseDescendants: vi.fn(async () => []),
    toIngredient: vi.fn(async () => null),
    usProduct: vi.fn(async (rxcui: string) => ({ rxcui: `p${rxcui}`, name: `product ${rxcui}` })),
  };
  const openFda = {
    approvalFacts: vi.fn(async (name: string) =>
      name === 'aprocitentan'
        ? { firstApproved: '2024-03-19', genericAvailable: false }
        : { firstApproved: '1990-01-01', genericAvailable: true },
    ),
    indications: vi.fn(async () => []),
  };
  let handle: (req: Request) => Promise<Response>;
  const call = (method: string, path: string) =>
    handle(new Request(`http://localhost${path}`, { method }));
  const names = (drugs: { name: string }[]) => drugs.map((d) => d.name);

  beforeAll(async () => {
    process.env['DATABASE_URL'] = TEST_DB;
    process.env['APP_PASSWORD_HASH'] = await hashPassword('irrelevant-password');
    process.env['SESSION_SECRET'] = 's'.repeat(32);
    await runMigrations(TEST_DB, 'drizzle');
    useRxNavClient(rxnav as unknown as RxNavClient);
    useOpenFdaClient(openFda as unknown as OpenFdaClient);
    handle = toWebHandler(
      createApp().use(
        createRouter()
          .get('/api/drugs/:rxcui/alternatives', listRoute)
          .post('/api/drugs/:rxcui/alternatives/refresh', refreshRoute)
          .post('/api/alternatives/:ingredient/hidden/:rxcui', hideRoute)
          .delete('/api/alternatives/:ingredient/hidden/:rxcui', unhideRoute),
      ),
    );
  });
  beforeEach(async () => {
    vi.clearAllMocks();
    await db.execute(
      sql`truncate alternative_lists, alternative_drugs, alternative_hidden, medications`,
    );
  });
  afterAll(async () => {
    useRxNavClient(undefined);
    useOpenFdaClient(undefined);
    await pool.end();
  });

  it('builds the same-class list on first visit and asks for the condition', async () => {
    const first = await (await call('GET', '/api/drugs/314076/alternatives')).json();
    expect(first).toMatchObject({
      uses: [
        { id: 'D006333', name: 'Heart Failure' },
        { id: 'D006973', name: 'Hypertension' },
      ],
      condition: null,
      conditionSource: null,
      medicationId: null,
    });
    expect(first.ingredients[0]).toMatchObject({
      rxcui: '29046',
      drugClass: ACE,
      classList: { status: 'pending' },
      conditionList: null,
    });

    await settleAlternativeJobs();
    const ready = (await (await call('GET', '/api/drugs/314076/alternatives')).json())
      .ingredients[0];
    expect(ready.classList).toMatchObject({ status: 'ready', skipped: 0 });
    expect(names(ready.groups.sameClass)).toEqual(['enalapril']);
    expect(ready.groups.sameClass[0]).toMatchObject({
      approvedYear: 1990,
      genericAvailable: true,
      productRxcui: 'p3827',
    });
    expect(ready.groups.otherClasses).toEqual([]);
  });

  it('shows new drugs and other classes for a condition chosen on the page', async () => {
    await call('GET', '/api/drugs/314076/alternatives?condition=D006973');
    await settleAlternativeJobs();
    const body = await (
      await call('GET', '/api/drugs/314076/alternatives?condition=D006973')
    ).json();
    expect(body).toMatchObject({
      condition: { id: 'D006973', name: 'Hypertension' },
      conditionSource: 'visit',
    });
    const { groups } = body.ingredients[0];
    expect(names(groups.newForCondition)).toEqual(['aprocitentan']);
    expect(groups.otherClasses.map((c: { className: string }) => c.className)).toEqual([
      'Angiotensin 2 Receptor Blocker',
      'Endothelin Receptor Antagonist',
    ]);
    expect(names(groups.sameClass)).toEqual(['enalapril']);
  });

  it('uses what the saved medication is taken for', async () => {
    const [med] = await db
      .insert(medications)
      .values({
        ...LISINOPRIL,
        notes: null,
        startedOn: null,
        takenForId: 'D006973',
        takenForName: 'Hypertension',
      })
      .returning();
    const body = await (await call('GET', '/api/drugs/314076/alternatives')).json();
    expect(body).toMatchObject({
      condition: { id: 'D006973', name: 'Hypertension' },
      conditionSource: 'medication',
      medicationId: med.id,
    });
    await settleAlternativeJobs();
  });

  it('rejects unknown conditions, bad ids and non-products', async () => {
    expect((await call('GET', '/api/drugs/314076/alternatives?condition=D009999')).status).toBe(
      400,
    );
    expect(
      (await call('GET', '/api/drugs/314076/alternatives?condition=hypertension')).status,
    ).toBe(400);
    expect((await call('GET', '/api/drugs/29046/alternatives')).status).toBe(422);
    await settleAlternativeJobs();
  });

  it('hides an alternative for this drug and shows it again', async () => {
    await call('GET', '/api/drugs/314076/alternatives');
    await settleAlternativeJobs();
    expect((await call('POST', '/api/alternatives/29046/hidden/3827')).status).toBe(204);
    let lit = (await (await call('GET', '/api/drugs/314076/alternatives')).json()).ingredients[0];
    expect(lit.groups.sameClass).toEqual([]);
    expect(names(lit.groups.hidden)).toEqual(['enalapril']);

    expect((await call('DELETE', '/api/alternatives/29046/hidden/3827')).status).toBe(204);
    lit = (await (await call('GET', '/api/drugs/314076/alternatives')).json()).ingredients[0];
    expect(names(lit.groups.sameClass)).toEqual(['enalapril']);
    expect((await call('POST', '/api/alternatives/abc/hidden/3827')).status).toBe(400);
  });

  it('rebuilds on "check for new approvals", keeping the old drugs visible meanwhile', async () => {
    await call('GET', '/api/drugs/314076/alternatives');
    await settleAlternativeJobs();
    const calls = rxnav.classMembers.mock.calls.length;

    const refreshed = await call('POST', '/api/drugs/314076/alternatives/refresh');
    expect(refreshed.status).toBe(202);
    const body = (await refreshed.json()).ingredients[0];
    expect(body.classList.status).toBe('pending');
    expect(names(body.groups.sameClass)).toEqual(['enalapril']);
    await settleAlternativeJobs();
    expect(rxnav.classMembers.mock.calls.length).toBeGreaterThan(calls);
  });
});
