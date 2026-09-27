// Imports DDInter 2.0 interactions (CC BY-NC-SA 4.0) into Postgres, mapped to RxNorm.
// Dev: npm run ddi:import · Docker: docker compose run --rm app node dist/ddi-import.cjs
import { createDb } from '../src/server/db/client';
import { runMigrations } from '../src/server/db/migrate';
import { DDINTER_BASE_URL, importDdinter } from '../src/server/interactions/importer';
import { createRxNavClient } from '../src/server/rxnorm/client';

/** Spaces request starts to stay under NLM's 20 requests/second guideline. */
function throttled(fetchFn: typeof fetch, perSecond: number): typeof fetch {
  let next = 0;
  return async (input, init) => {
    const now = Date.now();
    const wait = Math.max(0, next - now);
    next = Math.max(now, next) + 1000 / perSecond;
    if (wait) await new Promise((resolve) => setTimeout(resolve, wait));
    return fetchFn(input, init);
  };
}

async function main(): Promise<void> {
  const url = process.env['DATABASE_URL'];
  if (!url) throw new Error('DATABASE_URL is not set');
  const ddinterBase = process.env['DDINTER_BASE_URL'] ?? DDINTER_BASE_URL;
  const rxnav = createRxNavClient({
    baseUrl: process.env['RXNAV_BASE_URL'] ?? 'https://rxnav.nlm.nih.gov/REST',
    fetch: throttled(fetch, 15),
    timeoutMs: 15_000,
  });

  await runMigrations(url, process.env['MIGRATIONS_DIR'] ?? 'drizzle');
  const { db, pool } = createDb(url);
  const started = Date.now();
  try {
    const summary = await importDdinter({
      db,
      fetchCsv: async (code) => {
        const response = await fetch(`${ddinterBase}/ddinter_downloads_code_${code}.csv`, {
          signal: AbortSignal.timeout(60_000),
        });
        if (!response.ok) throw new Error(`DDInter ${code}.csv: HTTP ${response.status}`);
        return response.text();
      },
      mapName: (name) => rxnav.ingredientByName(name),
    });
    const pct = ((summary.mappedDrugs / summary.drugs) * 100).toFixed(1);
    console.log(
      `[ddi] imported ${summary.pairs} pairs, ${summary.drugs} drugs, ` +
        `${summary.mappedDrugs} mapped to RxNorm (${pct}%) in ${Math.round((Date.now() - started) / 1000)}s`,
    );
    if (summary.unmapped.length) {
      console.log(
        `[ddi] not mapped (${summary.unmapped.length}): ${summary.unmapped.slice(0, 40).join('; ')}`,
      );
    }
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error(`[ddi] import failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
