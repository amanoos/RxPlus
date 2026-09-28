// @vitest-environment node
import { monthlyCost, totals } from './math';

describe('pricing math', () => {
  it('works out cash and insured per month, and which is cheaper', () => {
    // Lisinopril: 30 tablets at $0.0131, copay $10 per 90.
    expect(
      monthlyCost({ unitsPerMonth: 30, unitPrice: 0.0131, copayCents: 1000, copayUnits: 90 }),
    ).toEqual({ cashCents: 39, insuredCents: 333, cheaper: 'cash', savingsCents: 294 });
    expect(
      monthlyCost({ unitsPerMonth: 60, unitPrice: 0.5, copayCents: 500, copayUnits: 30 }),
    ).toEqual({ cashCents: 3000, insuredCents: 1000, cheaper: 'insurance', savingsCents: 2000 });
    expect(
      monthlyCost({ unitsPerMonth: 30, unitPrice: 0.1, copayCents: 300, copayUnits: 30 }),
    ).toMatchObject({ cheaper: 'same', savingsCents: 0 });
  });

  it('handles half units and gives no comparison when a figure is missing', () => {
    expect(
      monthlyCost({ unitsPerMonth: 15.5, unitPrice: 0.0131, copayCents: null, copayUnits: null }),
    ).toEqual({ cashCents: 20, insuredCents: null, cheaper: null, savingsCents: null });
    expect(
      monthlyCost({ unitsPerMonth: 30, unitPrice: null, copayCents: 1000, copayUnits: 0 }),
    ).toEqual({ cashCents: null, insuredCents: null, cheaper: null, savingsCents: null });
  });

  it('totals the known figures and counts what is missing', () => {
    expect(
      totals([
        { cashCents: 39, insuredCents: 333, cheaper: 'cash', savingsCents: 294 },
        { cashCents: 42, insuredCents: null, cheaper: null, savingsCents: null },
        { cashCents: null, insuredCents: 1500, cheaper: null, savingsCents: null },
      ]),
    ).toEqual({
      cashCents: 81,
      insuredCents: 1833,
      medications: 3,
      missingPrice: 1,
      missingCopay: 1,
    });
  });
});
