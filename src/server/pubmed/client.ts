/**
 * PubMed client (NCBI E-utilities): the only place the app talks to PubMed.
 * Docs: https://www.ncbi.nlm.nih.gov/books/NBK25501/
 * NCBI allows 3 requests/s without a key and 10/s with one, so requests are
 * serialized and spaced.
 */
import { getJson, getText } from '../utils/upstream';

export type StudyType = 'meta-analysis' | 'systematic-review' | 'rct' | 'other';

export interface PaperDetails {
  pmid: string;
  title: string;
  journal: string | null;
  year: number | null;
  pubTypes: string[];
  studyType: StudyType;
  doi: string | null;
  /** PubMed Central id (free full text), e.g. "PMC10423763". */
  pmcid: string | null;
}

export interface PaperSearch {
  /** Meta-analyses and systematic reviews, most relevant first. */
  reviews: string[];
  /** Randomized controlled trials not already in `reviews`, most relevant first. */
  rcts: string[];
}

export interface RecentPapers {
  /** Most relevant first, at most `limit`. */
  pmids: string[];
  /** All matches in the window. */
  total: number;
  /** The same search on the PubMed website. */
  searchUrl: string;
}

export interface PubMedClient {
  searchPapers(ingredient: string): Promise<PaperSearch>;
  /** Papers entered in PubMed between `from` and `to` (YYYY-MM-DD, inclusive). */
  recentPapers(
    ingredient: string,
    window: { from: string; to: string; limit: number },
  ): Promise<RecentPapers>;
  /** Details for the given PMIDs, in the same order (unknown ones left out). */
  paperDetails(pmids: string[]): Promise<PaperDetails[]>;
  /** Abstract text by PMID; papers without one are left out. */
  abstracts(pmids: string[]): Promise<Map<string, string>>;
}

export class PubMedUnavailableError extends Error {
  override readonly name = 'PubMedUnavailableError';
}

export interface PubMedClientOptions {
  /** e.g. https://eutils.ncbi.nlm.nih.gov/entrez/eutils */
  baseUrl: string;
  apiKey?: string;
  email?: string;
  fetch?: typeof fetch;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  timeoutMs?: number;
}

/** Candidates kept per tier; the page shows at most 10 papers. */
export const CANDIDATES_PER_TIER = 20;

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Start-to-start spacing: NCBI allows 3 requests/s without a key (kept a little under), 10 with one. */
const SPACING_MS = 400;
const SPACING_WITH_KEY_MS = 110;
/** Waits before retrying after a 429. */
const BACKOFF_MS = [1000, 2000];

class RateLimited extends Error {}

