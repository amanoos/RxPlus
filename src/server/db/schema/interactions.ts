import { index, integer, pgTable, primaryKey, serial, text, timestamp } from 'drizzle-orm/pg-core';

/** A drug in DDInter 2.0 (https://ddinter2.scbdd.com, CC BY-NC-SA 4.0), mapped to RxNorm. */
export const ddiDrugs = pgTable(
  'ddi_drugs',
  {
    ddinterId: text('ddinter_id').primaryKey(),
    name: text('name').notNull(),
    /** Non-systemic route from a "(topical)"-style suffix; null = systemic/any. */
    route: text('route'),
    /** RxNorm ingredient (IN); null when the name couldn't be mapped. */
    ingredientRxcui: text('ingredient_rxcui'),
  },
  (t) => [index('ddi_drugs_ingredient_idx').on(t.ingredientRxcui)],
);

/** One row per unordered pair (drugA < drugB) at its most severe level. */
export const ddiInteractions = pgTable(
  'ddi_interactions',
  {
    drugA: text('drug_a').notNull(),
    drugB: text('drug_b').notNull(),
    level: text('level', { enum: ['Major', 'Moderate', 'Minor', 'Unknown'] }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.drugA, t.drugB] }), index('ddi_interactions_b_idx').on(t.drugB)],
);

export const ddiImports = pgTable('ddi_imports', {
  id: serial('id').primaryKey(),
  importedAt: timestamp('imported_at', { withTimezone: true }).notNull().defaultNow(),
  pairs: integer('pairs').notNull(),
  drugs: integer('drugs').notNull(),
  mappedDrugs: integer('mapped_drugs').notNull(),
});

export type DdiDrugRow = typeof ddiDrugs.$inferSelect;
