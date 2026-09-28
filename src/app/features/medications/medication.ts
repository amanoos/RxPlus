/** A medication as returned by /api/medications (dates as ISO strings). */
export interface Medication {
  id: string;
  rxcui: string;
  tty: 'SCD' | 'SBD';
  name: string;
  strength: string | null;
  doseForm: string | null;
  brandName: string | null;
  ingredients: { rxcui: string; name: string }[];
  notes: string | null;
  /** YYYY-MM-DD */
  startedOn: string | null;
  /** YYYY-MM-DD; null while taking it. */
  stoppedOn: string | null;
  /** The condition it's taken for (MED-RT id and name), if set. */
  takenForId: string | null;
  takenForName: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface NewMedication {
  rxcui: string;
  notes?: string | null;
  startedOn?: string | null;
}

export type MedicationChanges = Partial<Pick<Medication, 'notes' | 'startedOn' | 'stoppedOn'>> & {
  /** null clears it. */
  takenFor?: { id: string; name: string } | null;
};
