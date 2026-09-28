// @vitest-environment node
// Needs the test database: npm run db:test:up
import { sql } from 'drizzle-orm';
import { createApp, createRouter, toWebHandler } from 'h3';

import { CtGovUnavailableError, useCtGovClient, type CtGovClient, type Trial } from '../ctgov';
import { createDb } from '../db/client';
import { runMigrations } from '../db/migrate';
import { ProviderUnavailableError } from '../ai/errors';
import { useTakeawayProvider } from '../literature/providers';
import { settleLiteratureJobs } from '../literature/service';
import type { TakeawayProvider } from '../literature/takeaways';
import {
  PubMedUnavailableError,
  usePubMedClient,
  type PaperDetails,
  type PubMedClient,
} from '../pubmed';
import listRoute from '../routes/api/drugs/[rxcui]/literature/index.get';
import refreshRoute from '../routes/api/drugs/[rxcui]/literature/refresh.post';
import takeawaysRoute from '../routes/api/drugs/[rxcui]/literature/takeaways.post';
import unhideRoute from '../routes/api/literature/[ingredient]/papers/[pmid]/hide.delete';
import hideRoute from '../routes/api/literature/[ingredient]/papers/[pmid]/hide.post';
import { useRxNavClient, type RxNavClient, type RxProductDetails } from '../rxnorm';
import { env } from '../utils/env';
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
    recentPapers: vi.fn<PubMedClient['recentPapers']>(),
  };
  const ctgov = {
    trials: vi.fn<CtGovClient['trials']>(),
    recentUpdates: vi.fn<CtGovClient['recentUpdates']>(),
  };
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
          .delete('/api/literature/:ingredient/papers/:pmid/hide', unhideRoute)
          .post('/api/drugs/:rxcui/literature/takeaways', takeawaysRoute),
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
        new Map(
          pmids
            .filter((p) => p !== '207')
            .map((p) => [
              p,
              `Abstract of ${p}: lisinopril reduced systolic blood pressure in adults.`,
            ]),
        ),
    );
    ctgov.trials.mockResolvedValue([trial('NCT1'), trial('NCT2')]);
    await db.execute(
      sql`truncate literature_lists, literature_papers, literature_trials, medications, drug_summaries`,
    );
  });
  afterAll(async () => {
    useTakeawayProvider(undefined);
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
      studySubject: 'review',
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

  describe('takeaways', () => {
    const generate = vi.fn<TakeawayProvider['generate']>();
    const provider = (name: TakeawayProvider['name'] = 'ollama'): TakeawayProvider => ({
      name,
      model: name === 'claude' ? 'claude-opus-5' : 'qwen2.5:7b',
      generate,
    });
    const lit = async () =>
      (await (await call('GET', '/api/drugs/314076/literature')).json()).ingredients[0];

    beforeEach(() => useTakeawayProvider({ provider: provider() }));

    it('writes takeaways for the shown papers in one background call', async () => {
      generate.mockResolvedValue({
        raw: {
          takeaways: [
            {
              pmid: '100',
              text: 'It lowered systolic pressure in adults.',
              quote: 'lisinopril reduced systolic blood pressure in adults',
            },
            { pmid: '101', text: 'It helped everyone a lot.', quote: 'made up words here' },
          ],
        },
        inputTokens: 5000,
        outputTokens: 900,
      });
      const started = await call('POST', '/api/drugs/314076/literature/takeaways');
      expect(started.status).toBe(202);
      expect((await started.json()).ingredients[0].takeaways).toMatchObject({
        status: 'pending',
        provider: 'ollama',
        model: 'qwen2.5:7b',
      });
      await settleLiteratureJobs();

      expect(generate).toHaveBeenCalledTimes(1);
      const input = generate.mock.calls[0][0];
      expect(input.map((p) => p.pmid)).toHaveLength(10);
      expect(input[0].abstract).toContain('lisinopril reduced systolic');

      const after = await lit();
      expect(after.takeaways.status).toBe('ready');
      const byPmid = Object.fromEntries(
        after.papers.map((p: { pmid: string; takeaway: unknown }) => [p.pmid, p.takeaway]),
      );
      expect(byPmid['100']).toEqual({
        text: 'It lowered systolic pressure in adults.',
        quote: 'lisinopril reduced systolic blood pressure in adults',
        uncited: false,
      });
      expect(byPmid['101']).toMatchObject({ quote: null, uncited: true });
      // Skipped by the model: marked empty so it isn't requested again and again.
      expect(byPmid['102']).toEqual({ text: '', quote: null, uncited: true });

      // Nothing left to write: no new call.
      expect((await call('POST', '/api/drugs/314076/literature/takeaways')).status).toBe(200);
      expect(generate).toHaveBeenCalledTimes(1);
    });

    it('asks only for papers that lack one, e.g. after hiding', async () => {
      generate.mockResolvedValue({ raw: { takeaways: [] } });
      await call('POST', '/api/drugs/314076/literature/takeaways');
      await settleLiteratureJobs();
      await call('POST', '/api/literature/29046/papers/100/hide');
      await call('POST', '/api/drugs/314076/literature/takeaways');
      await settleLiteratureJobs();
      expect(generate.mock.calls[1][0].map((p) => p.pmid)).toEqual(['104']);
    });

    it('runs one job at a time, records failures and retries', async () => {
      let finish!: () => void;
      generate.mockReturnValueOnce(
        new Promise((resolve) => (finish = () => resolve({ raw: { takeaways: [] } }))),
      );
      await call('POST', '/api/drugs/314076/literature/takeaways');
      expect((await call('POST', '/api/drugs/314076/literature/takeaways')).status).toBe(202);
      expect(generate).toHaveBeenCalledTimes(1);
      finish();
      await settleLiteratureJobs();

      await db.execute(sql`update literature_papers set takeaway = null`);
      generate.mockRejectedValueOnce(new ProviderUnavailableError('Ollama timed out after 600s.'));
      await call('POST', '/api/drugs/314076/literature/takeaways');
      await settleLiteratureJobs();
      expect((await lit()).takeaways).toMatchObject({
        status: 'failed',
        error: 'Ollama timed out after 600s.',
      });

      generate.mockResolvedValueOnce({ raw: { takeaways: [] } });
      expect((await call('POST', '/api/drugs/314076/literature/takeaways')).status).toBe(202);
      await settleLiteratureJobs();
      expect((await lit()).takeaways.status).toBe('ready');
    });

    it('shares the Claude daily limit with summaries', async () => {
      useTakeawayProvider({ provider: provider('claude') });
      const limit = env().AI_DAILY_LIMIT;
      for (let i = 0; i < limit; i++) {
        await db.execute(sql`
          insert into drug_summaries (rxcui, label_set_id, label_version, status, provider, model)
          values (${String(i)}, 's', '1', 'ready', 'claude', 'claude-opus-5')`);
      }
      const res = await call('POST', '/api/drugs/314076/literature/takeaways');
      expect(res.status).toBe(429);
      expect((await res.json()).statusMessage).toContain(`daily limit of ${limit} Claude requests`);
      expect(generate).not.toHaveBeenCalled();
    });

    it('checks that each linked quote supports its takeaway, without failing on a bad check', async () => {
      const takeaways = {
        raw: {
          takeaways: [
            {
              pmid: '100',
              text: 'It lowered systolic pressure in adults.',
              quote: 'lisinopril reduced systolic blood pressure in adults',
            },
            {
              pmid: '101',
              text: 'It lowered systolic pressure by half.',
              quote: 'lisinopril reduced systolic blood pressure in adults',
            },
            { pmid: '102', text: 'Unlinked.', quote: 'not in the abstract' },
          ],
        },
      };
      const checkSupport = vi.fn<NonNullable<TakeawayProvider['checkSupport']>>();
      useTakeawayProvider({ provider: { ...provider(), checkSupport } });
      generate.mockResolvedValue(takeaways);
      checkSupport.mockResolvedValue(
        new Map([
          ['100', true],
          ['101', false],
        ]),
      );
      await call('POST', '/api/drugs/314076/literature/takeaways');
      await settleLiteratureJobs();

      // Only linked takeaways are checked.
      expect(checkSupport.mock.calls[0][0].map((i) => i.pmid)).toEqual(['100', '101']);
      const byPmid = Object.fromEntries(
        (await lit()).papers.map((p: { pmid: string; takeaway: unknown }) => [p.pmid, p.takeaway]),
      );
      expect(byPmid['100']).toMatchObject({ uncited: false, supported: true });
      expect(byPmid['101']).toMatchObject({
        uncited: false,
        supported: false,
        quote: 'lisinopril reduced systolic blood pressure in adults',
      });
      expect(byPmid['102']).toMatchObject({ uncited: true });
      expect(byPmid['102'].supported).toBeUndefined();

      // A failing check still stores the takeaways, unchecked.
      await db.execute(sql`update literature_papers set takeaway = null`);
      checkSupport.mockRejectedValue(new ProviderUnavailableError('Ollama timed out.'));
      await call('POST', '/api/drugs/314076/literature/takeaways');
      await settleLiteratureJobs();
      const after = await lit();
      expect(after.takeaways.status).toBe('ready');
      expect(after.papers.find((p: { pmid: string }) => p.pmid === '100').takeaway).toMatchObject({
        uncited: false,
        supported: null,
      });
    });

    it('explains a missing provider', async () => {
      useTakeawayProvider({ unavailable: 'No local model configured (OLLAMA_MODEL).' });
      const res = await call('POST', '/api/drugs/314076/literature/takeaways');
      expect(res.status).toBe(503);
      expect((await res.json()).statusMessage).toBe(
        'AI takeaways unavailable: No local model configured (OLLAMA_MODEL).',
      );
    });
  });
});
