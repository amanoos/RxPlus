import { runMigrations } from '../src/server/db/migrate';
import { E2E_DATABASE_URL } from './helpers';

// The e2e server uses the throwaway test database (npm run db:test:up).
export default async function globalSetup() {
  await runMigrations(E2E_DATABASE_URL, 'drizzle');
}
