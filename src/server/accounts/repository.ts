import { asc, eq, sql } from 'drizzle-orm';

import type { Db } from '../db/client';
import { users, type UserRow } from '../db/schema';

export type User = UserRow;

/** What `list` shows: never the hash. */
export interface UserSummary {
  username: string;
  createdAt: Date;
}

export class UsernameTakenError extends Error {
  override readonly name = 'UsernameTakenError';
}

const UNIQUE_VIOLATION = '23505';

function isUniqueViolation(error: unknown): boolean {
  // Drizzle wraps the pg error in `cause`.
  const code = (e: unknown) => (e as { code?: string } | undefined)?.code;
  return (
    code(error) === UNIQUE_VIOLATION ||
    code((error as { cause?: unknown })?.cause) === UNIQUE_VIOLATION
  );
}

/** Usernames passed here are already normalized (accounts/username.ts). */
export function createUsersRepository(db: Db) {
  return {
    async create(username: string, passwordHash: string): Promise<User> {
      try {
        const [row] = await db.insert(users).values({ username, passwordHash }).returning();
        return row;
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw new UsernameTakenError(`The username "${username}" already exists.`);
        }
        throw error;
      }
    },

    async findByUsername(username: string): Promise<User | null> {
      const [row] = await db.select().from(users).where(eq(users.username, username));
      return row ?? null;
    },

    async findById(id: string): Promise<User | null> {
      const [row] = await db.select().from(users).where(eq(users.id, id));
      return row ?? null;
    },

    /** New password; bumps the session version so every existing session ends. */
    async resetPassword(username: string, passwordHash: string): Promise<boolean> {
      const updated = await db
        .update(users)
        .set({
          passwordHash,
          sessionVersion: sql`${users.sessionVersion} + 1`,
          updatedAt: sql`now()`,
        })
        .where(eq(users.username, username))
        .returning({ id: users.id });
      return updated.length > 0;
    },

    async remove(username: string): Promise<boolean> {
      const deleted = await db
        .delete(users)
        .where(eq(users.username, username))
        .returning({ id: users.id });
      return deleted.length > 0;
    },

    list(): Promise<UserSummary[]> {
      return db
        .select({ username: users.username, createdAt: users.createdAt })
        .from(users)
        .orderBy(asc(users.username));
    },

    async count(): Promise<number> {
      const [row] = await db.select({ n: sql<number>`count(*)::int` }).from(users);
      return row?.n ?? 0;
    },
  };
}

export type UsersRepository = ReturnType<typeof createUsersRepository>;
