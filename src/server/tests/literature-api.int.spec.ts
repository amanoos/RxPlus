// @vitest-environment node
// Needs the test database: npm run db:test:up
import { sql } from 'drizzle-orm';
import { createApp, createRouter, toWebHandler } from 'h3';

import { CtGovUnavailableError, useCtGovClient, type CtGovClient, type Trial } from '../ctgov';
import { createDb } from '../db/client';
import { runMigrations } from '../db/migrate';
import { settleLiteratureJobs } from '../literature/service';
import {
  PubMedUnavailableError,
  usePubMedClient,
  type PaperDetails,
  type PubMedClient,
} from '../pubmed';
import listRoute from '../routes/api/drugs/[rxcui]/literature/index.get';
import refreshRoute from '../routes/api/drugs/[rxcui]/literature/refresh.post';
import unhideRoute from '../routes/api/literature/[ingredient]/papers/[pmid]/hide.delete';
import hideRoute from '../routes/api/literature/[ingredient]/papers/[pmid]/hide.post';
import { useRxNavClient, type RxNavClient, type RxProductDetails } from '../rxnorm';
import { hashPassword } from '../utils/password';

const TEST_DB =
  process.env['TEST_DATABASE_URL'] ?? 'postgres://rxplus:rxplus@localhost:5433/rxplus_test';

const product = (
  rxcui: string,
  ingredients: RxProductDetails['ingredients'],
): RxProductDetails => ({
  rxcui,
  tty: 'SCD',
  name: `product ${rxcui}`,
  brandName: null,
  strength: null,
  doseForm: 'Oral Tablet',
  ingredients,
});
const PRODUCTS: Record<string, RxProductDetails> = {
  '314076': product('314076', [{ rxcui: '29046', name: 'lisinopril' }]),
  '197885': product('197885', [
    { rxcui: '5487', name: 'hydrochlorothiazide' },
    { rxcui: '29046', name: 'lisinopril' },
  ]),
};

const details = (pmid: string, studyType: PaperDetails['studyType']): PaperDetails => ({
  pmid,
  title: `Title ${pmid}`,
  journal: 'Lancet',
  year: 2020,
  pubTypes: [],
  studyType,
  doi: null,
  pmcid: pmid === '100' ? 'PMC123' : null,
});

const trial = (nctId: string): Trial => ({
  nctId,
  title: `Trial ${nctId}`,
  status: 'RECRUITING',
  phases: ['PHASE4'],
  hasResults: false,
  startDate: '2026-01',
  lastUpdate: '2026-09-01',
});

