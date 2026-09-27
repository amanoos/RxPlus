// @vitest-environment node
import { checkHealth } from '../utils/health';
import { createDb, pingDb } from './client';

// Requires: docker compose --profile test up -d db-test
const url =
  process.env['TEST_DATABASE_URL'] ?? 'postgres://rxplus:rxplus@localhost:5433/rxplus_test';

describe('database client (integration)', () => {
  const { db, pool } = createDb(url);
  afterAll(() => pool.end());

  it('reaches the test database', async () => {
    expect(await checkHealth(() => pingDb(db))).toMatchObject({ statusCode: 200 });
  });

  it('reports down for an unreachable database', async () => {
    const bad = createDb('postgres://rxplus:rxplus@localhost:1/none');
    try {
      expect(await checkHealth(() => pingDb(bad.db))).toMatchObject({ statusCode: 503 });
    } finally {
      await bad.pool.end();
    }
  });
});
