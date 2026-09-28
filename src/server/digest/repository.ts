import { and, asc, count, desc, eq, gte, inArray, isNull, sql } from 'drizzle-orm';

import type { Db } from '../db/client';
import {
  digestItems,
  digestLabelVersions,
  digests,
  type DigestItemRow,
  type DigestRow,
} from '../db/schema';

export type Digest = DigestRow;
export type DigestItem = Omit<DigestItemRow, 'digestId' | 'position'>;
export type DigestKind = DigestItemRow['kind'];

type Optional =
  'ingredientRxcui' | 'productRxcui' | 'conditionId' | 'details' | 'takeaway' | 'externalId';
/** An item as a collector reports it. */
export type NewDigestItem = Pick<DigestItemRow, 'kind' | 'subject' | 'title' | 'url'> &
  Partial<Pick<DigestItemRow, Optional>>;

export interface LabelVersion {
  productRxcui: string;
  setId: string;
  version: string;
}

export interface DigestWithItems extends Digest {
  items: DigestItem[];
}

const toItem = (row: DigestItemRow): DigestItem => ({
  id: row.id,
  kind: row.kind,
  ingredientRxcui: row.ingredientRxcui,
  productRxcui: row.productRxcui,
  conditionId: row.conditionId,
  subject: row.subject,
  title: row.title,
  url: row.url,
  details: row.details,
  takeaway: row.takeaway,
  externalId: row.externalId,
  readAt: row.readAt,
});

/** How far back the page lists digests. */
export const HISTORY_WEEKS = 12;

export function createDigestRepository(db: Db) {
  return {
    /** Starts a run; null when one is already running. */
    async start(run: {
      trigger: Digest['trigger'];
      windowStart: string;
      windowEnd: string;
    }): Promise<Digest | null> {
      const [row] = await db
        .insert(digests)
        .values({ ...run, status: 'running' })
        .onConflictDoNothing()
        .returning();
      return row ?? null;
    },

    /** Stores everything the run found and marks it ready, all or nothing. */
    async finish(
      id: string,
      {
        items,
        notes,
        labelVersions = [],
      }: { items: NewDigestItem[]; notes: string[]; labelVersions?: LabelVersion[] },
    ): Promise<void> {
      await db.transaction(async (tx) => {
        if (items.length) {
          await tx
            .insert(digestItems)
            .values(items.map((item, position) => ({ ...item, digestId: id, position })));
        }
        for (const label of labelVersions) {
          await tx
            .insert(digestLabelVersions)
            .values(label)
            .onConflictDoUpdate({
              target: digestLabelVersions.productRxcui,
              set: { setId: label.setId, version: label.version, checkedAt: sql`now()` },
            });
        }
        await tx
          .update(digests)
          .set({ status: 'ready', finishedAt: sql`now()`, notes: notes.length ? notes : null })
          .where(eq(digests.id, id));
      });
    },

    async fail(id: string, error: string): Promise<void> {
      await db
        .update(digests)
        .set({ status: 'failed', finishedAt: sql`now()`, error })
        .where(eq(digests.id, id));
    },

    async running(): Promise<Digest | null> {
      const [row] = await db.select().from(digests).where(eq(digests.status, 'running'));
      return row ?? null;
    },

    /** The latest successful run, or null before the first one. */
    async lastSuccessful(): Promise<Digest | null> {
      const [row] = await db
        .select()
        .from(digests)
        .where(eq(digests.status, 'ready'))
        .orderBy(desc(digests.windowEnd), desc(digests.startedAt))
        .limit(1);
      return row ?? null;
    },

    /** Digests started in the last HISTORY_WEEKS weeks, newest first, with their items. */
    async recent(): Promise<DigestWithItems[]> {
      const rows = await db
        .select()
        .from(digests)
        .where(gte(digests.startedAt, sql`now() - make_interval(weeks => ${HISTORY_WEEKS})`))
        .orderBy(desc(digests.startedAt));
      if (!rows.length) return [];
      const items = await db
        .select()
        .from(digestItems)
        .where(
          inArray(
            digestItems.digestId,
            rows.map((r) => r.id),
          ),
        )
        .orderBy(asc(digestItems.position));
      return rows.map((row) => ({
        ...row,
        items: items.filter((item) => item.digestId === row.id).map(toItem),
      }));
    },

    async unreadCount(): Promise<number> {
      const [row] = await db
        .select({ n: count() })
        .from(digestItems)
        .where(isNull(digestItems.readAt));
      return row?.n ?? 0;
    },

    /** Marks a digest's items read; false when there is no such digest. */
    async markRead(id: string): Promise<boolean> {
      const [row] = await db.select({ id: digests.id }).from(digests).where(eq(digests.id, id));
      if (!row) return false;
      await db
        .update(digestItems)
        .set({ readAt: sql`now()` })
        .where(and(eq(digestItems.digestId, id), isNull(digestItems.readAt)));
      return true;
    },

    /** The given external ids already reported in an earlier digest. */
    async seen(kind: DigestKind, externalIds: string[]): Promise<Set<string>> {
      if (!externalIds.length) return new Set();
      const rows = await db
        .selectDistinct({ id: digestItems.externalId })
        .from(digestItems)
        .where(and(eq(digestItems.kind, kind), inArray(digestItems.externalId, externalIds)));
      return new Set(rows.map((r) => r.id).filter((id): id is string => id !== null));
    },

    async labelVersions(productRxcuis: string[]): Promise<Map<string, LabelVersion>> {
      if (!productRxcuis.length) return new Map();
      const rows = await db
        .select({
          productRxcui: digestLabelVersions.productRxcui,
          setId: digestLabelVersions.setId,
          version: digestLabelVersions.version,
        })
        .from(digestLabelVersions)
        .where(inArray(digestLabelVersions.productRxcui, productRxcuis));
      return new Map(rows.map((r) => [r.productRxcui, r]));
    },

    /** Records a Claude call before it's made, so the daily limit sees it. */
    async countClaudeCall(id: string): Promise<void> {
      await db
        .update(digests)
        .set({ claudeCalls: sql`${digests.claudeCalls} + 1` })
        .where(eq(digests.id, id));
    },

    /** Claude calls made by digests started today (in `timeZone`). */
    async claudeCallsToday(timeZone: string): Promise<number> {
      const startOfDay = sql`(date_trunc('day', now() at time zone ${timeZone}) at time zone ${timeZone})`;
      const [row] = await db
        .select({ n: sql<number>`coalesce(sum(${digests.claudeCalls}), 0)::int` })
        .from(digests)
        .where(gte(digests.startedAt, startOfDay));
      return row?.n ?? 0;
    },

    /** At startup nothing is running, so a running digest was cut off by a restart. */
    async failInterrupted(): Promise<number> {
      const rows = await db
        .update(digests)
        .set({
          status: 'failed',
          finishedAt: sql`now()`,
          error: 'Interrupted by a server restart.',
        })
        .where(eq(digests.status, 'running'))
        .returning({ id: digests.id });
      return rows.length;
    },
  };
}

export type DigestRepository = ReturnType<typeof createDigestRepository>;
