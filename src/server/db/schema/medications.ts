import { sql } from 'drizzle-orm';
import {
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { users } from './users';

export interface Ingredient {
  rxcui: string;
  name: string;
}

export const medications = pgTable(
  'medications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** Whose list this is (SPEC-per-user-medications.md). */
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
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
    /** The condition it's taken for (MED-RT disease), e.g. D006973 Hypertension. */
    takenForId: text('taken_for_id'),
    takenForName: text('taken_for_name'),
    /** Pricing: units used a month (e.g. 60 for twice daily). */
    unitsPerMonth: numeric('units_per_month', { precision: 6, scale: 1, mode: 'number' })
      .notNull()
      .default(30),
    /** Pricing: what the owner pays with insurance per fill (null when not entered). */
    copayCents: integer('copay_cents'),
    /** Pricing: units in that fill. Set together with copayCents. */
    copayUnits: numeric('copay_units', { precision: 6, scale: 1, mode: 'number' }),
    /** Null while the owner is taking it. */
    stoppedOn: date('stopped_on'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // A product can be on one user's active list only once.
    uniqueIndex('medications_active_rxcui_idx')
      .on(t.userId, t.rxcui)
      .where(sql`${t.stoppedOn} is null`),
    index('medications_user_id_idx').on(t.userId),
  ],
);

export type MedicationRow = typeof medications.$inferSelect;
export type NewMedicationRow = typeof medications.$inferInsert;
