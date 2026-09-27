/**
 * RxNav (NLM RxNorm) client. The only place the app talks to RxNav: base URL,
 * timeout, retry, caching and response mapping all live here.
 * API docs: https://lhncbc.nlm.nih.gov/RxNav/APIs/RxNormAPIs.html
 */

export type ProductTty = 'SCD' | 'SBD';

export interface RxProduct {
  rxcui: string;
  name: string;
  tty: ProductTty;
  brandName: string | null;
}

export interface RxProductDetails extends RxProduct {
  strength: string | null;
  doseForm: string | null;
  ingredients: { rxcui: string; name: string }[];
}

export interface RxNavClient {
  /** Prescribable drug names matching `query`, best matches first (max 20). */
  search(query: string): Promise<string[]>;
  /** Generic (SCD) then branded (SBD) products for a drug name. */
  products(name: string): Promise<RxProduct[]>;
  /** Details of an SCD/SBD product; null for other concept types or unknown RXCUIs. */
  product(rxcui: string): Promise<RxProductDetails | null>;
}

export class RxNavUnavailableError extends Error {
  override readonly name = 'RxNavUnavailableError';
}

export interface RxNavClientOptions {
  baseUrl: string;
  fetch?: typeof fetch;
  now?: () => number;
  timeoutMs?: number;
}

const HOUR = 60 * 60 * 1000;
const NAMES_TTL = 24 * HOUR;
const PRODUCTS_TTL = 24 * HOUR;
const DETAILS_TTL = 7 * 24 * HOUR;
const MAX_RESULTS = 20;

interface ConceptProperties {
  rxcui: string;
  name: string;
  tty: string;
}
interface ConceptGroup {
  tty: string;
  conceptProperties?: ConceptProperties[];
}

class NetworkError extends Error {}

export function createRxNavClient({
  baseUrl,
  fetch: fetchFn = fetch,
  now = Date.now,
  timeoutMs = 5000,
}: RxNavClientOptions): RxNavClient {
  const cache = new Map<string, { expires: number; value: Promise<unknown> }>();

  function cached<T>(key: string, ttl: number, load: () => Promise<T>): Promise<T> {
    const hit = cache.get(key);
    if (hit && hit.expires > now()) return hit.value as Promise<T>;
    const value = load();
    cache.set(key, { expires: now() + ttl, value });
    // Never cache failures.
    value.catch(() => cache.delete(key));
    return value;
  }

  async function attempt(url: string): Promise<unknown> {
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
    try {
      const response = await Promise.race([
        fetchFn(url, { signal: controller.signal, headers: { accept: 'application/json' } }),
        new Promise<never>((_, reject) =>
          controller.signal.addEventListener('abort', () => reject(new Error('aborted'))),
        ),
      ]);
      if (response.status >= 500) throw new NetworkError(`RxNav responded ${response.status}`);
      if (!response.ok) throw new RxNavUnavailableError(`RxNav responded ${response.status}`);
      return await response.json();
    } catch (error) {
      if (timedOut) throw new RxNavUnavailableError('RxNav timed out');
      if (error instanceof RxNavUnavailableError) throw error;
      throw new NetworkError(error instanceof Error ? error.message : String(error));
    } finally {
      clearTimeout(timer);
    }
  }

  /** GET with one retry on network errors and 5xx (not on timeouts or 4xx). */
  async function get(path: string): Promise<unknown> {
    const url = `${baseUrl}${path}`;
    try {
      return await attempt(url);
    } catch (error) {
      if (!(error instanceof NetworkError)) throw error;
      try {
        return await attempt(url);
      } catch (retryError) {
        if (retryError instanceof RxNavUnavailableError) throw retryError;
        throw new RxNavUnavailableError(`RxNav unreachable: ${(retryError as Error).message}`);
      }
    }
  }

  const displayNames = () =>
    cached('displaynames', NAMES_TTL, async () => {
      const body = (await get('/Prescribe/displaynames.json')) as {
        displayTermsList?: { term?: string[] };
      };
      return (body.displayTermsList?.term ?? []).map((name) => ({
        name,
        lower: name.toLowerCase(),
      }));
    });

  const groupsOf = (body: unknown): ConceptGroup[] => {
    const typed = body as {
      drugGroup?: { conceptGroup?: ConceptGroup[] };
      relatedGroup?: { conceptGroup?: ConceptGroup[] };
    };
    return typed.drugGroup?.conceptGroup ?? typed.relatedGroup?.conceptGroup ?? [];
  };
  const conceptsOf = (groups: ConceptGroup[], tty: string) =>
    groups.find((g) => g.tty === tty)?.conceptProperties ?? [];
  const brandFromName = (name: string) => /\[([^\]]+)\]\s*$/.exec(name)?.[1] ?? null;
  const isProductTty = (tty: string | undefined): tty is ProductTty =>
    tty === 'SCD' || tty === 'SBD';

  return {
    async search(query) {
      const q = query.trim().toLowerCase();
      if (!q) return [];
      const rank = (lower: string) => {
        if (lower === q) return 0;
        if (lower.startsWith(q)) return 1;
        if (lower.split(/[\s/,()-]+/).some((word) => word.startsWith(q))) return 2;
        if (lower.includes(q)) return 3;
        return -1;
      };
      return (await displayNames())
        .map((entry) => ({ ...entry, rank: rank(entry.lower) }))
        .filter((entry) => entry.rank >= 0)
        .sort(
          (a, b) =>
            a.rank - b.rank || a.lower.length - b.lower.length || a.lower.localeCompare(b.lower),
        )
        .slice(0, MAX_RESULTS)
        .map((entry) => entry.name);
    },

    products(name) {
      const key = name.trim().toLowerCase();
      return cached(`products:${key}`, PRODUCTS_TTL, async () => {
        const groups = groupsOf(
          await get(`/Prescribe/drugs.json?name=${encodeURIComponent(name.trim())}`),
        );
        return (['SCD', 'SBD'] as const).flatMap((tty) =>
          conceptsOf(groups, tty).map((c) => ({
            rxcui: c.rxcui,
            name: c.name,
            tty,
            brandName: tty === 'SBD' ? brandFromName(c.name) : null,
          })),
        );
      });
    },

    product(rxcui) {
      if (!/^\d{1,10}$/.test(rxcui)) return Promise.resolve(null);
      return cached(`product:${rxcui}`, DETAILS_TTL, async () => {
        const properties = await get(`/rxcui/${rxcui}/properties.json`);
        const concept = (properties as { properties?: ConceptProperties }).properties;
        if (!concept || !isProductTty(concept.tty)) return null;

        const [related, attributes] = await Promise.all([
          get(`/rxcui/${rxcui}/related.json?tty=IN+BN+DF`),
          get(`/rxcui/${rxcui}/allProperties.json?prop=attributes`),
        ]);

        const groups = groupsOf(related);
        const props =
          (
            attributes as {
              propConceptGroup?: { propConcept?: { propName: string; propValue: string }[] };
            }
          ).propConceptGroup?.propConcept ?? [];
        return {
          rxcui: concept.rxcui,
          name: concept.name,
          tty: concept.tty,
          // RxNav also relates brands to generic products; only SBDs are branded.
          brandName: concept.tty === 'SBD' ? (conceptsOf(groups, 'BN')[0]?.name ?? null) : null,
          strength: props.find((p) => p.propName === 'AVAILABLE_STRENGTH')?.propValue ?? null,
          doseForm: conceptsOf(groups, 'DF')[0]?.name ?? null,
          ingredients: conceptsOf(groups, 'IN').map((c) => ({ rxcui: c.rxcui, name: c.name })),
        };
      });
    },
  };
}
