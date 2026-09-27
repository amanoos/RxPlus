import { and, count, eq, gte, sql } from 'drizzle-orm';

import type { Db } from '../db/client';
import { drugSummaries, type DrugSummaryRow, type StoredSummarySection } from '../db/schema';

export type DrugSummary = DrugSummaryRow;

export interface LabelKey {
  rxcui: string;
  labelSetId: string;
  labelVersion: string;
}

export interface NewPendingSummary extends LabelKey {
  labelEffectiveDate: string | null;
  provider: DrugSummaryRow['provider'];
  model: string;
}

export interface CompletedSummary {
  sections: StoredSummarySection[];
  sentenceCount: number;
  uncitedCount: number;
  removedAdvice: number;
  inputTokens: number | null;
  outputTokens: number | null;
}

const byKey = (key: LabelKey) =>
  and(
    eq(drugSummaries.rxcui, key.rxcui),
    eq(drugSummaries.labelSetId, key.labelSetId),
    eq(drugSummaries.labelVersion, key.labelVersion),
  );

export function createSummaryRepository(db: Db) {
  return {
    async find(key: LabelKey): Promise<DrugSummary | null> {
      const [row] = await db.select().from(drugSummaries).where(byKey(key));
      return row ?? null;
    },

    /**
     * Claims the label for a new generation: inserts a pending row, or restarts a
     * failed one. Returns null when another request already holds it (pending/ready).
     */
    async claim(input: NewPendingSummary): Promise<DrugSummary | null> {
      const [inserted] = await db
        .insert(drugSummaries)
        .values({ ...input, status: 'pending' })
        .onConflictDoNothing()
        .returning();
      if (inserted) return inserted;
      const [restarted] = await db
        .update(drugSummaries)
        .set({
          status: 'pending',
          provider: input.provider,
          model: input.model,
          error: null,
          startedAt: sql`now()`,
          completedAt: null,
        })
        .where(and(byKey(input), eq(drugSummaries.status, 'failed')))
        .returning();
      return restarted ?? null;
    },

    async complete(id: string, result: CompletedSummary): Promise<void> {
      await db
        .update(drugSummaries)
        .set({ ...result, status: 'ready', error: null, completedAt: sql`now()` })
        .where(eq(drugSummaries.id, id));
    },

    async fail(id: string, error: string): Promise<void> {
      await db
        .update(drugSummaries)
        .set({ status: 'failed', error, completedAt: sql`now()` })
        .where(eq(drugSummaries.id, id));
    },

    /** Generations started today (in `timeZone`) with the given provider. */
    async startedToday(provider: DrugSummaryRow['provider'], timeZone: string): Promise<number> {
      const startOfDay = sql`(date_trunc('day', now() at time zone ${timeZone}) at time zone ${timeZone})`;
      const [row] = await db
        .select({ n: count() })
        .from(drugSummaries)
        .where(and(eq(drugSummaries.provider, provider), gte(drugSummaries.startedAt, startOfDay)));
      return row?.n ?? 0;
    },

    /** At startup nothing is generating, so any pending row was cut off by a restart. */
    async failInterrupted(): Promise<number> {
      const rows = await db
        .update(drugSummaries)
        .set({
          status: 'failed',
          error: 'Interrupted by a server restart.',
          completedAt: sql`now()`,
        })
        .where(eq(drugSummaries.status, 'pending'))
        .returning({ id: drugSummaries.id });
      return rows.length;
    },
  };
}

export type SummaryRepository = ReturnType<typeof createSummaryRepository>;
