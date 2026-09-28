/**
 * openFDA client: the only place the app talks to openFDA (drug labels and
 * adverse event reports). Docs: https://open.fda.gov/apis/drug/
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

/** Label sections the drug summary is written from, in reading order. */
export const SUMMARY_SECTIONS = [
  'indications_and_usage',
  'boxed_warning',
  'contraindications',
  'warnings_and_cautions',
  'warnings',
  'adverse_reactions',
  'clinical_studies',
  'mechanism_of_action',
  'information_for_patients',
] as const;
export type SummarySectionName = (typeof SUMMARY_SECTIONS)[number];

export interface SummaryLabel {
  rxcui: string;
  setId: string;
  version: string;
  manufacturer: string | null;
  /** YYYY-MM-DD */
  effectiveDate: string | null;
  dailyMedUrl: string;
  /** Plain-text sections present on this label, in SUMMARY_SECTIONS order. */
  sections: { name: SummarySectionName; text: string }[];
}

export interface ReportedReactions {
  /** All FAERS reports that list the ingredient. */
  total: number;
  /** Most reported reactions (MedDRA preferred terms), most frequent first. */
  reactions: { term: string; count: number }[];
}

export interface OpenFdaClient {
  /** Newest label for an RxNorm product that has a drug interactions section, or null. */
  interactionLabel(rxcui: string): Promise<InteractionLabel | null>;
  /** Newest label for an RxNorm product that has indications, or null. */
  summaryLabel(rxcui: string, options?: { refresh?: boolean }): Promise<SummaryLabel | null>;
  /** FAERS report counts for an ingredient (e.g. "lisinopril"). */
  reportedReactions(ingredient: string): Promise<ReportedReactions>;
  /** First US approval and generic availability of an ingredient, from Drugs@FDA. */
  approvalFacts(ingredient: string): Promise<ApprovalFacts>;
  /**
   * Indications text of the newest single-ingredient labels for an ingredient (up
   * to 5, de-duplicated): different labels of one drug can differ (e.g. sildenafil
   * for erectile dysfunction or for pulmonary arterial hypertension).
   */
  indications(ingredient: string): Promise<string[]>;
}

