import { and, desc, eq, isNull, sql } from 'drizzle-orm';

import type { Db } from '../db/client';
import { medications, type MedicationRow } from '../db/schema';

export type Medication = MedicationRow;
/** RxNorm product data as stored with a medication (no user data). */
export type SavedProduct = Pick<
  MedicationRow,
  'rxcui' | 'tty' | 'name' | 'strength' | 'doseForm' | 'brandName' | 'ingredients'
>;
export type NewMedication = Omit<
  MedicationRow,
  | 'id'
  | 'userId'
  | 'stoppedOn'
  | 'createdAt'
  | 'updatedAt'
  | 'takenForId'
  | 'takenForName'
  | 'unitsPerMonth'
  | 'copayCents'
  | 'copayUnits'
>;
export type MedicationPatch = Partial<
  Pick<
    MedicationRow,
    | 'notes'
    | 'startedOn'
    | 'stoppedOn'
    | 'takenForId'
    | 'takenForName'
    | 'unitsPerMonth'
    | 'copayCents'
    | 'copayUnits'
  >
>;

/** The product is already on the active list (unique index medications_active_rxcui_idx). */
export class DuplicateActiveMedicationError extends Error {
  override readonly name = 'DuplicateActiveMedicationError';
}

const UNIQUE_VIOLATION = '23505';

function isUniqueViolation(error: unknown): boolean {
  // Drizzle wraps the pg error in `cause`.
  const code = (e: unknown) => (e as { code?: string } | undefined)?.code;
  return (
    code(error) === UNIQUE_VIOLATION ||
    code((error as { cause?: unknown })?.cause) === UNIQUE_VIOLATION
  );
}

async function mapDuplicate<T>(work: Promise<T>): Promise<T> {
  try {
    return await work;
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new DuplicateActiveMedicationError('This medication is already on your active list.');
    }
    throw error;
  }
}

export function createMedicationsRepository(db: Db) {
  return {
    /** One user's list: every query is filtered by (and every insert sets) user_id. */
    forUser(userId: string) {
      const mine = eq(medications.userId, userId);
      const byId = (id: string) => and(mine, eq(medications.id, id));
      return {
        /** Active first (newest first), then stopped (newest first). */
        list(): Promise<Medication[]> {
          return db
            .select()
            .from(medications)
            .where(mine)
            .orderBy(sql`${medications.stoppedOn} is null desc`, desc(medications.createdAt));
        },

        async get(id: string): Promise<Medication | null> {
          const [row] = await db.select().from(medications).where(byId(id));
          return row ?? null;
        },

        async create(input: NewMedication): Promise<Medication> {
          const [row] = await mapDuplicate(
            db
              .insert(medications)
              .values({ ...input, userId })
              .returning(),
          );
          return row;
        },

        async update(id: string, patch: MedicationPatch): Promise<Medication | null> {
          const [row] = await mapDuplicate(
            db
              .update(medications)
              // Database clock, like the defaultNow() on insert.
              .set({ ...patch, updatedAt: sql`now()` })
              .where(byId(id))
              .returning(),
          );
          return row ?? null;
        },

        async remove(id: string): Promise<boolean> {
          const deleted = await db
            .delete(medications)
            .where(byId(id))
            .returning({ id: medications.id });
          return deleted.length > 0;
        },
      };
    },

    /**
     * RxNorm details of a product anyone has saved, to skip an RxNav call. Product
     * columns only: never notes, dates, copays or who saved it.
     */
    async productByRxcui(rxcui: string): Promise<SavedProduct | null> {
      const [row] = await db
        .select({
          rxcui: medications.rxcui,
          tty: medications.tty,
          name: medications.name,
          strength: medications.strength,
          doseForm: medications.doseForm,
          brandName: medications.brandName,
          ingredients: medications.ingredients,
        })
        .from(medications)
        .where(eq(medications.rxcui, rxcui))
        .limit(1);
      return row ?? null;
    },

    /** Users with at least one active medication: who the weekly digest runs for. */
    async usersWithActiveMedications(): Promise<string[]> {
      const rows = await db
        .selectDistinct({ userId: medications.userId })
        .from(medications)
        .where(isNull(medications.stoppedOn));
      return rows.map((r) => r.userId);
    },
  };
}

export type MedicationsRepository = ReturnType<typeof createMedicationsRepository>;
/** One user's list, as the request path sees it. */
export type UserMedications = ReturnType<MedicationsRepository['forUser']>;
