// @vitest-environment node
// Needs the test database: npm run db:test:up
import { sql } from 'drizzle-orm';
import { createApp, createRouter, toWebHandler } from 'h3';

import { useCtGovClient, type CtGovClient } from '../ctgov';
import { createDb } from '../db/client';
import { runMigrations } from '../db/migrate';
import { settleDigestJobs } from '../digest/run';
import { resetDigestRunner } from '../digest/service';
import { useTakeawayProvider } from '../literature/providers';
import { createMedicationsRepository } from '../medications/repository';
import { useOpenFdaClient, type OpenFdaClient } from '../openfda';
import { usePubMedClient, type PubMedClient } from '../pubmed';
import readRoute from '../routes/api/digests/[id]/read.post';
import listRoute from '../routes/api/digests/index.get';
import runRoute from '../routes/api/digests/run.post';
import unreadRoute from '../routes/api/digests/unread-count.get';
import { hashPassword } from '../utils/password';

const TEST_DB =
  process.env['TEST_DATABASE_URL'] ?? 'postgres://rxplus:rxplus@localhost:5433/rxplus_test';

describe('digest API (integration)', () => {
  const { db, pool } = createDb(TEST_DB);
  let gate: Promise<void> | null = null;
  const pubmed = {
    searchPapers: vi.fn<PubMedClient['searchPapers']>(),
    recentPapers: vi.fn<PubMedClient['recentPapers']>(async () => {
      await gate;
      return { pmids: ['101'], total: 3, searchUrl: 'https://pubmed.ncbi.nlm.nih.gov/?term=x' };
    }),
    paperDetails: vi.fn<PubMedClient['paperDetails']>(async (ids) =>
      ids.map((pmid) => ({
        pmid,
        title: `Paper ${pmid}`,
        journal: 'Hypertension',
        year: 2026,
        pubTypes: [],
        studyType: 'other' as const,
        doi: null,
        pmcid: null,
      })),
    ),
    abstracts: vi.fn<PubMedClient['abstracts']>(async () => new Map()),
  };
  const ctgov = {
    trials: vi.fn<CtGovClient['trials']>(),
    recentUpdates: vi.fn<CtGovClient['recentUpdates']>(async () => []),
  };
  const openFda = { summaryLabel: vi.fn(async () => null) };
  let handle: (req: Request) => Promise<Response>;
  const call = (method: string, path: string) =>
    handle(new Request(`http://localhost${path}`, { method }));

  beforeAll(async () => {
    process.env['DATABASE_URL'] = TEST_DB;
    process.env['APP_PASSWORD_HASH'] = await hashPassword('irrelevant-password');
    process.env['SESSION_SECRET'] = 's'.repeat(32);
    await runMigrations(TEST_DB, 'drizzle');
    usePubMedClient(pubmed);
    useCtGovClient(ctgov);
    useOpenFdaClient(openFda as unknown as OpenFdaClient);
    useTakeawayProvider({ unavailable: 'No local model configured (OLLAMA_MODEL).' });
    resetDigestRunner();
    handle = toWebHandler(
      createApp().use(
        createRouter()
          .get('/api/digests', listRoute)
          .get('/api/digests/unread-count', unreadRoute)
          .post('/api/digests/run', runRoute)
          .post('/api/digests/:id/read', readRoute),
      ),
    );
  });
  beforeEach(async () => {
    gate = null;
    await db.execute(sql`truncate digests, digest_items, digest_label_versions, medications`);
  });
  afterAll(async () => {
    usePubMedClient(undefined);
    useCtGovClient(undefined);
    useOpenFdaClient(undefined);
    useTakeawayProvider(undefined);
    resetDigestRunner();
    await settleDigestJobs();
    // The e2e server shares this database: leave no running digest for its startup to resume.
    await db.execute(sql`truncate digests, digest_items, digest_label_versions, medications`);
    await pool.end();
  });

  const addLisinopril = () =>
    createMedicationsRepository(db).create({
      rxcui: '314076',
      tty: 'SCD',
      name: 'lisinopril 10 MG Oral Tablet',
      strength: '10 MG',
      doseForm: 'Oral Tablet',
      brandName: null,
      ingredients: [{ rxcui: '29046', name: 'lisinopril' }],
      notes: null,
      startedOn: null,
    });

  it('lists nothing before the first run, with the next scheduled time', async () => {
    const res = await call('GET', '/api/digests');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ digests: [], running: null, hasActiveMedications: false });
    expect(new Date(body.nextRun).getTime()).toBeGreaterThan(Date.now());
    expect(await (await call('GET', '/api/digests/unread-count')).json()).toEqual({ count: 0 });
  });

  it('runs now in the background, one at a time, then lists the digest grouped by drug', async () => {
    await addLisinopril();
    let release = () => undefined as void;
    gate = new Promise<void>((resolve) => (release = resolve));

    const started = await call('POST', '/api/digests/run');
    expect(started.status).toBe(202);
    const running = await started.json();
    expect(running).toMatchObject({ trigger: 'manual' });

    expect((await call('POST', '/api/digests/run')).status).toBe(409);
    const during = await (await call('GET', '/api/digests')).json();
    expect(during).toMatchObject({ running: { id: running.id }, digests: [] });

    release();
    await settleDigestJobs();
    const after = await (await call('GET', '/api/digests')).json();
    expect(after.running).toBeNull();
    expect(after.hasActiveMedications).toBe(true);
    expect(after.digests).toHaveLength(1);
    expect(after.digests[0]).toMatchObject({
      id: running.id,
      status: 'ready',
      itemCount: 2,
      unread: 2,
      notes: [],
      groups: [
        {
          subject: 'lisinopril',
          items: [
            { kind: 'paper', title: 'Paper 101', read: false, takeaway: null },
            { kind: 'more-papers', title: '2 more new papers on PubMed' },
          ],
        },
      ],
    });
    expect(await (await call('GET', '/api/digests/unread-count')).json()).toEqual({ count: 2 });
  });

  it('marks a digest read', async () => {
    await addLisinopril();
    const { id } = await (await call('POST', '/api/digests/run')).json();
    await settleDigestJobs();

    expect((await call('POST', `/api/digests/${id}/read`)).status).toBe(204);
    expect(await (await call('GET', '/api/digests/unread-count')).json()).toEqual({ count: 0 });
    const { digests } = await (await call('GET', '/api/digests')).json();
    expect(digests[0].unread).toBe(0);

    expect(
      (await call('POST', '/api/digests/00000000-0000-0000-0000-000000000000/read')).status,
    ).toBe(404);
    expect((await call('POST', '/api/digests/not-an-id/read')).status).toBe(400);
  });
});