describe('literature API (integration)', () => {
  const { db, pool } = createDb(TEST_DB);
  const rxnav = { product: vi.fn<RxNavClient['product']>() };
  const pubmed = {
    searchPapers: vi.fn<PubMedClient['searchPapers']>(),
    paperDetails: vi.fn<PubMedClient['paperDetails']>(),
    abstracts: vi.fn<PubMedClient['abstracts']>(),
  };
  const ctgov = { trials: vi.fn<CtGovClient['trials']>() };
  let handle: (req: Request) => Promise<Response>;
  const call = (method: string, path: string) =>
    handle(new Request(`http://localhost${path}`, { method }));

  beforeAll(async () => {
    process.env['DATABASE_URL'] = TEST_DB;
    process.env['APP_PASSWORD_HASH'] = await hashPassword('irrelevant-password');
    process.env['SESSION_SECRET'] = 's'.repeat(32);
    await runMigrations(TEST_DB, 'drizzle');
    useRxNavClient(rxnav as unknown as RxNavClient);
    usePubMedClient(pubmed);
    useCtGovClient(ctgov);
    handle = toWebHandler(
      createApp().use(
        createRouter()
          .get('/api/drugs/:rxcui/literature', listRoute)
          .post('/api/drugs/:rxcui/literature/refresh', refreshRoute)
          .post('/api/literature/:ingredient/papers/:pmid/hide', hideRoute)
          .delete('/api/literature/:ingredient/papers/:pmid/hide', unhideRoute),
      ),
    );
  });
  beforeEach(async () => {
    vi.resetAllMocks();
    rxnav.product.mockImplementation(async (rxcui) => PRODUCTS[rxcui] ?? null);
    pubmed.searchPapers.mockImplementation(async (name) => ({
      reviews: name === 'lisinopril' ? ['100', '101', '102', '103', '104'] : ['300'],
      rcts: name === 'lisinopril' ? ['200', '201', '202', '203', '204', '205', '206', '207'] : [],
    }));
    pubmed.paperDetails.mockImplementation(async (pmids) =>
      pmids.map((p) => details(p, p.startsWith('2') ? 'rct' : 'meta-analysis')),
    );
    // 207 has no abstract: it can't be summarized, so it isn't stored.
    pubmed.abstracts.mockImplementation(
      async (pmids) =>
        new Map(pmids.filter((p) => p !== '207').map((p) => [p, `Abstract of ${p}.`])),
    );
    ctgov.trials.mockResolvedValue([trial('NCT1'), trial('NCT2')]);
    await db.execute(
      sql`truncate literature_lists, literature_papers, literature_trials, medications`,
    );
  });
  afterAll(async () => {
    useRxNavClient(undefined);
    usePubMedClient(undefined);
    useCtGovClient(undefined);
    await pool.end();
  });

  it('searches on first use and stores the lists; abstracts never reach the page', async () => {
    const res = await call('GET', '/api/drugs/314076/literature');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ingredients).toHaveLength(1);
    const lit = body.ingredients[0];
    expect(lit).toMatchObject({ rxcui: '29046', name: 'lisinopril', hidden: [] });
    expect(lit.papers.map((p: { pmid: string }) => p.pmid)).toEqual([
      '100',
      '101',
      '102',
      '103',
      '200',
      '201',
      '202',
      '203',
      '204',
      '205',
    ]);
    expect(lit.papers[0]).toEqual({
      pmid: '100',
      tier: 'review',
      studyType: 'meta-analysis',
      title: 'Title 100',
      journal: 'Lancet',
      year: 2020,
      pubmedUrl: 'https://pubmed.ncbi.nlm.nih.gov/100/',
      fullTextUrl: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC123/',
      takeaway: null,
    });
    expect(lit.trials.map((t: { url: string }) => t.url)).toEqual([
      'https://clinicaltrials.gov/study/NCT1',
      'https://clinicaltrials.gov/study/NCT2',
    ]);
    expect(lit.takeaways).toMatchObject({ status: 'none', provider: null });
    expect(JSON.stringify(body)).not.toContain('Abstract of');

    // Stored: the second visit makes no upstream calls.
    await call('GET', '/api/drugs/314076/literature');
    expect(pubmed.searchPapers).toHaveBeenCalledTimes(1);
  });

  it('shows one list per ingredient of a combination product', async () => {
    const body = await (await call('GET', '/api/drugs/197885/literature')).json();
    expect(body.ingredients.map((i: { name: string }) => i.name)).toEqual([
      'hydrochlorothiazide',
      'lisinopril',
    ]);
    expect(body.ingredients[0].papers.map((p: { pmid: string }) => p.pmid)).toEqual(['300']);
  });

  it('refreshes stale lists in the background and on request', async () => {
    await call('GET', '/api/drugs/314076/literature');
    await db.execute(sql`update literature_lists set fetched_at = now() - interval '31 days'`);
    pubmed.searchPapers.mockResolvedValue({ reviews: [], rcts: ['209'] });

    // The stale list is served as it was, while a new search runs.
    const stale = await (await call('GET', '/api/drugs/314076/literature')).json();
    expect(stale.ingredients[0].papers).toHaveLength(10);
    await settleLiteratureJobs();
    const fresh = await (await call('GET', '/api/drugs/314076/literature')).json();
    expect(fresh.ingredients[0].papers.map((p: { pmid: string }) => p.pmid)).toEqual(['209']);

    pubmed.searchPapers.mockResolvedValue({ reviews: ['100'], rcts: [] });
    const refreshed = await (await call('POST', '/api/drugs/314076/literature/refresh')).json();
    expect(refreshed.ingredients[0].papers.map((p: { pmid: string }) => p.pmid)).toEqual(['100']);
  });

  it('explains a PubMed outage when nothing is stored, and keeps trials when only they fail', async () => {
    pubmed.searchPapers.mockRejectedValue(new PubMedUnavailableError('PubMed rate limited (429)'));
    const down = await call('GET', '/api/drugs/314076/literature');
    expect(down.status).toBe(503);
    expect((await down.json()).statusMessage).toBe(
      'PubMed is unavailable right now. Try again later.',
    );

    pubmed.searchPapers.mockResolvedValue({ reviews: [], rcts: ['200'] });
    await call('GET', '/api/drugs/314076/literature');
    ctgov.trials.mockRejectedValue(new CtGovUnavailableError('ClinicalTrials.gov down'));
    const body = await (await call('POST', '/api/drugs/314076/literature/refresh')).json();
    expect(body.ingredients[0].trials).toHaveLength(2);
  });

  it('hides a paper (the next one takes its place) and shows it again', async () => {
    await call('GET', '/api/drugs/314076/literature');
    expect((await call('POST', '/api/literature/29046/papers/101/hide')).status).toBe(204);
    let lit = (await (await call('GET', '/api/drugs/314076/literature')).json()).ingredients[0];
    expect(lit.papers.map((p: { pmid: string }) => p.pmid).slice(0, 4)).toEqual([
      '100',
      '102',
      '103',
      '104',
    ]);
    expect(lit.hidden.map((p: { pmid: string }) => p.pmid)).toEqual(['101']);

    expect((await call('DELETE', '/api/literature/29046/papers/101/hide')).status).toBe(204);
    lit = (await (await call('GET', '/api/drugs/314076/literature')).json()).ingredients[0];
    expect(lit.hidden).toEqual([]);

    expect((await call('POST', '/api/literature/29046/papers/999/hide')).status).toBe(404);
    expect((await call('POST', '/api/literature/29046/papers/abc/hide')).status).toBe(400);
  });

  it('rejects non-products and bad ids', async () => {
    expect((await call('GET', '/api/drugs/29046/literature')).status).toBe(422);
    expect((await call('GET', '/api/drugs/abc/literature')).status).toBe(400);
  });
});
