// @vitest-environment node
import { sql } from 'drizzle-orm';

import { createDb } from '../db/client';
import { runMigrations } from '../db/migrate';
import { createUsersRepository } from '../accounts/repository';
import { seedTestUsers, type TestUsers } from '../tests/test-users';
import {
  createMedicationsRepository,
  DuplicateActiveMedicationError,
  type NewMedication,
} from './repository';

// Requires: npm run db:test:up
const url =
  process.env['TEST_DATABASE_URL'] ?? 'postgres://rxplus:rxplus@localhost:5433/rxplus_test';

const lisinopril: NewMedication = {
  rxcui: '314076',
  tty: 'SCD',
  name: 'lisinopril 10 MG Oral Tablet',
  strength: '10 MG',
  doseForm: 'Oral Tablet',
  brandName: null,
  ingredients: [{ rxcui: '29046', name: 'lisinopril' }],
  notes: 'morning',
  startedOn: '2026-01-15',
};
const zestril: NewMedication = {
  ...lisinopril,
  rxcui: '104377',
  tty: 'SBD',
  name: 'lisinopril 10 MG Oral Tablet [Zestril]',
  brandName: 'Zestril',
};

describe('medications repository (integration)', () => {
  const { db, pool } = createDb(url);
  const all = createMedicationsRepository(db);
  let users: TestUsers;
  // Alice's list, used by the single-user tests below.
  let repo: ReturnType<typeof all.forUser>;

  beforeAll(async () => {
    await runMigrations(url, 'drizzle');
  });
  beforeEach(async () => {
    await db.execute(sql`truncate table medications`);
    users = await seedTestUsers(db);
    repo = all.forUser(users.alice.id);
  });
  afterAll(() => pool.end());

  it('creates and returns a medication with generated fields', async () => {
    const created = await repo.create(lisinopril);
    expect(created).toMatchObject({ ...lisinopril, stoppedOn: null });
    expect(created.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(created.createdAt).toBeInstanceOf(Date);
    expect(await repo.get(created.id)).toEqual(created);
  });

  it('refuses a second active copy of the same product', async () => {
    await repo.create(lisinopril);
    await expect(repo.create(lisinopril)).rejects.toBeInstanceOf(DuplicateActiveMedicationError);
  });

  it('allows the same product again once the first is stopped', async () => {
    const first = await repo.create(lisinopril);
    await repo.update(first.id, { stoppedOn: '2026-05-01' });
    await expect(repo.create(lisinopril)).resolves.toMatchObject({ stoppedOn: null });
  });

  it('refuses restarting a stopped product that is active again', async () => {
    const first = await repo.create(lisinopril);
    await repo.update(first.id, { stoppedOn: '2026-05-01' });
    await repo.create(lisinopril);
    await expect(repo.update(first.id, { stoppedOn: null })).rejects.toBeInstanceOf(
      DuplicateActiveMedicationError,
    );
  });

  it('lists active medications first, newest first, then stopped ones', async () => {
    const a = await repo.create(lisinopril);
    const b = await repo.create(zestril);
    await repo.update(a.id, { stoppedOn: '2026-05-01' });
    const c = await repo.create({
      ...lisinopril,
      rxcui: '197884',
      name: 'lisinopril 40 MG Oral Tablet',
    });
    expect((await repo.list()).map((m) => m.id)).toEqual([c.id, b.id, a.id]);
  });

  it('updates notes and dates and bumps updatedAt', async () => {
    const created = await repo.create(lisinopril);
    const updated = await repo.update(created.id, { notes: null, startedOn: '2026-02-01' });
    expect(updated).toMatchObject({ notes: null, startedOn: '2026-02-01' });
    expect(updated?.updatedAt.getTime()).toBeGreaterThanOrEqual(created.updatedAt.getTime());
  });

  it('returns null or false for unknown ids', async () => {
    const unknown = '00000000-0000-4000-8000-000000000000';
    expect(await repo.get(unknown)).toBeNull();
    expect(await repo.update(unknown, { notes: 'x' })).toBeNull();
    expect(await repo.remove(unknown)).toBe(false);
  });

  it('deletes permanently', async () => {
    const created = await repo.create(lisinopril);
    expect(await repo.remove(created.id)).toBe(true);
    expect(await repo.get(created.id)).toBeNull();
  });

  describe('two users', () => {
    it('keeps each list to its owner', async () => {
      const bob = all.forUser(users.bob.id);
      const mine = await repo.create(lisinopril);
      expect(mine.userId).toBe(users.alice.id);
      expect(await bob.list()).toEqual([]);
      expect((await repo.list()).map((m) => m.id)).toEqual([mine.id]);
    });

    it("never reads, changes or deletes another user's row", async () => {
      const bob = all.forUser(users.bob.id);
      const mine = await repo.create(lisinopril);
      expect(await bob.get(mine.id)).toBeNull();
      expect(await bob.update(mine.id, { notes: 'hijacked' })).toBeNull();
      expect(await bob.remove(mine.id)).toBe(false);
      expect(await repo.get(mine.id)).toMatchObject({ notes: 'morning' });
    });

    it('lets both have the same product active, but neither twice', async () => {
      const bob = all.forUser(users.bob.id);
      await repo.create(lisinopril);
      await expect(bob.create(lisinopril)).resolves.toMatchObject({ userId: users.bob.id });
      await expect(bob.create(lisinopril)).rejects.toBeInstanceOf(DuplicateActiveMedicationError);
    });

    it("deletes a user's medications with the account, leaving others", async () => {
      const bob = all.forUser(users.bob.id);
      await repo.create(lisinopril);
      await bob.create(zestril);
      await createUsersRepository(db).remove('alice');
      expect(await all.usersWithActiveMedications()).toEqual([users.bob.id]);
    });

    it('looks a saved product up by RXCUI without any user data', async () => {
      await repo.create({ ...lisinopril, notes: 'private note' });
      const found = await all.productByRxcui('314076');
      expect(found).toEqual({
        rxcui: '314076',
        tty: 'SCD',
        name: 'lisinopril 10 MG Oral Tablet',
        strength: '10 MG',
        doseForm: 'Oral Tablet',
        brandName: null,
        ingredients: [{ rxcui: '29046', name: 'lisinopril' }],
      });
      expect(await all.productByRxcui('999')).toBeNull();
    });

    it('names the users with an active medication, for the weekly digest', async () => {
      const bob = all.forUser(users.bob.id);
      expect(await all.usersWithActiveMedications()).toEqual([]);
      const stopped = await bob.create(zestril);
      await bob.update(stopped.id, { stoppedOn: '2026-05-01' });
      expect(await all.usersWithActiveMedications()).toEqual([]);
      await repo.create(lisinopril);
      await repo.create({ ...lisinopril, rxcui: '197884', name: 'x' });
      expect(await all.usersWithActiveMedications()).toEqual([users.alice.id]);
    });
  });
});
