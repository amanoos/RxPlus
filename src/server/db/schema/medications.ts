import { sql } from 'drizzle-orm';
import { date, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

export interface Ingredient {
  rxcui: string;
  name: string;
}

export const medications = pgTable(
  'medications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** RxNorm product (SCD generic or SBD branded). */
    rxcui: text('rxcui').notNull(),
    tty: text('tty', { enum: ['SCD', 'SBD'] }).notNull(),
    name: text('name').notNull(),
    strength: text('strength'),
    doseForm: text('dose_form'),
    brandName: text('brand_name'),
    ingredients: jsonb('ingredients').$type<Ingredient[]>().notNull(),
    notes: text('notes'),
    startedOn: date('started_on'),
    /** Null while the owner is taking it. */
    stoppedOn: date('stopped_on'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // A product can be on the active list only once.
    uniqueIndex('medications_active_rxcui_idx')
      .on(t.rxcui)
      .where(sql`${t.stoppedOn} is null`),
  ],
);

export type MedicationRow = typeof medications.$inferSelect;
export type NewMedicationRow = typeof medications.$inferInsert;
