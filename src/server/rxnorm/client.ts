/**
 * RxNav (NLM RxNorm) client. The only place the app talks to RxNav: base URL,
 * timeout, retry, caching and response mapping all live here.
 * API docs: https://lhncbc.nlm.nih.gov/RxNav/APIs/RxNormAPIs.html
 */

import { createTtlCache, getJson } from '../utils/upstream';

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
  /** RxNorm ingredient (IN) for a drug name, including synonyms and salts; null if unknown. */
  ingredientByName(name: string): Promise<string | null>;
  /** FDA established pharmacologic classes (EPC) of an ingredient, e.g. "Aldosterone Antagonist". */
  classNames(ingredientRxcui: string): Promise<string[]>;
  /** Brand names related to an ingredient. */
  brandNames(ingredientRxcui: string): Promise<string[]>;
  /** Classes, uses and conditions to avoid, from RxClass (MED-RT, FDA EPC, ATC). */
  drugFacts(ingredientRxcui: string): Promise<DrugFacts>;
  /** FDA established pharmacologic classes of an ingredient, with their class ids. */
  epcClasses(ingredientRxcui: string): Promise<RxClassRef[]>;
  /**
   * Drugs in an FDA established pharmacologic class (ingredients and salt forms).
   * Member lists are kept for a month; `refresh` reads them again (a forced rebuild).
   */
  classMembers(epcClassId: string, options?: { refresh?: boolean }): Promise<RxConcept[]>;
  /** Drugs MED-RT lists as treating a condition (ingredients and salt forms). */
  diseaseMembers(diseaseId: string, options?: { refresh?: boolean }): Promise<RxConcept[]>;
  /** More specific forms of a condition in MED-RT, e.g. Hypertension → Hypertension, Pulmonary. */
  diseaseDescendants(diseaseId: string, options?: { refresh?: boolean }): Promise<RxClassRef[]>;
  /** The ingredient of a salt form (PIN); an ingredient maps to itself; null if unclear. */
  toIngredient(rxcui: string): Promise<RxConcept | null>;
  /**
   * A prescribable single-ingredient US product for an ingredient (oral tablet,
   * then oral capsule, then any), or null when there is none.
   */
  usProduct(ingredientRxcui: string): Promise<{ rxcui: string; name: string } | null>;
  /** The product's NDCs (11 digits, active ones as RxNorm lists them); [] when none. */
  ndcs(rxcui: string): Promise<string[]>;
}

/** An RxClass class or MED-RT disease. */
export interface RxClassRef {
  id: string;
  name: string;
}

/** An RxNorm concept: ingredient (IN) or salt form (PIN). */
export interface RxConcept {
  rxcui: string;
  name: string;
  tty: string;
}

export interface DrugFacts {
  /** FDA established pharmacologic classes, e.g. "Angiotensin Converting Enzyme Inhibitor". */
  epcClasses: string[];
  atcClasses: string[];
  /** MED-RT may_treat (MeSH disease names). */
  mayTreat: string[];
  /** The same uses with their MED-RT disease ids (for "taken for"). */
  uses: RxClassRef[];
  mayPrevent: string[];
  /** MED-RT ci_with: conditions the drug is contraindicated with. */
  avoidWith: string[];
}

export class RxNavUnavailableError extends Error {
  override readonly name = 'RxNavUnavailableError';
}

export interface RxNavClientOptions {
  baseUrl: string;
  fetch?: typeof fetch;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  timeoutMs?: number;
}

/** NLM asks for at most 20 requests per second per IP. */
const MIN_SPACING_MS = 50;
const MONTH = 30 * 24 * 60 * 60 * 1000;
const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

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
interface ClassInfoList {
  rxclassDrugInfoList?: {
    rxclassDrugInfo?: { rxclassMinConceptItem: { classId: string; className: string } }[];
  };
}
interface ClassTreeNode {
  rxclassMinConceptItem: { classId: string; className: string };
  rxclassTree?: ClassTreeNode[];
}
interface ConceptGroup {
  tty: string;
  conceptProperties?: ConceptProperties[];
}

