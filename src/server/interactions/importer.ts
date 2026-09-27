import { isNotNull } from 'drizzle-orm';

import type { Db } from '../db/client';
import { ddiDrugs, ddiImports, ddiInteractions } from '../db/schema';
import { normalizeDdinter, parseDdinterCsv, splitRoute } from './ddinter';

/** DDInter 2.0 publishes one CSV per ATC top-level letter. */
export const DDINTER_CODES = ['A', 'B', 'C', 'D', 'G', 'H', 'J', 'L', 'M', 'N', 'P', 'R', 'S', 'V'];
export const DDINTER_BASE_URL = 'https://ddinter2.scbdd.com/static/media/download';

export interface ImportOptions {
  db: Db;
  codes?: string[];
  fetchCsv: (code: string) => Promise<string>;
  /** Drug name → RxNorm ingredient RXCUI (or null). */
  mapName: (name: string) => Promise<string | null>;
  /** Share of drugs that must map to RxNorm, else nothing is written. */
  minMappedRatio?: number;
  /** Parallel name lookups (RxNav allows 20 requests/s; each lookup is 2 requests). */
  concurrency?: number;
  log?: (message: string) => void;
}

export interface ImportSummary {
  pairs: number;
  drugs: number;
  mappedDrugs: number;
  unmapped: string[];
}

export class ImportRejectedError extends Error {
  override readonly name = 'ImportRejectedError';
}

const BATCH = 5000;

/** Downloads, maps and replaces all DDInter data in one transaction. */
export async function importDdinter({
  db,
  codes = DDINTER_CODES,
  fetchCsv,
  mapName,
  minMappedRatio = 0.9,
  concurrency = 6,
  log = console.log,
}: ImportOptions): Promise<ImportSummary> {
  const rows = [];
  for (const code of codes) {
    const parsed = parseDdinterCsv(await fetchCsv(code));
    log(`[ddi] ${code}: ${parsed.length} rows`);
    rows.push(...parsed);
  }
  const { drugs, pairs } = normalizeDdinter(rows);

  // Reuse mappings from the previous import (by exact name) to spare RxNav.
  const previous = new Map(
    (
      await db
        .select({ name: ddiDrugs.name, rxcui: ddiDrugs.ingredientRxcui })
        .from(ddiDrugs)
        .where(isNotNull(ddiDrugs.ingredientRxcui))
    ).map((r) => [r.name, r.rxcui]),
  );

  const lookupFor = (name: string) => splitRoute(name).base;
  const pending = [...new Set([...drugs.values()].filter((n) => !previous.has(n)).map(lookupFor))];
  log(`[ddi] ${drugs.size} drugs, ${pending.length} names to map via RxNav`);
  const mapped = new Map<string, string | null>();
  let done = 0;
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      for (let name = pending.shift(); name !== undefined; name = pending.shift()) {
        mapped.set(name, await mapName(name));
        if (++done % 200 === 0) log(`[ddi] mapped ${done} names…`);
      }
    }),
  );

  const drugRows = [...drugs].map(([ddinterId, name]) => ({
    ddinterId,
    name,
    route: splitRoute(name).route,
    ingredientRxcui: previous.get(name) ?? mapped.get(lookupFor(name)) ?? null,
  }));
  const mappedDrugs = drugRows.filter((d) => d.ingredientRxcui).length;
  const unmapped = drugRows.filter((d) => !d.ingredientRxcui).map((d) => d.name);
  const summary = { pairs: pairs.length, drugs: drugRows.length, mappedDrugs, unmapped };

  if (!drugRows.length || mappedDrugs / drugRows.length < minMappedRatio) {
    throw new ImportRejectedError(
      `Only ${mappedDrugs}/${drugRows.length} drugs mapped to RxNorm (need ${minMappedRatio * 100}%); ` +
        'kept the existing interaction data.',
    );
  }

  await db.transaction(async (tx) => {
    await tx.delete(ddiInteractions);
    await tx.delete(ddiDrugs);
    for (let i = 0; i < drugRows.length; i += BATCH) {
      await tx.insert(ddiDrugs).values(drugRows.slice(i, i + BATCH));
    }
    for (let i = 0; i < pairs.length; i += BATCH) {
      await tx.insert(ddiInteractions).values(pairs.slice(i, i + BATCH));
    }
    await tx
      .insert(ddiImports)
      .values({ pairs: pairs.length, drugs: drugRows.length, mappedDrugs });
  });
  return summary;
}
