import type { InteractionReport, InteractionResult } from './interaction';

/** Test helper: spironolactone (candidate) vs lisinopril (current), Major. */
export function resultFixture(overrides: Partial<InteractionResult> = {}): InteractionResult {
  return {
    a: {
      rxcui: '313096',
      name: 'spironolactone 25 MG Oral Tablet',
      ingredient: 'spironolactone',
      ingredientRxcui: '9997',
    },
    b: {
      rxcui: '314076',
      name: 'lisinopril 10 MG Oral Tablet',
      ingredient: 'lisinopril',
      ingredientRxcui: '29046',
      medicationId: 'm1',
    },
    level: 'Major',
    ...overrides,
  };
}

export function reportFixture(overrides: Partial<InteractionReport> = {}): InteractionReport {
  return {
    results: [resultFixture()],
    notCovered: [],
    source: {
      name: 'DDInter 2.0',
      license: 'CC BY-NC-SA 4.0',
      url: 'https://ddinter2.scbdd.com',
      importedAt: '2026-09-27T12:00:00.000Z',
    },
    ...overrides,
  };
}