/** Letters, digits, spaces and hyphens only, so a name can't change the query. */
const searchName = (ingredient: string) =>
  ingredient
    .toLowerCase()
    .replace(/[^a-z0-9 -]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

export function studyType(pubTypes: string[]): StudyType {
  const types = pubTypes.map((t) => t.toLowerCase());
  if (types.some((t) => t.includes('meta-analysis'))) return 'meta-analysis';
  if (types.includes('systematic review')) return 'systematic-review';
  if (types.includes('randomized controlled trial')) return 'rct';
  return 'other';
}

interface SummaryEntry {
  uid?: string;
  error?: string;
  title?: string;
  source?: string;
  pubdate?: string;
  pubtype?: string[];
  articleids?: { idtype: string; value: string }[];
}

export function createPubMedClient({
  baseUrl,
  apiKey,
  email,
  fetch: fetchFn = fetch,
  now = Date.now,
  sleep = defaultSleep,
  timeoutMs = 10_000,
}: PubMedClientOptions): PubMedClient {
  const unavailable = (message: string) => new PubMedUnavailableError(`PubMed ${message}`);
  const spacingMs = apiKey ? SPACING_WITH_KEY_MS : SPACING_MS;
  const http = { fetch: fetchFn, timeoutMs, unavailable, rateLimited: () => new RateLimited() };

  // One request at a time, at least spacingMs apart (start to start). NCBI counts
  // requests per IP over a rolling window, so a 429 still happens now and then:
  // back off and retry, keeping the queue's order.
  let queue: Promise<unknown> = Promise.resolve();
  let lastStart = -Infinity;
  function spaced<T>(work: () => Promise<T>): Promise<T> {
    const run = queue.then(async () => {
      for (let attempt = 0; ; attempt++) {
        const wait = lastStart + spacingMs - now();
        if (wait > 0) await sleep(wait);
        lastStart = now();
        try {
          return await work();
        } catch (error) {
          if (!(error instanceof RateLimited)) throw error;
          if (attempt >= BACKOFF_MS.length) throw unavailable('rate limited (429)');
          await sleep(BACKOFF_MS[attempt]);
        }
      }
    });
    queue = run.catch(() => undefined);
    return run;
  }

  const url = (endpoint: string, params: Record<string, string>) => {
    const search = new URLSearchParams({ db: 'pubmed', ...params, tool: 'rxplus' });
    if (email) search.set('email', email);
    if (apiKey) search.set('api_key', apiKey);
    return `${baseUrl.replace(/\/$/, '')}/${endpoint}?${search}`;
  };

  async function json(endpoint: string, params: Record<string, string>): Promise<unknown> {
    const { status, body } = await spaced(() => getJson(url(endpoint, params), http));
    if (status !== 200) throw unavailable(`responded ${status}`);
    return body;
  }

  async function esearch(
    term: string,
    extra: Record<string, string> = {},
    retmax = CANDIDATES_PER_TIER,
  ): Promise<{ ids: string[]; count: number }> {
    const body = (await json('esearch.fcgi', {
      term,
      retmode: 'json',
      retmax: String(retmax),
      sort: 'relevance',
      ...extra,
    })) as { esearchresult?: { idlist?: string[]; count?: string; ERROR?: string } } | null;
    const result = body?.esearchresult;
    if (!result || result.ERROR)
      throw unavailable(`search failed${result?.ERROR ? `: ${result.ERROR}` : ''}`);
    return { ids: result.idlist ?? [], count: Number(result.count ?? 0) };
  }
  const search = async (term: string) => (await esearch(term)).ids;

  return {
    async recentPapers(ingredient, { from, to, limit }) {
      const name = searchName(ingredient);
      const mindate = from.replace(/-/g, '/');
      const maxdate = to.replace(/-/g, '/');
      const term = `"${name}"[tiab] AND hasabstract`;
      const searchUrl = `https://pubmed.ncbi.nlm.nih.gov/?${new URLSearchParams({
        term: `${term} AND ("${mindate}"[edat] : "${maxdate}"[edat])`,
        sort: 'relevance',
      })}`;
      if (!name) return { pmids: [], total: 0, searchUrl };
      // New entries aren't MeSH- or type-indexed for weeks: title/abstract, by entry date.
      const { ids, count } = await esearch(term, { datetype: 'edat', mindate, maxdate }, limit);
      return { pmids: ids, total: count, searchUrl };
    },

    async searchPapers(ingredient) {
      const name = searchName(ingredient);
      if (!name) return { reviews: [], rcts: [] };
      const reviews = await search(
        `"${name}"[tiab] AND (meta-analysis[pt] OR systematic review[pt]) AND hasabstract`,
      );
      const rcts = await search(
        `"${name}"[majr] AND randomized controlled trial[pt] AND hasabstract`,
      );
      return { reviews, rcts: rcts.filter((pmid) => !reviews.includes(pmid)) };
    },

    async paperDetails(pmids) {
      if (!pmids.length) return [];
      const body = (await json('esummary.fcgi', { id: pmids.join(','), retmode: 'json' })) as {
        result?: Record<string, SummaryEntry>;
      } | null;
      const result = body?.result ?? {};
      return pmids.flatMap((pmid) => {
        const entry = result[pmid];
        if (!entry?.title || entry.error) return [];
        const id = (type: string) =>
          entry.articleids?.find((a) => a.idtype === type)?.value ?? null;
        const pubTypes = entry.pubtype ?? [];
        const year = /^\d{4}/.exec(entry.pubdate ?? '')?.[0];
        return [
          {
            pmid,
            title: decodeEntities(stripTags(entry.title)).trim(),
            journal: entry.source || null,
            year: year ? Number(year) : null,
            pubTypes,
            studyType: studyType(pubTypes),
            doi: id('doi'),
            pmcid: id('pmc'),
          },
        ];
      });
    },

    async abstracts(pmids) {
      if (!pmids.length) return new Map();
      const { status, text } = await spaced(() =>
        getText(url('efetch.fcgi', { id: pmids.join(','), retmode: 'xml', rettype: 'abstract' }), {
          ...http,
          accept: 'application/xml',
        }),
      );
      if (status !== 200) throw unavailable(`responded ${status}`);
      return parseAbstracts(text);
    },
  };
}

const stripTags = (text: string) => text.replace(/<[^>]+>/g, '');

const NAMED: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

/** XML entities (after tags are stripped, so an escaped "<" never becomes markup). */
function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, code: string) => {
    if (code[0] === '#') {
      const n =
        code[1] === 'x' || code[1] === 'X' ? parseInt(code.slice(2), 16) : Number(code.slice(1));
      return Number.isFinite(n) ? String.fromCodePoint(n) : whole;
    }
    return NAMED[code.toLowerCase()] ?? whole;
  });
}

/**
 * Abstracts from an efetch XML answer, by PMID. Structured abstracts keep their
 * section labels ("METHODS: …"), one section per line.
 */
export function parseAbstracts(xml: string): Map<string, string> {
  const abstracts = new Map<string, string>();
  for (const article of xml.split(/<PubmedArticle[\s>]/).slice(1)) {
    const pmid = /<PMID[^>]*>(\d+)<\/PMID>/.exec(article)?.[1];
    const abstract = /<Abstract>([\s\S]*?)<\/Abstract>/.exec(article)?.[1];
    if (!pmid || !abstract) continue;
    const sections = [...abstract.matchAll(/<AbstractText([^>]*)>([\s\S]*?)<\/AbstractText>/g)]
      .map(([, attrs, inner]) => {
        const label = /\bLabel="([^"]*)"/.exec(attrs)?.[1];
        const text = decodeEntities(stripTags(inner)).replace(/\s+/g, ' ').trim();
        return text && label ? `${decodeEntities(label)}: ${text}` : text;
      })
      .filter(Boolean);
    if (sections.length) abstracts.set(pmid, sections.join('\n'));
  }
  return abstracts;
}
