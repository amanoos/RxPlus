import { desc, eq, sql } from 'drizzle-orm';

import type { Db } from '../db/client';
import { medications, type MedicationRow } from '../db/schema';

export type Medication = MedicationRow;
export type NewMedication = Omit<
  MedicationRow,
  'id' | 'stoppedOn' | 'createdAt' | 'updatedAt' | 'takenForId' | 'takenForName'
>;
export type MedicationPatch = Partial<
  Pick<MedicationRow, 'notes' | 'startedOn' | 'stoppedOn' | 'takenForId' | 'takenForName'>
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
    /** Active first (newest first), then stopped (newest first). */
    list(): Promise<Medication[]> {
      return db
        .select()
        .from(medications)
        .orderBy(sql`${medications.stoppedOn} is null desc`, desc(medications.createdAt));
    },

    async get(id: string): Promise<Medication | null> {
      const [row] = await db.select().from(medications).where(eq(medications.id, id));
      return row ?? null;
    },

    async create(input: NewMedication): Promise<Medication> {
      const [row] = await mapDuplicate(db.insert(medications).values(input).returning());
      return row;
    },

    async update(id: string, patch: MedicationPatch): Promise<Medication | null> {
      const [row] = await mapDuplicate(
        db
          .update(medications)
          // Database clock, like the defaultNow() on insert.
          .set({ ...patch, updatedAt: sql`now()` })
          .where(eq(medications.id, id))
          .returning(),
      );
      return row ?? null;
    },

    async remove(id: string): Promise<boolean> {
      const deleted = await db
        .delete(medications)
        .where(eq(medications.id, id))
        .returning({ id: medications.id });
      return deleted.length > 0;
    },
  };
}

export type MedicationsRepository = ReturnType<typeof createMedicationsRepository>;
