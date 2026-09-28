/**
 * Prices for the drug page and the Costs page: the Cost Plus Drugs item whose
 * NDC is one of the product's RxNorm NDCs (never matched by name), with the
 * owner's units per month and copay.
 */
import { createError } from 'h3';

import { costPlus, CostPlusUnavailableError, type CostPlusClient } from '../costplus';
import { db } from '../db/client';
import { createMedicationsRepository, type Medication } from '../medications/repository';
import { rxnav, type RxNavClient } from '../rxnorm';
import { RxNavUnavailableError } from '../rxnorm/client';
import { monthlyCost, totals, type CostTotals, type MonthlyCost } from './math';

export const DEFAULT_UNITS_PER_MONTH = 30;

export interface CostPlusPrice {
  /** Billed dollars per unit. */
  unitPrice: number;
  strength: string;
  form: string;
  url: string;
}

export type PriceStatus = 'found' | 'not-sold' | 'unavailable';

export interface ProductPrice {
  rxcui: string;
  status: PriceStatus;
  price: CostPlusPrice | null;
  /** When Cost Plus answered (ISO); null when it couldn't be asked. */
  asOf: string | null;
}

export interface MedicationCost extends MonthlyCost {
  medicationId: string;
  unitsPerMonth: number;
  copayCents: number | null;
  copayUnits: number | null;
}

export interface PricesResponse extends ProductPrice {
  /** The owner's figures when the product is on the active list, else null. */
  medication: MedicationCost | null;
  /** Monthly cash cost for DEFAULT_UNITS_PER_MONTH, for products not on the list. */
  defaultMonthlyCents: number | null;
}

export interface CostRow extends ProductPrice, MedicationCost {
  name: string;
}

export interface CostsResponse {
  rows: CostRow[];
  totals: CostTotals;
}

const isUnavailable = (error: unknown) =>
  error instanceof CostPlusUnavailableError || error instanceof RxNavUnavailableError;

export interface PricingDeps {
  rxnav: Pick<RxNavClient, 'product' | 'ndcs'>;
  costPlus: CostPlusClient;
  medications: { list(): Promise<Medication[]> };
}

export function createPricingService({ rxnav, costPlus, medications }: PricingDeps) {
  /** Looks the product up at Cost Plus through each of its ingredients' listings. */
  async function priceOf(rxcui: string, ingredientNames: string[]): Promise<ProductPrice> {
    const ndcs = new Set(await rxnav.ndcs(rxcui));
    let asOf: number | null = null;
    for (const name of ingredientNames) {
      const { items, fetchedAt } = await costPlus.lookup(name);
      asOf = asOf === null ? fetchedAt : Math.min(asOf, fetchedAt);
      const item = items.find((i) => ndcs.has(i.ndc));
      if (item) {
        return {
          rxcui,
          status: 'found',
          price: {
            unitPrice: item.unitBillingPrice,
            strength: item.strength,
            form: item.form,
            url: item.url,
          },
          asOf: new Date(fetchedAt).toISOString(),
        };
      }
    }
    return {
      rxcui,
      status: 'not-sold',
      price: null,
      asOf: asOf === null ? null : new Date(asOf).toISOString(),
    };
  }

  function costOf(med: Medication, price: ProductPrice): MedicationCost {
    return {
      medicationId: med.id,
      unitsPerMonth: med.unitsPerMonth,
      copayCents: med.copayCents,
      copayUnits: med.copayUnits,
      ...monthlyCost({
        unitsPerMonth: med.unitsPerMonth,
        unitPrice: price.price?.unitPrice ?? null,
        copayCents: med.copayCents,
        copayUnits: med.copayUnits,
      }),
    };
  }

  return {
    async forProduct(rxcui: string): Promise<PricesResponse> {
      let product, price: ProductPrice;
      try {
        product = await rxnav.product(rxcui);
        if (!product) {
          throw createError({ statusCode: 404, statusMessage: 'Product not found.' });
        }
        price = await priceOf(
          rxcui,
          product.ingredients.map((i) => i.name),
        );
      } catch (error) {
        if (!isUnavailable(error)) throw error;
        const message = 'Prices are unavailable right now.';
        throw createError({ statusCode: 503, statusMessage: message, message });
      }
      const med = (await medications.list()).find((m) => m.rxcui === rxcui && !m.stoppedOn);
      return {
        ...price,
        medication: med ? costOf(med, price) : null,
        defaultMonthlyCents: price.price
          ? Math.round(DEFAULT_UNITS_PER_MONTH * price.price.unitPrice * 100)
          : null,
      };
    },

    /** Active medications, one at a time (Cost Plus is paced); a failed lookup marks that row. */
    async costs(): Promise<CostsResponse> {
      const active = (await medications.list()).filter((m) => !m.stoppedOn);
      const rows: CostRow[] = [];
      for (const med of active) {
        let price: ProductPrice;
        try {
          price = await priceOf(
            med.rxcui,
            med.ingredients.map((i) => i.name),
          );
        } catch (error) {
          if (!isUnavailable(error)) throw error;
          price = { rxcui: med.rxcui, status: 'unavailable', price: null, asOf: null };
        }
        rows.push({ ...price, ...costOf(med, price), name: med.name });
      }
      return { rows, totals: totals(rows) };
    },
  };
}

/** Service wired to the app database and upstream clients. */
export function pricingService() {
  return createPricingService({
    rxnav: rxnav(),
    costPlus: costPlus(),
    medications: createMedicationsRepository(db()),
  });
}
