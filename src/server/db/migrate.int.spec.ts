// @vitest-environment node
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import pg from 'pg';

import { runMigrations } from './migrate';

// Requires: npm run db:test:up
const url =
  process.env['TEST_DATABASE_URL'] ?? 'postgres://rxplus:rxplus@localhost:5433/rxplus_test';

describe('runMigrations (integration)', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'rxplus-migrations-'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const writeJournal = () => {
    mkdirSync(join(dir, 'meta'));
    writeFileSync(
      join(dir, 'meta', '_journal.json'),
      JSON.stringify({ version: '7', dialect: 'postgresql', entries: [] }),
    );
  };

  it('checks the connection and reports none when there are no migrations yet', async () => {
    await expect(runMigrations(url, dir)).resolves.toBe('none');
  });

  it('fails even without migrations when the database is unreachable', async () => {
    await expect(runMigrations('postgres://rxplus:rxplus@localhost:1/none', dir)).rejects.toThrow();
  });

  it('applies migrations and records them in the drizzle schema', async () => {
    writeJournal();
    await expect(runMigrations(url, dir)).resolves.toBe('applied');

    const client = new pg.Client({ connectionString: url });
    await client.connect();
    try {
      const { rows } = await client.query(
        "select to_regclass('drizzle.__drizzle_migrations') as table_name",
      );
      expect(rows[0].table_name).not.toBeNull();
    } finally {
      await client.end();
    }
  });

  it('rejects when the database is unreachable', async () => {
    writeJournal();
    await expect(runMigrations('postgres://rxplus:rxplus@localhost:1/none', dir)).rejects.toThrow();
  });
});
