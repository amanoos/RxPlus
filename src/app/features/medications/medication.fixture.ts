import type { Medication } from './medication';

/** Test helper: a valid medication with overrides. */
export function medicationFixture(overrides: Partial<Medication> = {}): Medication {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    rxcui: '314076',
    tty: 'SCD',
    name: 'lisinopril 10 MG Oral Tablet',
    strength: '10 MG',
    doseForm: 'Oral Tablet',
    brandName: null,
    ingredients: [{ rxcui: '29046', name: 'lisinopril' }],
    notes: null,
    startedOn: '2026-01-15',
    stoppedOn: null,
    takenForId: null,
    takenForName: null,
    createdAt: '2026-01-15T12:00:00.000Z',
    updatedAt: '2026-01-15T12:00:00.000Z',
    ...overrides,
  };
}
