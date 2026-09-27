import {
  date,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

/** A verified summary section, as shown on the drug page. */
export interface StoredSummarySection {
  heading: string;
  sentences: {
    text: string;
    citations: { labelSection: string; text: string }[];
    uncited: boolean;
    noSupport?: true;
  }[];
}

/** One AI summary per product and FDA label version, reused until the label changes. */
export const drugSummaries = pgTable(
  'drug_summaries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** RxNorm product (SCD/SBD). */
    rxcui: text('rxcui').notNull(),
    labelSetId: text('label_set_id').notNull(),
    /** openFDA label "version". */
    labelVersion: text('label_version').notNull(),
    labelEffectiveDate: date('label_effective_date'),
    status: text('status', { enum: ['pending', 'ready', 'failed'] }).notNull(),
    provider: text('provider', { enum: ['ollama', 'claude'] }).notNull(),
    model: text('model').notNull(),
    sections: jsonb('sections').$type<StoredSummarySection[]>(),
    /** Claims (sentences other than "the label doesn't say"). */
    sentenceCount: integer('sentence_count'),
    uncitedCount: integer('uncited_count'),
    removedAdvice: integer('removed_advice'),
    inputTokens: integer('input_tokens'),
    outputTokens: integer('output_tokens'),
    error: text('error'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    /** Latest (re)start; the Claude daily limit counts these. */
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (t) => [uniqueIndex('drug_summaries_label_idx').on(t.rxcui, t.labelSetId, t.labelVersion)],
);

export type DrugSummaryRow = typeof drugSummaries.$inferSelect;
