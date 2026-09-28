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
  /** Units used a month (default 30). */
  unitsPerMonth: number;
  /** What a fill costs with insurance, and its size (both null when not entered). */
  copayCents: number | null;
  copayUnits: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface NewMedication {
  rxcui: string;
  notes?: string | null;
  startedOn?: string | null;
}

export type MedicationChanges = Partial<
  Pick<Medication, 'notes' | 'startedOn' | 'stoppedOn' | 'unitsPerMonth'>
> & {
  /** null clears it. */
  takenFor?: { id: string; name: string } | null;
  /** null clears it. */
  copay?: { amountCents: number; units: number } | null;
};
