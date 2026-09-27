// @vitest-environment node
// Needs the test database: npm run db:test:up
import { sql } from 'drizzle-orm';

import { createDb } from '../db/client';
import { runMigrations } from '../db/migrate';
import { ddiDrugs, ddiImports, ddiInteractions } from '../db/schema';
import { importDdinter, ImportRejectedError } from './importer';

const url =
  process.env['TEST_DATABASE_URL'] ?? 'postgres://rxplus:rxplus@localhost:5433/rxplus_test';
const HEADER = 'DDInterID_A,Drug_A,DDInterID_B,Drug_B,Level';

const files: Record<string, string> = {
  C: [
    HEADER,
    'DDInter1079,Lisinopril,DDInter1710,Spironolactone,Major',
    'DDInter1079,Lisinopril,DDInter134,Atorvastatin,Unknown',
    'DDInter1710,Spironolactone,DDInter1079,Lisinopril,Moderate',
  ].join('\n'),
  D: [HEADER, 'DDInter900,Hydrocortisone (topical),DDInter1079,Lisinopril,Minor'].join('\n'),
};
const ingredients: Record<string, string> = {
  Lisinopril: '29046',
  Spironolactone: '9997',
  Atorvastatin: '83367',
  Hydrocortisone: '5492',
};

describe('importDdinter (integration)', () => {
  const { db, pool } = createDb(url);
  const mapName = vi.fn(async (name: string) => ingredients[name] ?? null);
  const run = (overrides: Partial<Parameters<typeof importDdinter>[0]> = {}) =>
    importDdinter({
      db,
      codes: ['C', 'D'],
      fetchCsv: async (code) => files[code],
      mapName,
      log: () => undefined,
      ...overrides,
    });

  beforeAll(() => runMigrations(url, 'drizzle'));
  beforeEach(async () => {
    mapName.mockClear();
    await db.execute(sql`truncate ddi_interactions, ddi_drugs, ddi_imports`);
  });
  afterAll(() => pool.end());

  it('imports drugs mapped to RxNorm and pairs at their most severe level', async () => {
    const summary = await run();
    expect(summary).toMatchObject({ pairs: 3, drugs: 4, mappedDrugs: 4, unmapped: [] });

    const drugs = await db.select().from(ddiDrugs).orderBy(ddiDrugs.ddinterId);
    expect(drugs).toContainEqual({
      ddinterId: 'DDInter900',
      name: 'Hydrocortisone (topical)',
      route: 'topical',
      ingredientRxcui: '5492',
    });
    const pairs = await db.select().from(ddiInteractions);
    expect(pairs).toContainEqual({ drugA: 'DDInter1079', drugB: 'DDInter1710', level: 'Major' });
    expect(await db.select().from(ddiImports)).toHaveLength(1);
    // Route-qualified names are looked up by their base name.
    expect(mapName).toHaveBeenCalledWith('Hydrocortisone');
  });

  it('is idempotent and reuses earlier mappings', async () => {
    await run();
    mapName.mockClear();
    const second = await run();
    expect(second).toMatchObject({ pairs: 3, drugs: 4, mappedDrugs: 4 });
    expect(mapName).not.toHaveBeenCalled();
    expect(await db.select().from(ddiInteractions)).toHaveLength(3);
  });

  it('rejects an import below the mapping threshold and keeps the previous data', async () => {
    await run();
    const failingMap = vi.fn(async () => null);
    await expect(
      run({
        mapName: failingMap,
        fetchCsv: async (code) =>
          files[code].replace(
            /(Lisinopril|Spironolactone|Atorvastatin|Hydrocortisone)/g,
            'Unknown$1',
          ),
      }),
    ).rejects.toBeInstanceOf(ImportRejectedError);
    expect(await db.select().from(ddiInteractions)).toHaveLength(3);
    expect(await db.select().from(ddiImports)).toHaveLength(1);
  });

  it('keeps the previous data if a download fails', async () => {
    await run();
    await expect(
      run({
        fetchCsv: async (code) => {
          if (code === 'D') throw new Error('network down');
          return files[code];
        },
      }),
    ).rejects.toThrow('network down');
    expect(await db.select().from(ddiInteractions)).toHaveLength(3);
  });
});
