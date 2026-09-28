import type { CostRow, CostsResponse, MedicationCost, PricesResponse } from './pricing';

/** Test helpers: lisinopril 10 MG at Cost Plus, copay $10 per 90. */
export function medicationCostFixture(overrides: Partial<MedicationCost> = {}): MedicationCost {
  return {
    medicationId: '11111111-1111-4111-8111-111111111111',
    unitsPerMonth: 30,
    copayCents: 1000,
    copayUnits: 90,
    cashCents: 39,
    insuredCents: 333,
    cheaper: 'cash',
    savingsCents: 294,
    ...overrides,
  };
}

export function pricesFixture(overrides: Partial<PricesResponse> = {}): PricesResponse {
  return {
    rxcui: '314076',
    status: 'found',
    price: {
      unitPrice: 0.0131,
      strength: '10mg',
      form: 'Tablet',
      url: 'https://www.costplusdrugs.com/medications/lisinopril-10mg-tablet/',
    },
    asOf: '2026-09-28T13:14:00.000Z',
    medication: null,
    defaultMonthlyCents: 39,
    ...overrides,
  };
}

export function costRowFixture(overrides: Partial<CostRow> = {}): CostRow {
  const { medication: _m, defaultMonthlyCents: _d, ...price } = pricesFixture();
  void _m;
  void _d;
  return {
    ...price,
    ...medicationCostFixture(),
    name: 'lisinopril 10 MG Oral Tablet',
    ...overrides,
  };
}

export function costsFixture(overrides: Partial<CostsResponse> = {}): CostsResponse {
  return {
    rows: [costRowFixture()],
    totals: { cashCents: 39, insuredCents: 333, medications: 1, missingPrice: 0, missingCopay: 0 },
    ...overrides,
  };
}
