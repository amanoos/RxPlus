/**
 * Builds the stored alternative lists in the background: drugs in an FDA class,
 * and drugs for a condition (cleaned of drugs for a more specific form only).
 */
import type { OpenFdaClient } from '../openfda';
import type { RxNavClient } from '../rxnorm';
import type { RxConcept } from '../rxnorm/client';
import { cleanCondition, needsLabelCheck, type SpecificForm } from './clean';
import {
  listKey,
  type AlternativeDrug,
  type AlternativeList,
  type AlternativesRepository,
} from './repository';

type RxNav = Pick<
  RxNavClient,
  | 'classMembers'
  | 'diseaseMembers'
  | 'diseaseDescendants'
  | 'toIngredient'
  | 'usProduct'
  | 'epcClasses'
>;
type OpenFda = Pick<OpenFdaClient, 'approvalFacts' | 'indications'>;

interface Ingredient {
  rxcui: string;
  name: string;
}

interface Deps {
  repo: AlternativesRepository;
  rxnav: RxNav;
  openFda: OpenFda;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

/**
 * openFDA allows 240 requests/min with a key. An approval lookup is two requests,
 * so lookups start at least 500 ms apart (a label lookup is one, 250 ms).
 */
const APPROVAL_SPACING_MS = 500;
const LABEL_SPACING_MS = 250;
/** Ingredients looked up at once (RxNav paces itself). */
const CONCURRENCY = 4;

/** Background builds; tests await them via settleAlternativeJobs(). */
const jobs = new Set<Promise<void>>();

export async function settleAlternativeJobs(): Promise<void> {
  await Promise.allSettled([...jobs]);
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Runs `fn` over items, at most `limit` at a time, keeping order. */
async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

export function createAlternativesBuilder({
  repo,
  rxnav,
  openFda,
  now = Date.now,
  sleep = defaultSleep,
}: Deps) {
  // Starts spaced per kind of openFDA call; calls may still overlap in flight.
  const nextStart = { approval: 0, label: 0 };
  async function paced<T>(kind: keyof typeof nextStart, work: () => Promise<T>): Promise<T> {
    const spacing = kind === 'approval' ? APPROVAL_SPACING_MS : LABEL_SPACING_MS;
    const t = now();
    const wait = nextStart[kind] - t;
    nextStart[kind] = Math.max(t, nextStart[kind]) + spacing;
    if (wait > 0) await sleep(wait);
    return work();
  }

  /** Ingredients among class or condition members; salt forms map to their ingredient. */
  async function ingredientsOf(members: RxConcept[]): Promise<Ingredient[]> {
    const found = new Map<string, Ingredient>();
    for (const m of members)
      if (m.tty === 'IN') found.set(m.rxcui, { rxcui: m.rxcui, name: m.name });
    const salts = members.filter((m) => m.tty !== 'IN');
    const mapped = await mapLimit(salts, CONCURRENCY, (m) =>
      rxnav.toIngredient(m.rxcui).catch(() => null),
    );
    for (const ing of mapped) {
      if (ing && !found.has(ing.rxcui)) found.set(ing.rxcui, { rxcui: ing.rxcui, name: ing.name });
    }
    return [...found.values()];
  }

  /**
   * Keeps ingredients with a US single-ingredient product (dropping metabolites,
   * non-US drugs and combination-only ingredients). Failed lookups are counted.
   */
  async function available(ingredients: Ingredient[]) {
    let skipped = 0;
    const checked = await mapLimit(ingredients, CONCURRENCY, async (ing) => {
      try {
        const product = await rxnav.usProduct(ing.rxcui);
        return product ? { ...ing, productRxcui: product.rxcui } : null;
      } catch {
        skipped++;
        return null;
      }
    });
    return { drugs: checked.filter((d) => d !== null), skipped };
  }

  /** Class (unless known), first approval and generic availability for each drug. */
  async function withFacts(
    drugs: (Ingredient & { productRxcui: string })[],
    knownClass: { id: string; name: string } | null,
  ): Promise<{ drugs: AlternativeDrug[]; skipped: number }> {
    let skipped = 0;
    const results = await mapLimit(drugs, CONCURRENCY, async (drug) => {
      try {
        const cls = knownClass ?? (await rxnav.epcClasses(drug.rxcui))[0] ?? null;
        const approval = await paced('approval', () => openFda.approvalFacts(drug.name));
        return {
          ingredientRxcui: drug.rxcui,
          name: drug.name,
          classId: cls?.id ?? null,
          className: cls?.name ?? null,
          firstApproved: approval.firstApproved,
          genericAvailable: approval.genericAvailable,
          productRxcui: drug.productRxcui,
        } satisfies AlternativeDrug;
      } catch {
        skipped++;
        return null;
      }
    });
    return { drugs: results.filter((d) => d !== null), skipped };
  }

  async function buildClass(classId: string, className: string) {
    const candidates = await available(await ingredientsOf(await rxnav.classMembers(classId)));
    const facts = await withFacts(candidates.drugs, { id: classId, name: className });
    return { drugs: facts.drugs, skipped: candidates.skipped + facts.skipped };
  }

  async function buildCondition(conditionId: string, condition: string) {
    const candidates = await available(
      await ingredientsOf(await rxnav.diseaseMembers(conditionId)),
    );

    // Drugs also listed for a more specific form need a look at their labels.
    const forms: SpecificForm[] = [];
    for (const form of await rxnav.diseaseDescendants(conditionId)) {
      const members = await ingredientsOf(await rxnav.diseaseMembers(form.id));
      if (members.length) {
        forms.push({ name: form.name, ingredientRxcuis: new Set(members.map((m) => m.rxcui)) });
      }
    }
    const indications = new Map<string, string[]>();
    for (const drug of needsLabelCheck(candidates.drugs, forms)) {
      // Without label text a drug is kept, so a failed lookup is not fatal.
      const texts = await paced('label', () => openFda.indications(drug.name)).catch(() => []);
      indications.set(drug.rxcui, texts);
    }
    const { kept } = cleanCondition({
      condition,
      candidates: candidates.drugs,
      forms,
      indications,
    });

    const facts = await withFacts(kept, null);
    return { drugs: facts.drugs, skipped: candidates.skipped + facts.skipped };
  }

  async function build(list: AlternativeList, id: string): Promise<void> {
    try {
      const { drugs, skipped } =
        list.kind === 'class'
          ? await buildClass(id, list.name)
          : await buildCondition(id, list.name);
      await repo.complete(list.key, drugs, skipped);
    } catch (error) {
      const message = (error as Error).message || 'The list could not be built.';
      console.warn(`[alternatives] building ${list.key} failed: ${message}`);
      await repo.fail(list.key, message).catch((e: unknown) => {
        console.error('[alternatives] could not record the failure:', e);
      });
    }
  }

  return {
    /**
     * Starts building a list if it's new, failed, older than 30 days, or `force`d.
     * Returns the list's key; the build runs in the background.
     */
    async ensure(
      kind: AlternativeList['kind'],
      id: string,
      name: string,
      { force = false }: { force?: boolean } = {},
    ): Promise<string> {
      const key = listKey(kind, id);
      const claimed = await repo.claim(key, kind, name, { force });
      if (claimed) {
        const job = build(claimed, id);
        jobs.add(job);
        void job.finally(() => jobs.delete(job));
      }
      return key;
    },
  };
}

export type AlternativesBuilder = ReturnType<typeof createAlternativesBuilder>;
