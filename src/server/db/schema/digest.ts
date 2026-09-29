import { sql } from 'drizzle-orm';
import {
  date,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import type { PaperTakeaway } from './literature';
import { users } from './users';

/** One weekly run and what it found. Items are written only when the run finishes. */
export const digests = pgTable(
  'digests',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** Whose digest this is (SPEC-per-user-digest.md). */
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    status: text('status', { enum: ['running', 'ready', 'failed'] }).notNull(),
    trigger: text('trigger', { enum: ['schedule', 'manual', 'catch-up'] }).notNull(),
    /** Inclusive dates the run covers (YYYY-MM-DD). */
    windowStart: date('window_start').notNull(),
    windowEnd: date('window_end').notNull(),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    error: text('error'),
    /** e.g. "Takeaways for metformin couldn't be written". */
    notes: jsonb('notes').$type<string[]>(),
    /** Claude takeaway calls made by the run; they count toward AI_DAILY_LIMIT. */
    claudeCalls: integer('claude_calls').notNull().default(0),
  },
  // One run at a time per user.
  (t) => [
    uniqueIndex('digests_one_running')
      .on(t.userId)
      .where(sql`${t.status} = 'running'`),
    index('digests_user_id_idx').on(t.userId),
  ],
);

export interface DigestItemDetails {
  /** paper */
  journal?: string | null;
  year?: number | null;
  studyType?: string;
  /** Who or what was studied, from the title and abstract (review, animal, lab, human). */
  studySubject?: 'review' | 'animal' | 'lab' | 'human' | null;
  /** more-papers: papers in the window not listed */
  count?: number;
  /** trial */
  nctId?: string;
  event?: 'new' | 'results';
  status?: string;
  phases?: string[];
  /** approval: the condition's name; first approval date */
  condition?: string;
  firstApproved?: string | null;
  /** label: effective date (YYYY-MM-DD) and DailyMed link */
  labelDate?: string | null;
  dailyMedUrl?: string | null;
}

export const digestItems = pgTable(
  'digest_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    digestId: uuid('digest_id')
      .notNull()
      .references(() => digests.id, { onDelete: 'cascade' }),
    kind: text('kind', { enum: ['paper', 'more-papers', 'trial', 'approval', 'label'] }).notNull(),
    /** Order within the digest (collectors' order: relevance, then kind). */
    position: integer('position').notNull(),
    ingredientRxcui: text('ingredient_rxcui'),
    productRxcui: text('product_rxcui'),
    conditionId: text('condition_id'),
    /** The drug or condition the item is about. */
    subject: text('subject').notNull(),
    title: text('title').notNull(),
    url: text('url').notNull(),
    details: jsonb('details').$type<DigestItemDetails>(),
    takeaway: jsonb('takeaway').$type<PaperTakeaway>(),
    /** PMID, NCT id + event, condition + ingredient, or set id + version: never reported twice. */
    externalId: text('external_id'),
    readAt: timestamp('read_at', { withTimezone: true }),
  },
  (t) => [
    index('digest_items_digest').on(t.digestId),
    index('digest_items_external').on(t.kind, t.externalId),
  ],
);

/**
 * The label version a user last saw per product; their first sight is a baseline,
 * not a change. Per user, so one user's run can't hide a change from another.
 */
export const digestLabelVersions = pgTable(
  'digest_label_versions',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    productRxcui: text('product_rxcui').notNull(),
    setId: text('set_id').notNull(),
    version: text('version').notNull(),
    checkedAt: timestamp('checked_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.productRxcui] })],
);

export type DigestRow = typeof digests.$inferSelect;
export type DigestItemRow = typeof digestItems.$inferSelect;
