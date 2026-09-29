import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { sql } from 'drizzle-orm';

import { createUsersRepository } from '../src/server/accounts/repository';
import { createDb } from '../src/server/db/client';
import { runMigrations } from '../src/server/db/migrate';
import { importDdinter } from '../src/server/interactions/importer';
import { hashPassword } from '../src/server/utils/password';
import {
  E2E_DATABASE_URL,
  E2E_OTHER_PASSWORD,
  E2E_OTHER_USERNAME,
  E2E_PASSWORD,
  E2E_USERNAME,
} from './helpers';

/** RxNorm ingredients for the names in fixtures/ddinter-sample.csv. */
const INGREDIENTS: Record<string, string> = {
  Lisinopril: '29046',
  Spironolactone: '9997',
  Atorvastatin: '83367',
};

// The e2e server uses the throwaway test database (npm run db:test:up), seeded
// with two accounts and a tiny DDInter sample so interaction results are deterministic.
export default async function globalSetup() {
  await runMigrations(E2E_DATABASE_URL, 'drizzle');
  const csv = readFileSync(join(import.meta.dirname, 'fixtures', 'ddinter-sample.csv'), 'utf8');
  const { db, pool } = createDb(E2E_DATABASE_URL);
  try {
    await db.execute(sql`truncate table users cascade`);
    const users = createUsersRepository(db);
    await users.create(E2E_USERNAME, await hashPassword(E2E_PASSWORD));
    await users.create(E2E_OTHER_USERNAME, await hashPassword(E2E_OTHER_PASSWORD));
    await importDdinter({
      db,
      codes: ['C'],
      fetchCsv: async () => csv,
      mapName: async (name) => INGREDIENTS[name] ?? null,
      log: () => undefined,
    });
  } finally {
    await pool.end();
  }
}
