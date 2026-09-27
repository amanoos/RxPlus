import { boolean, integer, jsonb, pgTable, primaryKey, text, timestamp } from 'drizzle-orm/pg-core';

/** One per ingredient: when its papers and trials were fetched, and the takeaway job state. */
export const literatureLists = pgTable('literature_lists', {
  ingredientRxcui: text('ingredient_rxcui').primaryKey(),
  ingredientName: text('ingredient_name').notNull(),
  fetchedAt: timestamp('fetched_at', { withTimezone: true }).notNull(),
  takeawayStatus: text('takeaway_status', { enum: ['none', 'pending', 'ready', 'failed'] })
    .notNull()
    .default('none'),
  provider: text('provider', { enum: ['ollama', 'claude'] }),
  model: text('model'),
  error: text('error'),
  /** Latest takeaway generation start; the Claude daily limit counts these. */
  startedAt: timestamp('started_at', { withTimezone: true }),
  inputTokens: integer('input_tokens'),
  outputTokens: integer('output_tokens'),
});

export interface PaperTakeaway {
  text: string;
  /** Abstract words the takeaway is based on; null when none could be verified. */
  quote: string | null;
  uncited: boolean;
  /**
   * Second check: does the quote on its own support the takeaway? null when not
   * checked (no quote, Claude, or the check failed).
   */
  supported?: boolean | null;
}

/** Candidate papers per ingredient (up to 20 per tier); the page shows the first 10 not hidden. */
export const literaturePapers = pgTable(
  'literature_papers',
  {
    ingredientRxcui: text('ingredient_rxcui').notNull(),
    pmid: text('pmid').notNull(),
    tier: text('tier', { enum: ['review', 'rct'] }).notNull(),
    /** Position within the tier, from PubMed's relevance order (0 first). */
    rank: integer('rank').notNull(),
    title: text('title').notNull(),
    journal: text('journal'),
    year: integer('year'),
    pubTypes: jsonb('pub_types').$type<string[]>().notNull(),
    studyType: text('study_type', {
      enum: ['meta-analysis', 'systematic-review', 'rct', 'other'],
    }).notNull(),
    doi: text('doi'),
    pmcid: text('pmcid'),
    /** Input for the AI only; never sent to the page. */
    abstract: text('abstract').notNull(),
    takeaway: jsonb('takeaway').$type<PaperTakeaway>(),
    hiddenAt: timestamp('hidden_at', { withTimezone: true }),
  },
  (t) => [primaryKey({ columns: [t.ingredientRxcui, t.pmid] })],
);

export const literatureTrials = pgTable(
  'literature_trials',
  {
    ingredientRxcui: text('ingredient_rxcui').notNull(),
    nctId: text('nct_id').notNull(),
    rank: integer('rank').notNull(),
    title: text('title').notNull(),
    status: text('status').notNull(),
    phases: jsonb('phases').$type<string[]>().notNull(),
    hasResults: boolean('has_results').notNull(),
    startDate: text('start_date'),
    lastUpdate: text('last_update'),
  },
  (t) => [primaryKey({ columns: [t.ingredientRxcui, t.nctId] })],
);

export type LiteratureListRow = typeof literatureLists.$inferSelect;
export type LiteraturePaperRow = typeof literaturePapers.$inferSelect;
export type LiteratureTrialRow = typeof literatureTrials.$inferSelect;
