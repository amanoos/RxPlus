import { and, desc, inArray } from 'drizzle-orm';

import type { Db } from '../db/client';
import { ddiDrugs, ddiImports, ddiInteractions } from '../db/schema';
import type { DdiPair } from './ddinter';
import type { DdiDrug } from './report';

export function createInteractionsRepository(db: Db) {
  return {
    /** DDInter drugs for these RxNorm ingredients, and the pairs among them. */
    async dataFor(ingredientRxcuis: string[]): Promise<{ ddiDrugs: DdiDrug[]; pairs: DdiPair[] }> {
      const unique = [...new Set(ingredientRxcuis)];
      if (!unique.length) return { ddiDrugs: [], pairs: [] };
      const drugs = await db
        .select({
          ddinterId: ddiDrugs.ddinterId,
          ingredientRxcui: ddiDrugs.ingredientRxcui,
          route: ddiDrugs.route,
        })
        .from(ddiDrugs)
        .where(inArray(ddiDrugs.ingredientRxcui, unique));
      const ids = drugs.map((d) => d.ddinterId);
      const pairs = ids.length
        ? await db
            .select()
            .from(ddiInteractions)
            .where(and(inArray(ddiInteractions.drugA, ids), inArray(ddiInteractions.drugB, ids)))
        : [];
      return { ddiDrugs: drugs, pairs };
    },

    async latestImport() {
      const [row] = await db
        .select()
        .from(ddiImports)
        .orderBy(desc(ddiImports.importedAt), desc(ddiImports.id))
        .limit(1);
      return row ?? null;
    },
  };
}

export type InteractionsRepository = ReturnType<typeof createInteractionsRepository>;
