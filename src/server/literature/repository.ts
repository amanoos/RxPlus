import { and, asc, count, eq, gte, inArray, isNull, notInArray, sql } from 'drizzle-orm';

import type { Db } from '../db/client';
import {
  literatureHidden,
  literatureLists,
  literaturePapers,
  literatureTrials,
  type LiteratureListRow,
  type LiteraturePaperRow,
  type LiteratureTrialRow,
  type PaperTakeaway,
} from '../db/schema';

/** The page shows at most this many papers, of which at most MAX_REVIEWS reviews. */
export const MAX_PAPERS = 10;
export const MAX_REVIEWS = 4;

export type LiteratureList = LiteratureListRow;
export type LiteraturePaper = LiteraturePaperRow;
export type LiteratureTrial = LiteratureTrialRow;

export type FetchedPaper = Omit<LiteraturePaperRow, 'ingredientRxcui' | 'takeaway'>;
export type FetchedTrial = Omit<LiteratureTrialRow, 'ingredientRxcui'>;

export interface FetchedLiterature {
  ingredientRxcui: string;
  ingredientName: string;
  papers: FetchedPaper[];
  /** Omitted when trials couldn't be fetched: the stored ones are kept. */
  trials?: FetchedTrial[];
}

/** Reviews first (by rank, at most MAX_REVIEWS), then randomized trials, MAX_PAPERS in all. */
export function selectShown<T extends Pick<LiteraturePaperRow, 'tier' | 'rank'>>(papers: T[]): T[] {
  const byRank = (a: T, b: T) => a.rank - b.rank;
  const reviews = papers
    .filter((p) => p.tier === 'review')
    .sort(byRank)
    .slice(0, MAX_REVIEWS);
  const rcts = papers.filter((p) => p.tier === 'rct').sort(byRank);
  return [...reviews, ...rcts].slice(0, MAX_PAPERS);
}