export interface ApprovalFacts {
  /** Earliest original NDA approval with this ingredient (YYYY-MM-DD). */
  firstApproved: string | null;
  /** An approved generic (ANDA) of this ingredient alone exists. */
  genericAvailable: boolean;
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

const WEEK = 7 * 24 * 60 * 60 * 1000;
const MONTH = 30 * 24 * 60 * 60 * 1000;
const TOP_REACTIONS = 10;
const INDICATION_LABELS = 5;

interface DrugsFdaApplication {
  application_number: string;
  products?: { active_ingredients?: { name: string }[] }[];
  submissions?: {
    submission_type?: string;
    submission_status?: string;
    submission_status_date?: string;
  }[];
}

/** "ENALAPRIL" matches "ENALAPRIL" and "ENALAPRIL MALEATE", never "ENALAPRILAT". */
const sameIngredient = (productIngredient: string, name: string) =>
  productIngredient === name || productIngredient.startsWith(`${name} `);

/** Letters, digits, spaces and hyphens, upper-cased, for Drugs@FDA and label searches. */
const searchName = (ingredient: string) =>
  ingredient
    .toUpperCase()
    .replace(/[^A-Z0-9 -]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

interface LabelResult extends Partial<Record<SummarySectionName, string[]>> {
  set_id?: string;
  version?: string;
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

const dailyMedUrl = (setId: string) =>
  `https://dailymed.nlm.nih.gov/dailymed/lookup.cfm?setid=${setId}`;

const isRxcui = (value: string) => /^\d{1,10}$/.test(value);

export function createOpenFdaClient({
  baseUrl,
  apiKey,
  fetch: fetchFn = fetch,
  now = Date.now,
  timeoutMs = 5000,
}: OpenFdaClientOptions): OpenFdaClient {
  const cached = createTtlCache(now);
  const unavailable = (message: string) => new OpenFdaUnavailableError(`openFDA ${message}`);

  /** GET an openFDA endpoint; 404 ("No matches found!") becomes null. */
  async function query(path: string, params: Record<string, string>): Promise<unknown> {
    const search = new URLSearchParams(params);
    if (apiKey) search.set('api_key', apiKey);
    const { status, body } = await getJson(`${baseUrl}${path}?${search}`, {
      fetch: fetchFn,
      timeoutMs,
      unavailable,
    });
    if (status === 404) return null;
    if (status !== 200) throw unavailable(`responded ${status}`);
    return body;
  }

  const firstLabel = async (rxcui: string, mustHave: string) =>
    (
      (await query('/label.json', {
        search: `openfda.rxcui:${rxcui} AND _exists_:${mustHave}`,
        sort: 'effective_time:desc',
        limit: '1',
      })) as { results?: LabelResult[] } | null
    )?.results?.[0] ?? null;

  return {
    interactionLabel(rxcui) {
      if (!isRxcui(rxcui)) return Promise.resolve(null);
      return cached(`label:${rxcui}`, WEEK, async () => {
        const label = await firstLabel(rxcui, 'drug_interactions');
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
          dailyMedUrl: dailyMedUrl(label.set_id),
        };
      });
    },

    summaryLabel(rxcui, { refresh = false } = {}) {
      if (!isRxcui(rxcui)) return Promise.resolve(null);
      return cached(
        `summary-label:${rxcui}`,
        WEEK,
        async () => {
          const label = await firstLabel(rxcui, 'indications_and_usage');
          if (!label?.set_id) return null;
          const sections = SUMMARY_SECTIONS.filter(
            // Older labels use "warnings" instead of "warnings and cautions".
            (name) => !(name === 'warnings' && label.warnings_and_cautions?.length),
          ).flatMap((name) => {
            const text = (label[name] ?? []).map(htmlToText).join(' ').trim();
            return text ? [{ name, text }] : [];
          });
          return {
            rxcui,
            setId: label.set_id,
            version: label.version ?? '1',
            manufacturer: label.openfda?.manufacturer_name?.[0] ?? null,
            effectiveDate: isoDate(label.effective_time),
            dailyMedUrl: dailyMedUrl(label.set_id),
            sections,
          };
        },
        { refresh },
      );
    },

    reportedReactions(ingredient) {
      const name = ingredient.trim().toUpperCase().replace(/"/g, '');
      if (!name) return Promise.resolve({ total: 0, reactions: [] });
      return cached(`faers:${name}`, WEEK, async () => {
        const search = `patient.drug.openfda.generic_name.exact:"${name}"`;
        const [counts, totals] = await Promise.all([
          query('/event.json', {
            search,
            count: 'patient.reaction.reactionmeddrapt.exact',
            limit: String(TOP_REACTIONS),
          }) as Promise<{ results?: { term: string; count: number }[] } | null>,
          query('/event.json', { search, limit: '1' }) as Promise<{
            meta?: { results?: { total?: number } };
          } | null>,
        ]);
        return {
          total: totals?.meta?.results?.total ?? 0,
          reactions: (counts?.results ?? [])
            .slice(0, TOP_REACTIONS)
            .map(({ term, count }) => ({ term, count })),
        };
      });
    },

    approvalFacts(ingredient) {
      const name = searchName(ingredient);
      if (!name) return Promise.resolve({ firstApproved: null, genericAvailable: false });
      return cached(`approval:${name}`, MONTH, async () => {
        // The wildcard also finds salts ("ENALAPRIL MALEATE") and metabolites
        // ("ENALAPRILAT"); sameIngredient() keeps only the former. Multi-word names
        // are searched as a phrase (a wildcard can't span words).
        const term = name.includes(' ') ? `"${name}"` : `${name}*`;
        const apps = async (kind: 'NDA' | 'ANDA') =>
          (
            (await query('/drugsfda.json', {
              search: `products.active_ingredients.name:${term} AND application_number:${kind}*`,
              limit: '100',
            })) as { results?: DrugsFdaApplication[] } | null
          )?.results ?? [];
        const [ndas, andas] = await Promise.all([apps('NDA'), apps('ANDA')]);

        const approvals = ndas
          .filter((app) =>
            app.products?.some((p) =>
              p.active_ingredients?.some((i) => sameIngredient(i.name, name)),
            ),
          )
          .flatMap((app) =>
            (app.submissions ?? [])
              .filter((s) => s.submission_type === 'ORIG' && s.submission_status === 'AP')
              .map((s) => s.submission_status_date ?? ''),
          )
          .filter((date) => /^\d{8}$/.test(date))
          .sort();
        const genericAvailable = andas.some((app) =>
          app.products?.some(
            (p) =>
              p.active_ingredients?.length === 1 &&
              sameIngredient(p.active_ingredients[0].name, name),
          ),
        );
        return { firstApproved: isoDate(approvals[0]), genericAvailable };
      });
    },

    indications(ingredient) {
      const name = searchName(ingredient);
      if (!name) return Promise.resolve([]);
      return cached(`indications:${name}`, MONTH, async () => {
        const body = (await query('/label.json', {
          search: `openfda.generic_name:"${name}"`,
          sort: 'effective_time:desc',
          limit: '10',
        })) as {
          results?: { indications_and_usage?: string[]; openfda?: { generic_name?: string[] } }[];
        } | null;
        const texts = (body?.results ?? [])
          // Single-ingredient labels only: a combination's indications are not this drug's.
          .filter((r) => (r.openfda?.generic_name ?? []).every((g) => !/ AND |,|\//.test(g)))
          .map((r) => htmlToText(r.indications_and_usage?.join(' ') ?? ''))
          .filter(Boolean);
        return [...new Set(texts)].slice(0, INDICATION_LABELS);
      });
    },
  };
}
