import { integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

/** One account per person on this server (see SPEC-accounts.md). */
export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  /** Lowercase, trimmed; see accounts/username.ts. */
  username: text('username').notNull().unique(),
  /** scrypt hash from utils/password.ts; never logged. */
  passwordHash: text('password_hash').notNull(),
  /** Sessions carry this number; bumping it signs the user out everywhere. */
  sessionVersion: integer('session_version').notNull().default(1),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type UserRow = typeof users.$inferSelect;
