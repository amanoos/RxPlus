/**
 * Monthly cost figures, in whole cents (one rounding step each). No figure is
 * made up: a missing price or copay gives null, and totals count what's missing.
 */

export interface CostInputs {
  unitsPerMonth: number;
  /** Cost Plus billed price per unit in dollars, or null when there is none. */
  unitPrice: number | null;
  copayCents: number | null;
  copayUnits: number | null;
}

export interface MonthlyCost {
  cashCents: number | null;
  insuredCents: number | null;
  /** Which is cheaper per month, when both are known. */
  cheaper: 'cash' | 'insurance' | 'same' | null;
  /** By how much, in cents (0 when the same; null when not comparable). */
  savingsCents: number | null;
}

export function monthlyCost({
  unitsPerMonth,
  unitPrice,
  copayCents,
  copayUnits,
}: CostInputs): MonthlyCost {
  const cashCents = unitPrice === null ? null : Math.round(unitsPerMonth * unitPrice * 100);
  const insuredCents =
    copayCents === null || !copayUnits
      ? null
      : Math.round((copayCents * unitsPerMonth) / copayUnits);
  if (cashCents === null || insuredCents === null) {
    return { cashCents, insuredCents, cheaper: null, savingsCents: null };
  }
  const cheaper =
    cashCents < insuredCents ? 'cash' : cashCents > insuredCents ? 'insurance' : 'same';
  return { cashCents, insuredCents, cheaper, savingsCents: Math.abs(cashCents - insuredCents) };
}

export interface CostTotals {
  /** Sum of the known cash figures. */
  cashCents: number;
  /** Sum of the known insured figures. */
  insuredCents: number;
  medications: number;
  missingPrice: number;
  missingCopay: number;
}

export function totals(costs: MonthlyCost[]): CostTotals {
  const sum = (values: (number | null)[]) => values.reduce<number>((a, v) => a + (v ?? 0), 0);
  return {
    cashCents: sum(costs.map((c) => c.cashCents)),
    insuredCents: sum(costs.map((c) => c.insuredCents)),
    medications: costs.length,
    missingPrice: costs.filter((c) => c.cashCents === null).length,
    missingCopay: costs.filter((c) => c.insuredCents === null).length,
  };
}
