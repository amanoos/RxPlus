// @vitest-environment node
import { sql } from 'drizzle-orm';

import { createDb } from '../db/client';
import { runMigrations } from '../db/migrate';
import { createUsersRepository, UsernameTakenError } from './repository';

// Requires: npm run db:test:up
const url =
  process.env['TEST_DATABASE_URL'] ?? 'postgres://rxplus:rxplus@localhost:5433/rxplus_test';

describe('users repository (integration)', () => {
  const { db, pool } = createDb(url);
  const repo = createUsersRepository(db);

  beforeAll(async () => {
    await runMigrations(url, 'drizzle');
  });
  beforeEach(async () => {
    await db.execute(sql`truncate table users cascade`);
  });
  afterAll(async () => {
    await pool.end();
  });

  it('creates a user and finds it by name and id', async () => {
    const alice = await repo.create('alice', 'hash-1');
    expect(alice).toMatchObject({ username: 'alice', passwordHash: 'hash-1', sessionVersion: 1 });
    expect(await repo.findByUsername('alice')).toMatchObject({ id: alice.id });
    expect(await repo.findById(alice.id)).toMatchObject({ username: 'alice' });
    expect(await repo.findByUsername('bob')).toBeNull();
    expect(await repo.findById('00000000-0000-0000-0000-000000000000')).toBeNull();
  });

  it('refuses a username that exists', async () => {
    await repo.create('alice', 'hash-1');
    await expect(repo.create('alice', 'hash-2')).rejects.toThrow(UsernameTakenError);
  });

  it('resets a password and bumps the session version', async () => {
    await repo.create('alice', 'hash-1');
    expect(await repo.resetPassword('alice', 'hash-2')).toBe(true);
    expect(await repo.findByUsername('alice')).toMatchObject({
      passwordHash: 'hash-2',
      sessionVersion: 2,
    });
    expect(await repo.resetPassword('nobody', 'hash-3')).toBe(false);
  });

  it('removes, lists without hashes, and counts', async () => {
    await repo.create('bob', 'hash-b');
    await repo.create('alice', 'hash-a');
    const listed = await repo.list();
    expect(listed.map((u) => u.username)).toEqual(['alice', 'bob']);
    expect(listed[0]).not.toHaveProperty('passwordHash');
    expect(await repo.count()).toBe(2);

    expect(await repo.remove('bob')).toBe(true);
    expect(await repo.remove('bob')).toBe(false);
    expect(await repo.count()).toBe(1);
  });
});
