// Test accounts for integration specs that call route handlers directly (no cookie flow).
import { sql } from 'drizzle-orm';
import { defineEventHandler, getRequestHeader } from 'h3';

import { createUsersRepository } from '../accounts/repository';
import type { SessionUser } from '../accounts/service';
import type { Db } from '../db/client';

export interface TestUsers {
  alice: SessionUser;
  bob: SessionUser;
}

/**
 * Empties users (and, by cascade, everything they own) and creates Alice and Bob.
 * The hash is a placeholder: these users never sign in with a password.
 */
export async function seedTestUsers(db: Db): Promise<TestUsers> {
  await db.execute(sql`truncate table users cascade`);
  const repo = createUsersRepository(db);
  const [alice, bob] = await Promise.all([
    repo.create('alice', 'scrypt:not-a-real-hash'),
    repo.create('bob', 'scrypt:not-a-real-hash'),
  ]);
  return {
    alice: { id: alice.id, username: alice.username },
    bob: { id: bob.id, username: bob.username },
  };
}

/** Header that picks who a test request runs as ("alice" or "bob"). */
export const TEST_USER_HEADER = 'x-test-user';

/**
 * Stands in for the auth middleware: sets event.context.user from the test header,
 * or to `fallback` when the request names nobody (none: the request is signed out).
 */
export function testUserMiddleware(users: () => TestUsers, fallback?: keyof TestUsers) {
  return defineEventHandler((event) => {
    const header = getRequestHeader(event, TEST_USER_HEADER) as keyof TestUsers | undefined;
    const name = header ?? fallback;
    if (name && users()[name]) event.context.user = users()[name];
  });
}
