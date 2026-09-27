import { sql } from 'drizzle-orm';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';

import { env } from '../utils/env';
import * as schema from './schema';

export type Db = NodePgDatabase<typeof schema>;

export function createDb(connectionString: string): { db: Db; pool: pg.Pool } {
  const pool = new pg.Pool({ connectionString, connectionTimeoutMillis: 3000 });
  // An idle client losing its connection must not crash the server.
  pool.on('error', (error) => console.error('[rxplus] postgres pool error:', error.message));
  return { db: drizzle(pool, { schema }), pool };
}

let shared: Db | undefined;

/** The app-wide database, created on first use from DATABASE_URL. */
export function db(): Db {
  shared ??= createDb(env().DATABASE_URL).db;
  return shared;
}

export async function pingDb(database: Db): Promise<void> {
  await database.execute(sql`select 1`);
}