export function createLiteratureRepository(db: Db) {
  return {
    async list(ingredientRxcui: string): Promise<LiteratureList | null> {
      const [row] = await db
        .select()
        .from(literatureLists)
        .where(eq(literatureLists.ingredientRxcui, ingredientRxcui));
      return row ?? null;
    },

    /**
     * Stores a fresh search. Papers still found keep their takeaway (and every
     * user's hides, which live in literature_hidden); papers no longer found are
     * dropped; trials are replaced.
     */
    async saveFetched({ ingredientRxcui, ingredientName, papers, trials }: FetchedLiterature) {
      await db.transaction(async (tx) => {
        await tx
          .insert(literatureLists)
          .values({ ingredientRxcui, ingredientName, fetchedAt: sql`now()` })
          .onConflictDoUpdate({
            target: literatureLists.ingredientRxcui,
            set: { ingredientName, fetchedAt: sql`now()` },
          });

        const pmids = papers.map((p) => p.pmid);
        await tx
          .delete(literaturePapers)
          .where(
            and(
              eq(literaturePapers.ingredientRxcui, ingredientRxcui),
              pmids.length ? notInArray(literaturePapers.pmid, pmids) : undefined,
            ),
          );
        for (const paper of papers) {
          // Search results only: the takeaway is left as it is.
          await tx
            .insert(literaturePapers)
            .values({ ...paper, ingredientRxcui })
            .onConflictDoUpdate({
              target: [literaturePapers.ingredientRxcui, literaturePapers.pmid],
              set: paper,
            });
        }

        if (trials) {
          await tx
            .delete(literatureTrials)
            .where(eq(literatureTrials.ingredientRxcui, ingredientRxcui));
          if (trials.length) {
            await tx
              .insert(literatureTrials)
              .values(trials.map((t) => ({ ...t, ingredientRxcui })));
          }
        }
      });
    },

    /** The papers the page shows this user (see selectShown): candidates they haven't hidden. */
    async shownPapers(ingredientRxcui: string, userId: string): Promise<LiteraturePaper[]> {
      const hiddenByUser = db
        .select({ pmid: literatureHidden.pmid })
        .from(literatureHidden)
        .where(
          and(
            eq(literatureHidden.userId, userId),
            eq(literatureHidden.ingredientRxcui, ingredientRxcui),
          ),
        );
      const visible = await db
        .select()
        .from(literaturePapers)
        .where(
          and(
            eq(literaturePapers.ingredientRxcui, ingredientRxcui),
            notInArray(literaturePapers.pmid, hiddenByUser),
          ),
        );
      return selectShown(visible);
    },

    /** This user's hidden papers that are still candidates, oldest hide first. */
    async hiddenPapers(ingredientRxcui: string, userId: string): Promise<LiteraturePaper[]> {
      const rows = await db
        .select({ paper: literaturePapers })
        .from(literaturePapers)
        .innerJoin(
          literatureHidden,
          and(
            eq(literatureHidden.ingredientRxcui, literaturePapers.ingredientRxcui),
            eq(literatureHidden.pmid, literaturePapers.pmid),
          ),
        )
        .where(
          and(
            eq(literaturePapers.ingredientRxcui, ingredientRxcui),
            eq(literatureHidden.userId, userId),
          ),
        )
        .orderBy(asc(literatureHidden.hiddenAt));
      return rows.map((r) => r.paper);
    },

    /** Hides or unhides a paper for one user; false when it isn't a candidate for that ingredient. */
    async setHidden(
      userId: string,
      ingredientRxcui: string,
      pmid: string,
      hidden: boolean,
    ): Promise<boolean> {
      const [candidate] = await db
        .select({ pmid: literaturePapers.pmid })
        .from(literaturePapers)
        .where(
          and(
            eq(literaturePapers.ingredientRxcui, ingredientRxcui),
            eq(literaturePapers.pmid, pmid),
          ),
        );
      if (!candidate) return false;
      if (hidden) {
        await db
          .insert(literatureHidden)
          .values({ userId, ingredientRxcui, pmid })
          .onConflictDoNothing();
      } else {
        await db
          .delete(literatureHidden)
          .where(
            and(
              eq(literatureHidden.userId, userId),
              eq(literatureHidden.ingredientRxcui, ingredientRxcui),
              eq(literatureHidden.pmid, pmid),
            ),
          );
      }
      return true;
    },

    async trials(ingredientRxcui: string): Promise<LiteratureTrial[]> {
      return db
        .select()
        .from(literatureTrials)
        .where(eq(literatureTrials.ingredientRxcui, ingredientRxcui))
        .orderBy(asc(literatureTrials.rank));
    },

    /**
     * Marks the ingredient's takeaways as being generated; null when a
     * generation is already running (or the list doesn't exist).
     */
    async claimTakeaways(
      ingredientRxcui: string,
      provider: NonNullable<LiteratureListRow['provider']>,
      model: string,
    ): Promise<LiteratureList | null> {
      const [row] = await db
        .update(literatureLists)
        .set({
          takeawayStatus: 'pending',
          provider,
          model,
          error: null,
          startedAt: sql`now()`,
        })
        .where(
          and(
            eq(literatureLists.ingredientRxcui, ingredientRxcui),
            sql`${literatureLists.takeawayStatus} <> 'pending'`,
          ),
        )
        .returning();
      return row ?? null;
    },

    /** Stores takeaways by PMID and marks the job ready. */
    async completeTakeaways(
      ingredientRxcui: string,
      takeaways: Map<string, PaperTakeaway>,
      tokens: { inputTokens: number | null; outputTokens: number | null },
    ): Promise<void> {
      await db.transaction(async (tx) => {
        for (const [pmid, takeaway] of takeaways) {
          await tx
            .update(literaturePapers)
            .set({ takeaway })
            .where(
              and(
                eq(literaturePapers.ingredientRxcui, ingredientRxcui),
                eq(literaturePapers.pmid, pmid),
              ),
            );
        }
        await tx
          .update(literatureLists)
          .set({ takeawayStatus: 'ready', error: null, ...tokens })
          .where(eq(literatureLists.ingredientRxcui, ingredientRxcui));
      });
    },

    async failTakeaways(ingredientRxcui: string, error: string): Promise<void> {
      await db
        .update(literatureLists)
        .set({ takeawayStatus: 'failed', error })
        .where(eq(literatureLists.ingredientRxcui, ingredientRxcui));
    },

    /** Takeaway generations started today (in `timeZone`) with the given provider. */
    async startedToday(
      provider: NonNullable<LiteratureListRow['provider']>,
      timeZone: string,
    ): Promise<number> {
      const startOfDay = sql`(date_trunc('day', now() at time zone ${timeZone}) at time zone ${timeZone})`;
      const [row] = await db
        .select({ n: count() })
        .from(literatureLists)
        .where(
          and(eq(literatureLists.provider, provider), gte(literatureLists.startedAt, startOfDay)),
        );
      return row?.n ?? 0;
    },

    /** At startup nothing is generating, so pending work was cut off by a restart. */
    async failInterrupted(): Promise<number> {
      const rows = await db
        .update(literatureLists)
        .set({ takeawayStatus: 'failed', error: 'Interrupted by a server restart.' })
        .where(eq(literatureLists.takeawayStatus, 'pending'))
        .returning({ id: literatureLists.ingredientRxcui });
      return rows.length;
    },

    /** Papers among `pmids` that still lack a takeaway (for the next generation). */
    async withoutTakeaway(ingredientRxcui: string, pmids: string[]): Promise<LiteraturePaper[]> {
      if (!pmids.length) return [];
      return db
        .select()
        .from(literaturePapers)
        .where(
          and(
            eq(literaturePapers.ingredientRxcui, ingredientRxcui),
            inArray(literaturePapers.pmid, pmids),
            isNull(literaturePapers.takeaway),
          ),
        );
    },
  };
}

export type LiteratureRepository = ReturnType<typeof createLiteratureRepository>;