export function createRxNavClient({
  baseUrl,
  fetch: fetchFn = fetch,
  now = Date.now,
  sleep = defaultSleep,
  timeoutMs = 5000,
}: RxNavClientOptions): RxNavClient {
  const cached = createTtlCache(now);
  const unavailable = (message: string) => new RxNavUnavailableError(`RxNav ${message}`);

  // Request starts at least MIN_SPACING_MS apart (they may still overlap in flight).
  let nextStart = 0;
  async function paced(): Promise<void> {
    const t = now();
    const wait = nextStart - t;
    nextStart = Math.max(t, nextStart) + MIN_SPACING_MS;
    if (wait > 0) await sleep(wait);
  }

  /** GET JSON; any non-2xx response counts as RxNav being unavailable. */
  async function get(path: string): Promise<unknown> {
    await paced();
    const { status, body } = await getJson(`${baseUrl}${path}`, {
      fetch: fetchFn,
      timeoutMs,
      unavailable,
    });
    if (status < 200 || status >= 300) throw unavailable(`responded ${status}`);
    return body;
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
  const isId = (rxcui: string) => /^\d{1,10}$/.test(rxcui);
  const isDiseaseId = (id: string) => /^D\d{6,9}$/.test(id);
  const membersOf = (body: unknown): RxConcept[] =>
    (
      (body as { drugMemberGroup?: { drugMember?: { minConcept: RxConcept }[] } }).drugMemberGroup
        ?.drugMember ?? []
    ).map(({ minConcept: c }) => ({ rxcui: c.rxcui, name: c.name, tty: c.tty }));
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

    async ingredientByName(name) {
      const found = (await get(`/rxcui.json?name=${encodeURIComponent(name.trim())}&search=2`)) as {
        idGroup?: { rxnormId?: string[] };
      };
      const rxcui = found.idGroup?.rxnormId?.[0];
      if (!rxcui) return null;
      // Salts (PIN) and other forms map to their ingredient; an IN maps to itself.
      const ingredients = conceptsOf(
        groupsOf(await get(`/rxcui/${rxcui}/related.json?tty=IN`)),
        'IN',
      );
      return ingredients.length === 1 ? ingredients[0].rxcui : null;
    },

    classNames(ingredientRxcui) {
      if (!/^\d{1,10}$/.test(ingredientRxcui)) return Promise.resolve([]);
      return cached(`epc:${ingredientRxcui}`, DETAILS_TTL, async () => {
        const body = (await get(
          `/rxclass/class/byRxcui.json?rxcui=${ingredientRxcui}&relaSource=DAILYMED&relas=has_epc`,
        )) as {
          rxclassDrugInfoList?: {
            rxclassDrugInfo?: { rxclassMinConceptItem: { className: string } }[];
          };
        };
        const names = (body.rxclassDrugInfoList?.rxclassDrugInfo ?? []).map(
          (x) => x.rxclassMinConceptItem.className,
        );
        return [...new Set(names)];
      });
    },

    brandNames(ingredientRxcui) {
      if (!/^\d{1,10}$/.test(ingredientRxcui)) return Promise.resolve([]);
      return cached(`brands:${ingredientRxcui}`, DETAILS_TTL, async () =>
        conceptsOf(groupsOf(await get(`/rxcui/${ingredientRxcui}/related.json?tty=BN`)), 'BN').map(
          (c) => c.name,
        ),
      );
    },

    drugFacts(ingredientRxcui) {
      const empty: DrugFacts = {
        epcClasses: [],
        atcClasses: [],
        mayTreat: [],
        mayPrevent: [],
        avoidWith: [],
        uses: [],
      };
      if (!/^\d{1,10}$/.test(ingredientRxcui)) return Promise.resolve(empty);
      return cached(`facts:${ingredientRxcui}`, DETAILS_TTL, async () => {
        const body = (await get(`/rxclass/class/byRxcui.json?rxcui=${ingredientRxcui}`)) as {
          rxclassDrugInfoList?: {
            rxclassDrugInfo?: {
              rela?: string;
              relaSource?: string;
              rxclassMinConceptItem: { classId: string; className: string };
            }[];
          };
        };
        const uses = new Map<string, string>();
        const facts: Record<Exclude<keyof DrugFacts, 'uses'>, Set<string>> = {
          epcClasses: new Set(),
          atcClasses: new Set(),
          mayTreat: new Set(),
          mayPrevent: new Set(),
          avoidWith: new Set(),
        };
        for (const info of body.rxclassDrugInfoList?.rxclassDrugInfo ?? []) {
          const name = info.rxclassMinConceptItem.className;
          const { rela, relaSource } = info;
          if (rela === 'has_epc' && (relaSource === 'DAILYMED' || relaSource === 'FDASPL')) {
            facts.epcClasses.add(name);
          } else if (relaSource === 'ATC') {
            facts.atcClasses.add(name);
          } else if (relaSource === 'MEDRT' && rela === 'may_treat') {
            facts.mayTreat.add(name);
            uses.set(info.rxclassMinConceptItem.classId, name);
          } else if (relaSource === 'MEDRT' && rela === 'may_prevent') {
            facts.mayPrevent.add(name);
          } else if (relaSource === 'MEDRT' && rela === 'ci_with') {
            facts.avoidWith.add(name);
          }
        }
        const sorted = (set: Set<string>) => [...set].sort((a, b) => a.localeCompare(b));
        return {
          epcClasses: sorted(facts.epcClasses),
          atcClasses: sorted(facts.atcClasses),
          mayTreat: sorted(facts.mayTreat),
          mayPrevent: sorted(facts.mayPrevent),
          avoidWith: sorted(facts.avoidWith),
          uses: [...uses]
            .map(([id, name]) => ({ id, name }))
            .sort((a, b) => a.name.localeCompare(b.name)),
        };
      });
    },

    epcClasses(ingredientRxcui) {
      if (!isId(ingredientRxcui)) return Promise.resolve([]);
      return cached(`epc-ids:${ingredientRxcui}`, MONTH, async () => {
        const body = (await get(
          `/rxclass/class/byRxcui.json?rxcui=${ingredientRxcui}&relaSource=DAILYMED&relas=has_epc`,
        )) as ClassInfoList;
        const classes = new Map<string, string>();
        for (const info of body.rxclassDrugInfoList?.rxclassDrugInfo ?? []) {
          classes.set(info.rxclassMinConceptItem.classId, info.rxclassMinConceptItem.className);
        }
        return [...classes].map(([id, name]) => ({ id, name }));
      });
    },

    classMembers(epcClassId, { refresh = false } = {}) {
      if (!/^N\d{10}$/.test(epcClassId)) return Promise.resolve([]);
      return cached(
        `class-members:${epcClassId}`,
        MONTH,
        async () =>
          membersOf(
            await get(
              `/rxclass/classMembers.json?classId=${epcClassId}&relaSource=DAILYMED&rela=has_epc`,
            ),
          ),
        { refresh },
      );
    },

    diseaseMembers(diseaseId, { refresh = false } = {}) {
      if (!isDiseaseId(diseaseId)) return Promise.resolve([]);
      return cached(
        `disease-members:${diseaseId}`,
        MONTH,
        async () =>
          membersOf(
            await get(
              `/rxclass/classMembers.json?classId=${diseaseId}&relaSource=MEDRT&rela=may_treat`,
            ),
          ),
        { refresh },
      );
    },

    diseaseDescendants(diseaseId, { refresh = false } = {}) {
      if (!isDiseaseId(diseaseId)) return Promise.resolve([]);
      return cached(
        `disease-tree:${diseaseId}`,
        MONTH,
        async () => {
          const body = (await get(
            `/rxclass/classTree.json?classId=${diseaseId}&relaSource=MEDRT`,
          )) as {
            rxclassTree?: ClassTreeNode[];
          };
          const found: RxClassRef[] = [];
          const walk = (nodes: ClassTreeNode[] | undefined) => {
            for (const node of nodes ?? []) {
              const item = node.rxclassMinConceptItem;
              found.push({ id: item.classId, name: item.className });
              walk(node.rxclassTree);
            }
          };
          // The root is the condition itself; everything below it is more specific.
          walk(body.rxclassTree?.[0]?.rxclassTree);
          return found;
        },
        { refresh },
      );
    },

    toIngredient(rxcui) {
      if (!isId(rxcui)) return Promise.resolve(null);
      return cached(`to-in:${rxcui}`, MONTH, async () => {
        const ingredients = conceptsOf(
          groupsOf(await get(`/rxcui/${rxcui}/related.json?tty=IN`)),
          'IN',
        );
        return ingredients.length === 1
          ? { rxcui: ingredients[0].rxcui, name: ingredients[0].name, tty: 'IN' }
          : null;
      });
    },

    usProduct(ingredientRxcui) {
      if (!isId(ingredientRxcui)) return Promise.resolve(null);
      return cached(`us-product:${ingredientRxcui}`, MONTH, async () => {
        const products = conceptsOf(
          groupsOf(await get(`/Prescribe/rxcui/${ingredientRxcui}/related.json?tty=SCD`)),
          'SCD',
        ).filter((c) => !c.name.includes(' / ')); // combinations are not this ingredient alone
        const pick =
          products.find((c) => / Oral Tablet$/.test(c.name)) ??
          products.find((c) => / Oral Capsule$/.test(c.name)) ??
          products[0];
        return pick ? { rxcui: pick.rxcui, name: pick.name } : null;
      });
    },

    ndcs(rxcui) {
      if (!isId(rxcui)) return Promise.resolve([]);
      return cached(`ndcs:${rxcui}`, DETAILS_TTL, async () => {
        const body = (await get(`/rxcui/${rxcui}/ndcs.json`)) as {
          ndcGroup?: { ndcList?: { ndc?: string[] } };
        };
        return (body.ndcGroup?.ndcList?.ndc ?? []).filter((ndc) => /^\d{11}$/.test(ndc));
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
