// @vitest-environment node
import { sql } from 'drizzle-orm';

import { createDb } from '../db/client';
import { runMigrations } from '../db/migrate';
import { createDigestRepository, type NewDigestItem } from './repository';

// Requires: npm run db:test:up
const url =
  process.env['TEST_DATABASE_URL'] ?? 'postgres://rxplus:rxplus@localhost:5433/rxplus_test';

const WINDOW = { windowStart: '2026-09-21', windowEnd: '2026-09-27' };

const paper = (pmid: string): NewDigestItem => ({
  kind: 'paper',
  ingredientRxcui: '83367',
  subject: 'atorvastatin',
  title: `Paper ${pmid}`,
  url: `https://pubmed.ncbi.nlm.nih.gov/${pmid}/`,
  details: { journal: 'Lancet', year: 2026 },
  externalId: pmid,
});

describe('digest repository (integration)', () => {
  const { db, pool } = createDb(url);
  const repo = createDigestRepository(db);

  beforeAll(() => runMigrations(url, 'drizzle'));
  beforeEach(() => db.execute(sql`truncate digests, digest_items, digest_label_versions`));
  // The e2e server shares this database: leave no running digest for its startup to resume.
  afterAll(async () => {
    await db.execute(sql`truncate digests, digest_items, digest_label_versions`);
    await pool.end();
  });

  it('runs one digest at a time', async () => {
    const run = await repo.start({ trigger: 'manual', ...WINDOW });
    expect(run).toMatchObject({ status: 'running', trigger: 'manual', ...WINDOW });
    expect(await repo.start({ trigger: 'schedule', ...WINDOW })).toBeNull();
    expect((await repo.running())?.id).toBe(run!.id);

    await repo.fail(run!.id, 'PubMed is down');
    expect(await repo.running()).toBeNull();
    expect(await repo.start({ trigger: 'manual', ...WINDOW })).not.toBeNull();
  });

  it('stores items, notes and label versions when a run finishes, in order', async () => {
    const run = (await repo.start({ trigger: 'schedule', ...WINDOW }))!;
    await repo.finish(run.id, {
      items: [
        paper('2'),
        paper('1'),
        { kind: 'more-papers', subject: 'atorvastatin', title: '9 more', url: 'u' },
      ],
      notes: ["Takeaways for metformin couldn't be written"],
      labelVersions: [{ productRxcui: '617312', setId: 'abc', version: '12' }],
    });

    const [digest] = await repo.recent();
    expect(digest).toMatchObject({
      status: 'ready',
      notes: ["Takeaways for metformin couldn't be written"],
      finishedAt: expect.any(Date),
    });
    expect(digest.items.map((i) => i.title)).toEqual(['Paper 2', 'Paper 1', '9 more']);
    expect(digest.items[0]).toMatchObject({
      kind: 'paper',
      details: { journal: 'Lancet', year: 2026 },
      takeaway: null,
      readAt: null,
    });
    expect(await repo.labelVersions(['617312', '1'])).toEqual(
      new Map([['617312', { productRxcui: '617312', setId: 'abc', version: '12' }]]),
    );
    expect((await repo.lastSuccessful())?.id).toBe(run.id);
  });

  it('writes nothing when the transaction fails', async () => {
    const run = (await repo.start({ trigger: 'schedule', ...WINDOW }))!;
    await expect(
      repo.finish(run.id, {
        items: [paper('1'), { ...paper('2'), title: null as unknown as string }],
        notes: [],
      }),
    ).rejects.toThrow();
    expect(await repo.unreadCount()).toBe(0);
    expect((await repo.running())?.id).toBe(run.id);
  });

  it('updates a product label version', async () => {
    const run = (await repo.start({ trigger: 'schedule', ...WINDOW }))!;
    await repo.finish(run.id, {
      items: [],
      notes: [],
      labelVersions: [{ productRxcui: '617312', setId: 'abc', version: '12' }],
    });
    const next = (await repo.start({ trigger: 'schedule', ...WINDOW }))!;
    await repo.finish(next.id, {
      items: [],
      notes: [],
      labelVersions: [{ productRxcui: '617312', setId: 'abc', version: '13' }],
    });
    expect((await repo.labelVersions(['617312'])).get('617312')?.version).toBe('13');
  });

  it('counts unread items and marks a digest read', async () => {
    const first = (await repo.start({ trigger: 'schedule', ...WINDOW }))!;
    await repo.finish(first.id, { items: [paper('1'), paper('2')], notes: [] });
    const second = (await repo.start({ trigger: 'manual', ...WINDOW }))!;
    await repo.finish(second.id, { items: [paper('3')], notes: [] });
    expect(await repo.unreadCount()).toBe(3);

    expect(await repo.markRead(first.id)).toBe(true);
    expect(await repo.unreadCount()).toBe(1);
    expect(await repo.markRead('00000000-0000-0000-0000-000000000000')).toBe(false);

    const [newest, older] = await repo.recent();
    expect(newest.id).toBe(second.id);
    expect(older.items.every((i) => i.readAt instanceof Date)).toBe(true);
  });

  it('tells which external ids were already reported, by kind', async () => {
    const run = (await repo.start({ trigger: 'schedule', ...WINDOW }))!;
    await repo.finish(run.id, { items: [paper('1'), paper('2')], notes: [] });
    expect(await repo.seen('paper', ['1', '3'])).toEqual(new Set(['1']));
    expect(await repo.seen('trial', ['1'])).toEqual(new Set());
    expect(await repo.seen('paper', [])).toEqual(new Set());
  });

  it('lists only the last 12 weeks', async () => {
    const run = (await repo.start({ trigger: 'schedule', ...WINDOW }))!;
    await repo.finish(run.id, { items: [], notes: [] });
    await db.execute(sql`update digests set started_at = now() - interval '13 weeks'`);
    expect(await repo.recent()).toEqual([]);
    expect((await repo.lastSuccessful())?.id).toBe(run.id);
  });

  it('marks a run cut off by a restart as failed', async () => {
    const run = (await repo.start({ trigger: 'schedule', ...WINDOW }))!;
    expect(await repo.failInterrupted()).toBe(1);
    const [digest] = await repo.recent();
    expect(digest).toMatchObject({
      id: run.id,
      status: 'failed',
      error: 'Interrupted by a server restart.',
    });
    expect(await repo.lastSuccessful()).toBeNull();
  });

  it('counts Claude calls made by digests today', async () => {
    const run = (await repo.start({ trigger: 'schedule', ...WINDOW }))!;
    await repo.countClaudeCall(run.id);
    await repo.countClaudeCall(run.id);
    expect(await repo.claudeCallsToday('America/New_York')).toBe(2);
    await db.execute(sql`update digests set started_at = now() - interval '2 days'`);
    expect(await repo.claudeCallsToday('America/New_York')).toBe(0);
  });
});
