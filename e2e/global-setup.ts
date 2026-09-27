import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { createDb } from '../src/server/db/client';
import { runMigrations } from '../src/server/db/migrate';
import { importDdinter } from '../src/server/interactions/importer';
import { E2E_DATABASE_URL } from './helpers';

/** RxNorm ingredients for the names in fixtures/ddinter-sample.csv. */
const INGREDIENTS: Record<string, string> = {
  Lisinopril: '29046',
  Spironolactone: '9997',
  Atorvastatin: '83367',
};

// The e2e server uses the throwaway test database (npm run db:test:up), seeded
// with a tiny DDInter sample so interaction results are deterministic.
export default async function globalSetup() {
  await runMigrations(E2E_DATABASE_URL, 'drizzle');
  const csv = readFileSync(join(import.meta.dirname, 'fixtures', 'ddinter-sample.csv'), 'utf8');
  const { db, pool } = createDb(E2E_DATABASE_URL);
  try {
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
