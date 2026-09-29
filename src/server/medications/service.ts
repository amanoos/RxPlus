import { createError } from 'h3';
import { z } from 'zod';

import { db } from '../db/client';
import { rxnav, type RxNavClient } from '../rxnorm';
import { toHttpError as rxnavHttpError } from '../rxnorm/errors';
import {
  createMedicationsRepository,
  DuplicateActiveMedicationError,
  type Medication,
  type UserMedications,
} from './repository';

const notes = z
  .string()
  .trim()
  .max(1000)
  .nullable()
  .transform((v) => (v ? v : null));
const isoDate = z.iso.date().nullable();

export const AddMedicationBody = z.object({
  rxcui: z.string().regex(/^\d{1,10}$/),
  notes: notes.optional(),
  startedOn: isoDate.optional(),
});
/** The condition a medication is taken for: a MED-RT disease from the drug's known uses. */
const takenFor = z
  .object({ id: z.string().regex(/^D\d{6,9}$/), name: z.string().trim().min(1).max(200) })
  .strict()
  .nullable();

/** Units: more than 0, at most 1000, in steps of 0.5 (half tablets). */
const units = z
  .number()
  .positive()
  .max(1000)
  .refine((n) => Number.isInteger(n * 2), 'must be a multiple of 0.5');
/** What the owner pays with insurance for one fill of `units`. */
const copay = z
  .object({ amountCents: z.number().int().min(0).max(1_000_000), units })
  .strict()
  .nullable();

export const UpdateMedicationBody = z
  .object({
    notes: notes.optional(),
    startedOn: isoDate.optional(),
    stoppedOn: isoDate.optional(),
    takenFor: takenFor.optional(),
    unitsPerMonth: units.optional(),
    copay: copay.optional(),
  })
  .strict();
export const MedicationIdParams = z.object({ id: z.uuid() });

const notFound = () => createError({ statusCode: 404, statusMessage: 'Medication not found.' });

function toHttpError(error: unknown): unknown {
  if (error instanceof DuplicateActiveMedicationError) {
    return createError({ statusCode: 409, statusMessage: error.message, message: error.message });
  }
  return rxnavHttpError(error);
}

/** One user's medications: `repo` is already scoped with forUser. */
export function createMedicationsService(repo: UserMedications, rxnavClient: RxNavClient) {
  return {
    list: () => repo.list(),

    async add(input: z.infer<typeof AddMedicationBody>): Promise<Medication> {
      try {
        // Always re-resolve on the server: stored drug data comes from RxNorm, never the client.
        const product = await rxnavClient.product(input.rxcui);
        if (!product) {
          throw createError({
            statusCode: 422,
            statusMessage: 'That is not a prescribable RxNorm product.',
          });
        }
        return await repo.create({
          rxcui: product.rxcui,
          tty: product.tty,
          name: product.name,
          strength: product.strength,
          doseForm: product.doseForm,
          brandName: product.brandName,
          ingredients: product.ingredients,
          notes: input.notes ?? null,
          startedOn: input.startedOn ?? null,
        });
      } catch (error) {
        throw toHttpError(error);
      }
    },

    async update(id: string, patch: z.infer<typeof UpdateMedicationBody>): Promise<Medication> {
      const existing = await repo.get(id);
      if (!existing) throw notFound();

      const startedOn = patch.startedOn !== undefined ? patch.startedOn : existing.startedOn;
      const stoppedOn = patch.stoppedOn !== undefined ? patch.stoppedOn : existing.stoppedOn;
      if (startedOn && stoppedOn && stoppedOn < startedOn) {
        throw createError({
          statusCode: 400,
          statusMessage: 'The stop date can’t be before the start date.',
        });
      }
      const { takenFor, copay, ...rest } = patch;
      const changes = {
        ...rest,
        ...(takenFor === undefined
          ? {}
          : { takenForId: takenFor?.id ?? null, takenForName: takenFor?.name ?? null }),
        ...(copay === undefined
          ? {}
          : { copayCents: copay?.amountCents ?? null, copayUnits: copay?.units ?? null }),
      };
      try {
        const updated = await repo.update(id, changes);
        if (!updated) throw notFound();
        return updated;
      } catch (error) {
        throw toHttpError(error);
      }
    },

    async remove(id: string): Promise<void> {
      if (!(await repo.remove(id))) throw notFound();
    },
  };
}

/** The signed-in user's medications, wired to the app database and RxNav client. */
export function medicationsService(userId: string) {
  return createMedicationsService(createMedicationsRepository(db()).forUser(userId), rxnav());
}
