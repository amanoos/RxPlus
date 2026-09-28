import { boolean, date, integer, pgTable, primaryKey, text, timestamp } from 'drizzle-orm/pg-core';

/**
 * A stored list of alternatives, shared by every drug it applies to:
 * `class:<EPC id>` (drugs in an FDA class) or `condition:<MED-RT id>` (drugs for a condition).
 */
export const alternativeLists = pgTable('alternative_lists', {
  key: text('key').primaryKey(),
  kind: text('kind', { enum: ['class', 'condition'] }).notNull(),
  /** e.g. "Angiotensin Converting Enzyme Inhibitor" or "Hypertension". */
  name: text('name').notNull(),
  status: text('status', { enum: ['pending', 'ready', 'failed'] }).notNull(),
  /** Latest build start. */
  startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
  builtAt: timestamp('built_at', { withTimezone: true }),
  /** Ingredients left out after upstream errors in the last build. */
  skipped: integer('skipped'),
  error: text('error'),
});

export const alternativeDrugs = pgTable(
  'alternative_drugs',
  {
    listKey: text('list_key').notNull(),
    ingredientRxcui: text('ingredient_rxcui').notNull(),
    name: text('name').notNull(),
    /** FDA established pharmacologic class. */
    classId: text('class_id'),
    className: text('class_name'),
    /** Earliest original NDA approval (Drugs@FDA). */
    firstApproved: date('first_approved'),
    genericAvailable: boolean('generic_available').notNull(),
    /** A representative US product, for the link to its drug page. */
    productRxcui: text('product_rxcui'),
  },
  (t) => [primaryKey({ columns: [t.listKey, t.ingredientRxcui] })],
);

/** Alternatives the owner hid while looking at a drug (per ingredient). */
export const alternativeHidden = pgTable(
  'alternative_hidden',
  {
    ingredientRxcui: text('ingredient_rxcui').notNull(),
    hiddenRxcui: text('hidden_rxcui').notNull(),
    hiddenAt: timestamp('hidden_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.ingredientRxcui, t.hiddenRxcui] })],
);

export type AlternativeListRow = typeof alternativeLists.$inferSelect;
export type AlternativeDrugRow = typeof alternativeDrugs.$inferSelect;
