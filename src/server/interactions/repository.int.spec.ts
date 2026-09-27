// @vitest-environment node
// Needs the test database: npm run db:test:up
import { inArray, like } from 'drizzle-orm';

import { createDb } from '../db/client';
import { runMigrations } from '../db/migrate';
import { ddiDrugs, ddiImports, ddiInteractions } from '../db/schema';
import { createInteractionsRepository } from './repository';

const url =
  process.env['TEST_DATABASE_URL'] ?? 'postgres://rxplus:rxplus@localhost:5433/rxplus_test';

describe('interactions repository (integration)', () => {
  const { db, pool } = createDb(url);
  const repo = createInteractionsRepository(db);

  // Test-only ids and ingredient codes, so real imported data is left alone.
  beforeAll(async () => {
    await runMigrations(url, 'drizzle');
    await cleanup();
    await db.insert(ddiDrugs).values([
      { ddinterId: 'TEST-L', name: 'Lisinopril', route: null, ingredientRxcui: 'T29046' },
      { ddinterId: 'TEST-S', name: 'Spironolactone', route: null, ingredientRxcui: 'T9997' },
      { ddinterId: 'TEST-X', name: 'Other', route: null, ingredientRxcui: 'T1' },
    ]);
    await db.insert(ddiInteractions).values([
      { drugA: 'TEST-L', drugB: 'TEST-S', level: 'Major' },
      { drugA: 'TEST-L', drugB: 'TEST-X', level: 'Minor' },
    ]);
  });
  afterAll(async () => {
    await cleanup();
    await pool.end();
  });
  async function cleanup() {
    await db.delete(ddiInteractions).where(like(ddiInteractions.drugA, 'TEST-%'));
    await db.delete(ddiDrugs).where(like(ddiDrugs.ddinterId, 'TEST-%'));
  }

  it('loads the DDInter drugs for the given ingredients and only the pairs among them', async () => {
    const data = await repo.dataFor(['T29046', 'T9997']);
    expect(data.ddiDrugs.map((d) => d.ddinterId).sort()).toEqual(['TEST-L', 'TEST-S']);
    expect(data.pairs).toEqual([{ drugA: 'TEST-L', drugB: 'TEST-S', level: 'Major' }]);
  });

  it('returns empty data for no ingredients', async () => {
    expect(await repo.dataFor([])).toEqual({ ddiDrugs: [], pairs: [] });
  });

  it('reports the latest import', async () => {
    const [row] = await db
      .insert(ddiImports)
      .values({ pairs: 2, drugs: 3, mappedDrugs: 3 })
      .returning();
    expect(await repo.latestImport()).toMatchObject({ id: row.id });
    await db.delete(ddiImports).where(inArray(ddiImports.id, [row.id]));
  });
});
