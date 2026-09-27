/**
 * MedlinePlus Connect (NLM): links to consumer health pages for an RxNorm
 * ingredient. Content is licensed, so the app links to it rather than copying it.
 * Docs: https://medlineplus.gov/medlineplus-connect/web-service/
 */
import { createTtlCache, getJson } from '../utils/upstream';

export interface MedlinePlusPage {
  title: string;
  url: string;
}

export interface MedlinePlusClient {
  /** The MedlinePlus drug page for an ingredient, or null. */
  drugPage(ingredientRxcui: string): Promise<MedlinePlusPage | null>;
}

export class MedlinePlusUnavailableError extends Error {
  override readonly name = 'MedlinePlusUnavailableError';
}

const RXNORM_CODE_SYSTEM = '2.16.840.1.113883.6.88';
const WEEK = 7 * 24 * 60 * 60 * 1000;

interface ConnectFeed {
  feed?: { entry?: { title?: { _value?: string }; link?: { href?: string }[] }[] };
}

export function createMedlinePlusClient({
  baseUrl = 'https://connect.medlineplus.gov/service',
  fetch: fetchFn = fetch,
  now = Date.now,
  timeoutMs = 5000,
}: {
  baseUrl?: string;
  fetch?: typeof fetch;
  now?: () => number;
  timeoutMs?: number;
} = {}): MedlinePlusClient {
  const cached = createTtlCache(now);
  const unavailable = (message: string) =>
    new MedlinePlusUnavailableError(`MedlinePlus ${message}`);

  return {
    drugPage(ingredientRxcui) {
      if (!/^\d{1,10}$/.test(ingredientRxcui)) return Promise.resolve(null);
      return cached(`page:${ingredientRxcui}`, WEEK, async () => {
        const params = new URLSearchParams({
          'mainSearchCriteria.v.cs': RXNORM_CODE_SYSTEM,
          'mainSearchCriteria.v.c': ingredientRxcui,
          knowledgeResponseType: 'application/json',
        });
        const { status, body } = await getJson(`${baseUrl}?${params}`, {
          fetch: fetchFn,
          timeoutMs,
          unavailable,
        });
        if (status !== 200) throw unavailable(`responded ${status}`);
        const entries = (body as ConnectFeed).feed?.entry ?? [];
        const pages = entries.flatMap((e) =>
          e.title?._value && e.link?.[0]?.href
            ? [{ title: e.title._value, url: e.link[0].href }]
            : [],
        );
        // Prefer the drug monograph over general topic pages.
        const page = pages.find((p) => p.url.includes('/druginfo/meds/')) ?? pages[0];
        if (!page) return null;
        const url = new URL(page.url);
        for (const key of [...url.searchParams.keys()]) {
          if (key.startsWith('utm_')) url.searchParams.delete(key);
        }
        return { title: page.title, url: url.toString() };
      });
    },
  };
}
