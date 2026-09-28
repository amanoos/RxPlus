/**
 * Cost Plus Drugs public price API: the only place the app talks to Cost Plus.
 * Only ingredient names are sent. Prices are list prices per unit; per-order fees
 * (pharmacy labor, shipping) are not part of the answer.
 */
import { createTtlCache, getJson } from '../utils/upstream';

export interface CostPlusItem {
  /** 11 digits, no hyphens. */
  ndc: string;
  /** e.g. "10mg" */
  strength: string;
  /** e.g. "Tablet" */
  form: string;
  brandGeneric: 'Brand' | 'Generic' | string;
  /** Dollars per unit before billing, e.g. 0.011. */
  unitPrice: number;
  /** Dollars per unit as billed, e.g. 0.0131 (what the monthly figure uses). */
  unitBillingPrice: number;
  /** The product page at costplusdrugs.com. */
  url: string;
}

export interface CostPlusClient {
  /** Everything Cost Plus sells for an ingredient; [] when it sells none. */
  items(ingredient: string): Promise<CostPlusItem[]>;
}

export class CostPlusUnavailableError extends Error {
  override readonly name = 'CostPlusUnavailableError';
}

export interface CostPlusClientOptions {
  /** e.g. https://us-central1-costplusdrugs-publicapi.cloudfunctions.net/main */
  baseUrl: string;
  fetch?: typeof fetch;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  timeoutMs?: number;
}

const DAY = 24 * 60 * 60 * 1000;
/** Start-to-start spacing: at most 2 requests a second. */
const SPACING_MS = 500;

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

interface RawItem {
  ndc?: string;
  strength?: string;
  form?: string;
  brand_generic?: string;
  unit_price?: string;
  unit_billing_price?: string;
  url?: string;
}

/** "$0.0131" → 0.0131; null when not a price. */
export function parseDollars(value: string | undefined): number | null {
  const match = /^\s*\$?\s*(\d+(?:\.\d+)?)\s*$/.exec(value ?? '');
  return match ? Number(match[1]) : null;
}

/** Letters, digits, spaces and hyphens only. */
const searchName = (ingredient: string) =>
  ingredient
    .toLowerCase()
    .replace(/[^a-z0-9 -]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

function toItem(raw: RawItem): CostPlusItem | null {
  const ndc = (raw.ndc ?? '').replace(/\D/g, '');
  const unitPrice = parseDollars(raw.unit_price);
  const unitBillingPrice = parseDollars(raw.unit_billing_price);
  if (ndc.length !== 11 || unitBillingPrice === null || !raw.url?.startsWith('https://')) {
    return null;
  }
  return {
    ndc,
    strength: raw.strength ?? '',
    form: raw.form ?? '',
    brandGeneric: raw.brand_generic ?? '',
    unitPrice: unitPrice ?? unitBillingPrice,
    unitBillingPrice,
    url: raw.url,
  };
}

export function createCostPlusClient({
  baseUrl,
  fetch: fetchFn = fetch,
  now = Date.now,
  sleep = defaultSleep,
  timeoutMs = 10_000,
}: CostPlusClientOptions): CostPlusClient {
  const cached = createTtlCache(now);
  const unavailable = (message: string) =>
    new CostPlusUnavailableError(`Cost Plus Drugs ${message}`);
  let nextStart = 0;

  async function fetchItems(name: string): Promise<CostPlusItem[]> {
    const t = now();
    const wait = nextStart - t;
    nextStart = Math.max(t, nextStart) + SPACING_MS;
    if (wait > 0) await sleep(wait);
    const url = `${baseUrl.replace(/\/$/, '')}?${new URLSearchParams({ medication_name: name })}`;
    const { status, body } = await getJson(url, { fetch: fetchFn, timeoutMs, unavailable });
    if (status !== 200) throw unavailable(`responded ${status}`);
    const results = (body as { results?: RawItem[] } | null)?.results;
    if (!Array.isArray(results)) throw unavailable('sent an unexpected answer');
    return results.map(toItem).filter((i): i is CostPlusItem => i !== null);
  }

  return {
    items(ingredient) {
      const name = searchName(ingredient);
      if (!name) return Promise.resolve([]);
      return cached(`items:${name}`, DAY, () => fetchItems(name));
    },
  };
}
