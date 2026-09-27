// Runs at container start, before the server (bundled to dist/migrate.cjs).
// Exits non-zero on failure so the container never serves an unmigrated schema.
import { runMigrations } from '../src/server/db/migrate';

async function main(): Promise<void> {
  const url = process.env['DATABASE_URL'];
  if (!url) throw new Error('DATABASE_URL is not set');
  const folder = process.env['MIGRATIONS_DIR'] ?? 'drizzle';

  const result = await runMigrations(url, folder);
  console.log(
    result === 'none' ? '[migrate] no migrations to apply' : '[migrate] database is up to date',
  );
}

main().catch((error: unknown) => {
  console.error(`[migrate] failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
