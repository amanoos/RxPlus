import { and, asc, eq, sql } from 'drizzle-orm';

import type { Db } from '../db/client';
import {
  alternativeDrugs,
  alternativeHidden,
  alternativeLists,
  type AlternativeDrugRow,
  type AlternativeListRow,
} from '../db/schema';

export type AlternativeList = AlternativeListRow;
export type AlternativeDrug = Omit<AlternativeDrugRow, 'listKey'>;

/** Built lists are rebuilt after this long. */
export const REBUILD_AFTER_DAYS = 30;

export const listKey = (kind: AlternativeListRow['kind'], id: string) => `${kind}:${id}`;

export function createAlternativesRepository(db: Db) {
  return {
    async list(key: string): Promise<AlternativeList | null> {
      const [row] = await db.select().from(alternativeLists).where(eq(alternativeLists.key, key));
      return row ?? null;
    },

    /**
     * Claims a list for building: a new list, a failed one, one older than
     * REBUILD_AFTER_DAYS, or any not being built when `force` is set. Null when a
     * build is already running or the list is fresh.
     */
    async claim(
      key: string,
      kind: AlternativeListRow['kind'],
      name: string,
      { force = false }: { force?: boolean } = {},
    ): Promise<AlternativeList | null> {
      const stale = sql`${alternativeLists.builtAt} < now() - make_interval(days => ${REBUILD_AFTER_DAYS})`;
      const [row] = await db
        .insert(alternativeLists)
        .values({ key, kind, name, status: 'pending' })
        .onConflictDoUpdate({
          target: alternativeLists.key,
          set: { name, status: 'pending', error: null, startedAt: sql`now()` },
          setWhere: force
            ? sql`${alternativeLists.status} <> 'pending'`
            : sql`${alternativeLists.status} = 'failed' or (${alternativeLists.status} = 'ready' and ${stale})`,
        })
        .returning();
      return row ?? null;
    },

    /** Replaces the list's drugs and marks it ready. */
    async complete(key: string, drugs: AlternativeDrug[], skipped: number): Promise<void> {
      await db.transaction(async (tx) => {
        await tx.delete(alternativeDrugs).where(eq(alternativeDrugs.listKey, key));
        if (drugs.length) {
          await tx.insert(alternativeDrugs).values(drugs.map((d) => ({ ...d, listKey: key })));
        }
        await tx
          .update(alternativeLists)
          .set({ status: 'ready', builtAt: sql`now()`, skipped, error: null })
          .where(eq(alternativeLists.key, key));
      });
    },

    async fail(key: string, error: string): Promise<void> {
      await db
        .update(alternativeLists)
        .set({ status: 'failed', error })
        .where(eq(alternativeLists.key, key));
    },

    async drugs(key: string): Promise<AlternativeDrug[]> {
      return db
        .select({
          ingredientRxcui: alternativeDrugs.ingredientRxcui,
          name: alternativeDrugs.name,
          classId: alternativeDrugs.classId,
          className: alternativeDrugs.className,
          firstApproved: alternativeDrugs.firstApproved,
          genericAvailable: alternativeDrugs.genericAvailable,
          productRxcui: alternativeDrugs.productRxcui,
        })
        .from(alternativeDrugs)
        .where(eq(alternativeDrugs.listKey, key))
        .orderBy(asc(alternativeDrugs.name));
    },

    /** Hides an alternative for one user. */
    async hide(userId: string, ingredientRxcui: string, hiddenRxcui: string): Promise<void> {
      await db
        .insert(alternativeHidden)
        .values({ userId, ingredientRxcui, hiddenRxcui })
        .onConflictDoNothing();
    },

    async unhide(userId: string, ingredientRxcui: string, hiddenRxcui: string): Promise<void> {
      await db
        .delete(alternativeHidden)
        .where(
          and(
            eq(alternativeHidden.userId, userId),
            eq(alternativeHidden.ingredientRxcui, ingredientRxcui),
            eq(alternativeHidden.hiddenRxcui, hiddenRxcui),
          ),
        );
    },

    /** The alternatives this user hid for a drug's ingredient, oldest first. */
    async hidden(userId: string, ingredientRxcui: string): Promise<string[]> {
      const rows = await db
        .select({ rxcui: alternativeHidden.hiddenRxcui })
        .from(alternativeHidden)
        .where(
          and(
            eq(alternativeHidden.userId, userId),
            eq(alternativeHidden.ingredientRxcui, ingredientRxcui),
          ),
        )
        .orderBy(asc(alternativeHidden.hiddenAt));
      return rows.map((r) => r.rxcui);
    },

    /** At startup nothing is building, so pending lists were cut off by a restart. */
    async failInterrupted(): Promise<number> {
      const rows = await db
        .update(alternativeLists)
        .set({ status: 'failed', error: 'Interrupted by a server restart.' })
        .where(eq(alternativeLists.status, 'pending'))
        .returning({ key: alternativeLists.key });
      return rows.length;
    },
  };
}

export type AlternativesRepository = ReturnType<typeof createAlternativesRepository>;
