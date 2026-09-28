/** Client-side shapes of /api/drugs/:rxcui/prices and /api/costs. */

export type PriceStatus = 'found' | 'not-sold' | 'unavailable';

export interface CostPlusPrice {
  /** Billed dollars per unit. */
  unitPrice: number;
  strength: string;
  form: string;
  url: string;
}

export interface ProductPrice {
  rxcui: string;
  status: PriceStatus;
  price: CostPlusPrice | null;
  /** ISO time Cost Plus answered. */
  asOf: string | null;
}

export interface MedicationCost {
  medicationId: string;
  unitsPerMonth: number;
  copayCents: number | null;
  copayUnits: number | null;
  cashCents: number | null;
  insuredCents: number | null;
  cheaper: 'cash' | 'insurance' | 'same' | null;
  savingsCents: number | null;
}

export interface PricesResponse extends ProductPrice {
  medication: MedicationCost | null;
  /** Monthly cash cost for 30 units, for products not on the list. */
  defaultMonthlyCents: number | null;
}

export interface CostRow extends ProductPrice, MedicationCost {
  name: string;
}

export interface CostTotals {
  cashCents: number;
  insuredCents: number;
  medications: number;
  missingPrice: number;
  missingCopay: number;
}

export interface CostsResponse {
  rows: CostRow[];
  totals: CostTotals;
}

/** "$3.33" */
export const dollars = (cents: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100);

/** "$0.0131" (unit prices keep their precision). */
export const unitDollars = (value: number) => `$${value}`;
