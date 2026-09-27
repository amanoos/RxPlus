import { SEVERITY, type DdiPair, type Level } from './ddinter';

/** A product being checked: a candidate or one of the owner's current medications. */
export interface CheckedDrug {
  rxcui: string;
  name: string;
  doseForm: string | null;
  ingredients: { rxcui: string; name: string }[];
  medicationId?: string;
}

export interface DdiDrug {
  ddinterId: string;
  ingredientRxcui: string | null;
  route: string | null;
}

export interface ReportSide {
  rxcui: string;
  name: string;
  ingredient: string;
  ingredientRxcui: string;
  medicationId?: string;
}

export interface InteractionResult {
  a: ReportSide;
  b: ReportSide;
  level: Level;
}

export interface InteractionReport {
  results: InteractionResult[];
  notCovered: { rxcui: string; name: string; ingredient: string }[];
}

/** Which RxNorm dose forms a DDInter route qualifier applies to. */
const ROUTE_FORMS: Record<string, RegExp> = {
  topical: /topical|cutaneous|cream|ointment|lotion|shampoo|foam/i,
  ophthalmic: /ophthalmic/i,
  otic: /otic/i,
  nasal: /nasal/i,
  inhalation: /inhal/i,
  vaginal: /vaginal/i,
  rectal: /rectal|suppository|enema/i,
  transdermal: /transdermal/i,
};

/**
 * Applies the spec's matching rules: per ingredient; route-qualified DDInter
 * entries only for matching dose forms; shared ingredients ignored; the most
 * severe level per ingredient pair; ingredients absent from DDInter reported.
 */
export function buildReport({
  candidate,
  current,
  ddiDrugs,
  pairs,
}: {
  candidate?: CheckedDrug;
  current: CheckedDrug[];
  ddiDrugs: DdiDrug[];
  pairs: DdiPair[];
}): InteractionReport {
  const levels = new Map(pairs.map((p) => [`${p.drugA}|${p.drugB}`, p.level]));
  const byIngredient = new Map<string, DdiDrug[]>();
  for (const d of ddiDrugs) {
    if (!d.ingredientRxcui) continue;
    byIngredient.set(d.ingredientRxcui, [...(byIngredient.get(d.ingredientRxcui) ?? []), d]);
  }
  const entriesFor = (ingredientRxcui: string, doseForm: string | null) =>
    (byIngredient.get(ingredientRxcui) ?? []).filter(
      (d) => !d.route || (doseForm !== null && ROUTE_FORMS[d.route]?.test(doseForm)),
    );

  const comparisons: [CheckedDrug, CheckedDrug][] = candidate
    ? current.map((med) => [candidate, med])
    : current.flatMap((a, i) =>
        current.slice(i + 1).map((b): [CheckedDrug, CheckedDrug] => [a, b]),
      );

  const results: InteractionResult[] = [];
  for (const [x, y] of comparisons) {
    // An ingredient in both products is not an interaction (either direction).
    const inX = new Set(x.ingredients.map((i) => i.rxcui));
    const inY = new Set(y.ingredients.map((i) => i.rxcui));
    for (const ix of x.ingredients) {
      if (inY.has(ix.rxcui)) continue;
      for (const iy of y.ingredients) {
        if (inX.has(iy.rxcui)) continue;
        let level: Level | undefined;
        for (const dx of entriesFor(ix.rxcui, x.doseForm)) {
          for (const dy of entriesFor(iy.rxcui, y.doseForm)) {
            const key =
              dx.ddinterId < dy.ddinterId
                ? `${dx.ddinterId}|${dy.ddinterId}`
                : `${dy.ddinterId}|${dx.ddinterId}`;
            const found = levels.get(key);
            if (found && (!level || SEVERITY[found] > SEVERITY[level])) level = found;
          }
        }
        if (level) results.push({ a: side(x, ix), b: side(y, iy), level });
      }
    }
  }

  results.sort(
    (r1, r2) =>
      SEVERITY[r2.level] - SEVERITY[r1.level] ||
      r1.a.name.localeCompare(r2.a.name) ||
      r1.b.name.localeCompare(r2.b.name),
  );

  const seen = new Set<string>();
  const notCovered = [...(candidate ? [candidate] : []), ...current].flatMap((d) =>
    d.ingredients
      .filter((i) => !byIngredient.has(i.rxcui) && !seen.has(i.rxcui) && seen.add(i.rxcui))
      .map((i) => ({ rxcui: d.rxcui, name: d.name, ingredient: i.name })),
  );

  return { results, notCovered };
}

function side(drug: CheckedDrug, ingredient: { rxcui: string; name: string }): ReportSide {
  return {
    rxcui: drug.rxcui,
    name: drug.name,
    ingredient: ingredient.name,
    ingredientRxcui: ingredient.rxcui,
    ...(drug.medicationId ? { medicationId: drug.medicationId } : {}),
  };
}
