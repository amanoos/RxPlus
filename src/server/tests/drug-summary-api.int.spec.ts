// @vitest-environment node
// Needs the test database: npm run db:test:up
import { sql } from 'drizzle-orm';
import { createApp, createRouter, toWebHandler } from 'h3';

import { createDb } from '../db/client';
import { runMigrations } from '../db/migrate';
import { medications } from '../db/schema';
import {
  ProviderUnavailableError,
  useSummaryProvider,
  type SummaryProvider,
} from '../drug-info/providers';
import { settleSummaryJobs } from '../drug-info/service';
import { HEADINGS, type RawSummary } from '../drug-info/summary';
import { OpenFdaUnavailableError, useOpenFdaClient, type OpenFdaClient } from '../openfda';
import type { SummaryLabel } from '../openfda/client';
import getRoute from '../routes/api/drugs/[rxcui]/summary.get';
import postRoute from '../routes/api/drugs/[rxcui]/summary.post';
import { useRxNavClient, type RxNavClient } from '../rxnorm';
import { env } from '../utils/env';
import { seedTestUsers, testUserMiddleware, type TestUsers } from './test-users';

const TEST_DB =
  process.env['TEST_DATABASE_URL'] ?? 'postgres://rxplus:rxplus@localhost:5433/rxplus_test';

const label: SummaryLabel = {
  rxcui: '314076',
  setId: 'set-1',
  version: '2',
  manufacturer: 'Maker',
  effectiveDate: '2026-09-10',
  dailyMedUrl: 'https://dailymed.nlm.nih.gov/dailymed/lookup.cfm?setid=set-1',
  sections: [
    {
      name: 'indications_and_usage',
      text: 'Lisinopril is indicated for the treatment of hypertension in adult patients.',
    },
    {
      name: 'adverse_reactions',
      text: 'The most common adverse reactions are headache, dizziness and cough.',
    },
  ],
};

const cited = {
  text: 'It treats high blood pressure.',
  quotes: [{ labelSection: 'indications_and_usage' as const, text: 'treatment of hypertension' }],
};
const uncited = { text: 'It is very safe for everyone.', quotes: [] };

const raw = (sentences: RawSummary['sections'][number]['sentences']): RawSummary => ({
  sections: HEADINGS.map((heading, i) => ({
    heading,
    sentences: i === 0 ? sentences : [{ text: 'The label doesn’t say.', quotes: [] }],
  })),
});

