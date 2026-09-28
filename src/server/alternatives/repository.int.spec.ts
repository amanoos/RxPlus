// @vitest-environment node
import { sql } from 'drizzle-orm';

import { createDb } from '../db/client';
import { runMigrations } from '../db/migrate';
import { createMedicationsRepository } from '../medications/repository';
import { createAlternativesRepository, listKey, type AlternativeDrug } from './repository';

// Requires: npm run db:test:up
const url =
  process.env['TEST_DATABASE_URL'] ?? 'postgres://rxplus:rxplus@localhost:5433/rxplus_test';

const HTN = listKey('condition', 'D006973');

const drug = (rxcui: string, name: string, overrides: Partial<AlternativeDrug> = {}) => ({
  ingredientRxcui: rxcui,
  name,
  classId: 'N0000175562',
  className: 'Angiotensin Converting Enzyme Inhibitor',
  firstApproved: '1985-12-24',
  genericAvailable: true,
  productRxcui: '858804',
  ...overrides,
});

describe('alternatives repository (integration)', () => {
  const { db, pool } = createDb(url);
  const repo = createAlternativesRepository(db);

  beforeAll(() => runMigrations(url, 'drizzle'));
  beforeEach(() =>
    db.execute(sql`truncate alternative_lists, alternative_drugs, alternative_hidden, medications`),
  );
  afterAll(() => pool.end());

  it('builds one list at a time, stores its drugs, and reuses it while fresh', async () => {
    expect(await repo.claim(HTN, 'condition', 'Hypertension')).toMatchObject({
      status: 'pending',
      kind: 'condition',
    });
    expect(await repo.claim(HTN, 'condition', 'Hypertension')).toBeNull();

    await repo.complete(
      HTN,
      [drug('3827', 'enalapril'), drug('2679059', 'aprocitentan', { genericAvailable: false })],
      2,
    );
    expect(await repo.list(HTN)).toMatchObject({ status: 'ready', skipped: 2, error: null });
    expect((await repo.drugs(HTN)).map((d) => d.name)).toEqual(['aprocitentan', 'enalapril']);
    expect((await repo.drugs(HTN))[1]).toEqual(drug('3827', 'enalapril'));

    // Fresh: not rebuilt, unless forced.
    expect(await repo.claim(HTN, 'condition', 'Hypertension')).toBeNull();
    expect(await repo.claim(HTN, 'condition', 'Hypertension', { force: true })).toMatchObject({
      status: 'pending',
    });
    // A rebuild replaces the drugs.
    await repo.complete(HTN, [drug('35296', 'ramipril')], 0);
    expect((await repo.drugs(HTN)).map((d) => d.name)).toEqual(['ramipril']);
  });

  it('rebuilds failed and stale lists', async () => {
    await repo.claim(HTN, 'condition', 'Hypertension');
    await repo.fail(HTN, 'RxNav unreachable');
    expect(await repo.list(HTN)).toMatchObject({ status: 'failed', error: 'RxNav unreachable' });
    expect(await repo.claim(HTN, 'condition', 'Hypertension')).not.toBeNull();

    await repo.complete(HTN, [], 0);
    await db.execute(sql`update alternative_lists set built_at = now() - interval '31 days'`);
    expect(await repo.claim(HTN, 'condition', 'Hypertension')).not.toBeNull();
  });

  it('marks interrupted builds as failed at startup', async () => {
    await repo.claim(HTN, 'condition', 'Hypertension');
    expect(await repo.failInterrupted()).toBe(1);
    expect(await repo.list(HTN)).toMatchObject({
      status: 'failed',
      error: 'Interrupted by a server restart.',
    });
  });

  it('hides and unhides alternatives per ingredient', async () => {
    await repo.hide('29046', '1998');
    await repo.hide('29046', '1998');
    await repo.hide('29046', '3827');
    expect(await repo.hidden('29046')).toEqual(['1998', '3827']);
    expect(await repo.hidden('5487')).toEqual([]);
    await repo.unhide('29046', '1998');
    expect(await repo.hidden('29046')).toEqual(['3827']);
  });

  it('stores what a medication is taken for', async () => {
    const meds = createMedicationsRepository(db);
    const med = await meds.create({
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
    expect(med).toMatchObject({ takenForId: null, takenForName: null });
    const updated = await meds.update(med.id, {
      takenForId: 'D006973',
      takenForName: 'Hypertension',
    });
    expect(updated).toMatchObject({ takenForId: 'D006973', takenForName: 'Hypertension' });
  });
});
