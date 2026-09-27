// @vitest-environment node
import { sql } from 'drizzle-orm';

import { createDb } from '../db/client';
import { runMigrations } from '../db/migrate';
import { createSummaryRepository, type NewPendingSummary } from './repository';

// Requires: npm run db:test:up
const url =
  process.env['TEST_DATABASE_URL'] ?? 'postgres://rxplus:rxplus@localhost:5433/rxplus_test';

const pending: NewPendingSummary = {
  rxcui: '314076',
  labelSetId: 'set-1',
  labelVersion: '2',
  labelEffectiveDate: '2026-09-10',
  provider: 'ollama',
  model: 'qwen2.5:7b',
};

const result = {
  sections: [{ heading: "What it's for", sentences: [] }],
  sentenceCount: 4,
  uncitedCount: 1,
  removedAdvice: 0,
  inputTokens: 900,
  outputTokens: 300,
};

describe('summary repository (integration)', () => {
  const { db, pool } = createDb(url);
  const repo = createSummaryRepository(db);

  beforeAll(() => runMigrations(url, 'drizzle'));
  beforeEach(() => db.execute(sql`truncate table drug_summaries`));
  afterAll(() => pool.end());

  it('claims a label once, stores the result and finds it by label version', async () => {
    const row = await repo.claim(pending);
    expect(row).toMatchObject({ status: 'pending', provider: 'ollama' });
    expect(await repo.claim(pending)).toBeNull();

    await repo.complete(row!.id, result);
    const found = await repo.find(pending);
    expect(found).toMatchObject({ status: 'ready', ...result });
    expect(found!.completedAt).toBeInstanceOf(Date);
    expect(await repo.find({ ...pending, labelVersion: '3' })).toBeNull();
  });

  it('restarts a failed summary, possibly with another provider', async () => {
    const row = await repo.claim(pending);
    await repo.fail(row!.id, 'Ollama timed out');
    const again = await repo.claim({ ...pending, provider: 'claude', model: 'claude-opus-5' });
    expect(again).toMatchObject({
      id: row!.id,
      status: 'pending',
      provider: 'claude',
      error: null,
    });
  });

  it('counts generations started today per provider', async () => {
    await repo.claim({ ...pending, provider: 'claude' });
    await repo.claim({ ...pending, rxcui: '1', provider: 'claude' });
    await repo.claim({ ...pending, rxcui: '2' });
    await db.execute(
      sql`update drug_summaries set started_at = now() - interval '2 days' where rxcui = '1'`,
    );
    expect(await repo.startedToday('claude', 'America/New_York')).toBe(1);
    expect(await repo.startedToday('ollama', 'America/New_York')).toBe(1);
  });

  it('marks pending rows as interrupted at startup', async () => {
    const row = await repo.claim(pending);
    expect(await repo.failInterrupted()).toBe(1);
    expect(await repo.find(pending)).toMatchObject({
      id: row!.id,
      status: 'failed',
      error: 'Interrupted by a server restart.',
    });
  });
});