describe('drug summary API (integration)', () => {
  const { db, pool } = createDb(TEST_DB);
  const openFda = {
    interactionLabel: vi.fn(),
    summaryLabel: vi.fn<OpenFdaClient['summaryLabel']>(),
    reportedReactions: vi.fn(),
    approvalFacts: vi.fn(),
    indications: vi.fn(),
  };
  const rxnav = { product: vi.fn<RxNavClient['product']>() };
  const generate = vi.fn<SummaryProvider['generate']>();
  const provider = (name: SummaryProvider['name'] = 'ollama'): SummaryProvider => ({
    name,
    model: name === 'claude' ? 'claude-opus-5' : 'qwen2.5:7b',
    generate,
  });
  let handle: (req: Request) => Promise<Response>;
  let users: TestUsers;
  const get = () => handle(new Request('http://localhost/api/drugs/314076/summary'));
  const post = () =>
    handle(new Request('http://localhost/api/drugs/314076/summary', { method: 'POST' }));

  beforeAll(async () => {
    process.env['DATABASE_URL'] = TEST_DB;
    process.env['SESSION_SECRET'] = 's'.repeat(32);
    await runMigrations(TEST_DB, 'drizzle');
    useOpenFdaClient(openFda as unknown as OpenFdaClient);
    useRxNavClient(rxnav as unknown as RxNavClient);
    handle = toWebHandler(
      createApp()
        .use(testUserMiddleware(() => users, 'alice'))
        .use(
          createRouter()
            .get('/api/drugs/:rxcui/summary', getRoute)
            .post('/api/drugs/:rxcui/summary', postRoute),
        ),
    );
  });
  beforeEach(async () => {
    vi.resetAllMocks();
    openFda.summaryLabel.mockResolvedValue(label);
    rxnav.product.mockResolvedValue({
      rxcui: '314076',
      tty: 'SCD',
      name: 'lisinopril 10 MG Oral Tablet',
      brandName: null,
      strength: '10 MG',
      doseForm: 'Oral Tablet',
      ingredients: [{ rxcui: '29046', name: 'lisinopril' }],
    });
    useSummaryProvider({ provider: provider() });
    await db.execute(sql`truncate drug_summaries, medications`);
    users = await seedTestUsers(db);
  });
  afterAll(async () => {
    useOpenFdaClient(undefined);
    useRxNavClient(undefined);
    useSummaryProvider(undefined);
    await pool.end();
  });

  it('reports no summary, then generates one in the background', async () => {
    expect((await get()).status).toBe(404);
    generate.mockResolvedValue({ raw: raw([cited]), inputTokens: 900, outputTokens: 300 });

    const started = await post();
    expect(started.status).toBe(202);
    expect(await started.json()).toMatchObject({
      status: 'pending',
      provider: 'ollama',
      model: 'qwen2.5:7b',
      label: { setId: 'set-1', version: '2', dailyMedUrl: label.dailyMedUrl },
    });

    await settleSummaryJobs();
    const res = await get();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      status: 'ready',
      sentenceCount: 1,
      uncitedCount: 0,
      lowCitation: false,
      error: null,
    });
    expect(body.sections[0].sentences[0].citations).toEqual([
      { labelSection: 'indications_and_usage', text: 'treatment of hypertension' },
    ]);
    const [row] = await db
      .execute<{ input_tokens: number }>(sql`select input_tokens from drug_summaries`)
      .then((r) => r.rows);
    expect(row.input_tokens).toBe(900);
  });

  it('re-reads the label on refresh and summarizes a new label version', async () => {
    generate.mockResolvedValue({ raw: raw([cited]) });
    await post();
    await settleSummaryJobs();
    expect(openFda.summaryLabel).toHaveBeenLastCalledWith('314076', { refresh: false });

    openFda.summaryLabel.mockResolvedValue({ ...label, version: '3' });
    const refreshed = await handle(
      new Request('http://localhost/api/drugs/314076/summary?refresh=1', { method: 'POST' }),
    );
    expect(openFda.summaryLabel).toHaveBeenLastCalledWith('314076', { refresh: true });
    expect(refreshed.status).toBe(202);
    expect(await refreshed.json()).toMatchObject({ label: { version: '3' } });
    await settleSummaryJobs();
    expect(generate).toHaveBeenCalledTimes(2);
  });

  it('is idempotent while pending or ready', async () => {
    let finish!: () => void;
    generate.mockReturnValue(
      new Promise((resolve) => (finish = () => resolve({ raw: raw([cited]) }))),
    );
    await post();
    expect((await post()).status).toBe(202);
    finish();
    await settleSummaryJobs();
    expect((await post()).status).toBe(200);
    expect(generate).toHaveBeenCalledTimes(1);
  });

  it('retries once when too many claims are uncited, then keeps the better one with a warning', async () => {
    generate
      .mockResolvedValueOnce({ raw: raw([uncited, uncited, cited]) })
      .mockResolvedValueOnce({ raw: raw([uncited, cited]) });
    await post();
    await settleSummaryJobs();
    expect(generate).toHaveBeenCalledTimes(2);
    expect(await (await get()).json()).toMatchObject({
      status: 'ready',
      sentenceCount: 2,
      uncitedCount: 1,
      lowCitation: true,
    });
  });

  it('records a failure and lets the owner try again', async () => {
    generate.mockRejectedValueOnce(new ProviderUnavailableError('Ollama timed out after 600s.'));
    await post();
    await settleSummaryJobs();
    expect(await (await get()).json()).toMatchObject({
      status: 'failed',
      error: 'Ollama timed out after 600s.',
    });

    generate.mockResolvedValue({ raw: raw([cited]) });
    expect((await post()).status).toBe(202);
    await settleSummaryJobs();
    expect(await (await get()).json()).toMatchObject({ status: 'ready', error: null });
  });

  it('ignores the drug’s own name when checking quotes', async () => {
    generate.mockResolvedValue({
      raw: raw([
        {
          text: 'Lisinopril can cause a cough.',
          quotes: [{ labelSection: 'indications_and_usage', text: 'Lisinopril is indicated' }],
        },
      ]),
    });
    await post();
    await settleSummaryJobs();
    expect(await (await get()).json()).toMatchObject({ uncitedCount: 1 });
  });

  it('enforces the Claude daily limit', async () => {
    useSummaryProvider({ provider: provider('claude') });
    generate.mockResolvedValue({ raw: raw([cited]) });
    // env() is parsed once per worker, so use whatever limit is in effect.
    const limit = env().AI_DAILY_LIMIT;
    for (let i = 0; i < limit; i++) {
      await db.execute(sql`
        insert into drug_summaries (rxcui, label_set_id, label_version, status, provider, model)
        values (${String(i)}, 's', '1', ${i % 2 ? 'failed' : 'ready'}, 'claude', 'claude-opus-5')`);
    }
    const res = await post();
    expect(res.status).toBe(429);
    expect((await res.json()).statusMessage).toContain(`daily limit of ${limit}`);
    expect(generate).not.toHaveBeenCalled();
  });

  it('explains an unconfigured provider, a missing label and an openFDA outage', async () => {
    useSummaryProvider({ unavailable: 'No local model configured (OLLAMA_MODEL).' });
    const unconfigured = await post();
    expect(unconfigured.status).toBe(503);
    expect((await unconfigured.json()).statusMessage).toContain('OLLAMA_MODEL');

    openFda.summaryLabel.mockResolvedValue(null);
    expect((await post()).status).toBe(422);
    openFda.summaryLabel.mockRejectedValue(new OpenFdaUnavailableError('down'));
    expect((await get()).status).toBe(503);
  });

  it('uses a saved medication for the drug names without calling RxNav', async () => {
    await db.insert(medications).values({
      userId: users.alice.id,
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
    generate.mockResolvedValue({ raw: raw([cited]) });
    expect((await post()).status).toBe(202);
    expect(rxnav.product).not.toHaveBeenCalled();
    await settleSummaryJobs();
  });
});
