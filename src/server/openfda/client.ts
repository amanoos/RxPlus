/**
 * openFDA drug label client: the only place the app talks to openFDA.
 * Docs: https://open.fda.gov/apis/drug/label/
 */
import { createTtlCache, getJson } from '../utils/upstream';

export interface InteractionLabel {
  rxcui: string;
  setId: string;
  manufacturer: string | null;
  /** YYYY-MM-DD */
  effectiveDate: string | null;
  /** "Drug interactions" section plus its tables, as plain text. */
  text: string;
  dailyMedUrl: string;
}

export interface OpenFdaClient {
  /** Newest label for an RxNorm product that has a drug interactions section, or null. */
  interactionLabel(rxcui: string): Promise<InteractionLabel | null>;
}

export class OpenFdaUnavailableError extends Error {
  override readonly name = 'OpenFdaUnavailableError';
}

export interface OpenFdaClientOptions {
  /** e.g. https://api.fda.gov/drug */
  baseUrl: string;
  apiKey?: string;
  fetch?: typeof fetch;
  now?: () => number;
  timeoutMs?: number;
}

const LABEL_TTL = 7 * 24 * 60 * 60 * 1000;

interface LabelResult {
  set_id?: string;
  effective_time?: string;
  openfda?: { manufacturer_name?: string[] };
  drug_interactions?: string[];
  drug_interactions_table?: string[];
}

/** The key travels in the query string: never let it reach logs or errors. */
export function redactKey(url: string): string {
  return url.replace(/([?&]api_key=)[^&]*/g, '$1REDACTED');
}

const htmlToText = (html: string) =>
  html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();

const isoDate = (yyyymmdd?: string) =>
  yyyymmdd && /^\d{8}$/.test(yyyymmdd)
    ? `${yyyymmdd.slice(0, 4)}-${yyyymmdd.slice(4, 6)}-${yyyymmdd.slice(6, 8)}`
    : null;

export function createOpenFdaClient({
  baseUrl,
  apiKey,
  fetch: fetchFn = fetch,
  now = Date.now,
  timeoutMs = 5000,
}: OpenFdaClientOptions): OpenFdaClient {
  const cached = createTtlCache(now);
  const unavailable = (message: string) => new OpenFdaUnavailableError(`openFDA ${message}`);

  return {
    interactionLabel(rxcui) {
      if (!/^\d{1,10}$/.test(rxcui)) return Promise.resolve(null);
      return cached(`label:${rxcui}`, LABEL_TTL, async () => {
        const params = new URLSearchParams({
          search: `openfda.rxcui:${rxcui} AND _exists_:drug_interactions`,
          sort: 'effective_time:desc',
          limit: '1',
        });
        if (apiKey) params.set('api_key', apiKey);
        const { status, body } = await getJson(`${baseUrl}/label.json?${params}`, {
          fetch: fetchFn,
          timeoutMs,
          unavailable,
        });
        if (status === 404) return null; // openFDA's "No matches found!"
        if (status !== 200) throw unavailable(`responded ${status}`);

        const label = (body as { results?: LabelResult[] }).results?.[0];
        if (!label?.set_id) return null;
        const text = [...(label.drug_interactions ?? []), ...(label.drug_interactions_table ?? [])]
          .map(htmlToText)
          .join(' ');
        return {
          rxcui,
          setId: label.set_id,
          manufacturer: label.openfda?.manufacturer_name?.[0] ?? null,
          effectiveDate: isoDate(label.effective_time),
          text,
          dailyMedUrl: `https://dailymed.nlm.nih.gov/dailymed/lookup.cfm?setid=${label.set_id}`,
        };
      });
    },
  };
}
