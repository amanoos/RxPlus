import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';

/**
 * Applies pending Drizzle migrations from `folder`. Always connects, so a bad
 * DATABASE_URL fails startup even before any migrations exist ('none').
 */
export async function runMigrations(
  connectionString: string,
  folder: string,
): Promise<'none' | 'applied'> {
  const pool = new pg.Pool({ connectionString, connectionTimeoutMillis: 5000 });
  try {
    if (!existsSync(join(folder, 'meta', '_journal.json'))) {
      await pool.query('select 1');
      return 'none';
    }
    await migrate(drizzle(pool), { migrationsFolder: folder });
    return 'applied';
  } finally {
    await pool.end();
  }
}
