/**
 * Turns stored lists into what the drug page shows: newly approved drugs for the
 * condition, drugs in the same class, and other classes for the condition.
 */
import type { AlternativeDrug } from './repository';

/** First approved within this many years counts as new. */
export const NEW_WITHIN_YEARS = 5;

/** Whether a first approval (YYYY-MM-DD) is within NEW_WITHIN_YEARS of `today`. */
export function isNewApproval(firstApproved: string | null, today: string): boolean {
  const since = `${Number(today.slice(0, 4)) - NEW_WITHIN_YEARS}${today.slice(4)}`;
  return firstApproved !== null && firstApproved >= since;
}

export interface AlternativeView extends AlternativeDrug {
  /** First approval year, when known. */
  approvedYear: number | null;
  isNew: boolean;
}

export interface OtherClass {
  classId: string | null;
  className: string;
  drugs: AlternativeView[];
}

export interface AlternativeGroups {
  newForCondition: AlternativeView[];
  sameClass: AlternativeView[];
  otherClasses: OtherClass[];
  hidden: AlternativeView[];
}

export interface GroupInput {
  /** The ingredient of the drug being viewed (never listed as its own alternative). */
  ingredientRxcui: string;
  /** Its FDA class, if any. */
  classId: string | null;
  /** Drugs in that class (null when the list isn't built yet). */
  classDrugs: AlternativeDrug[] | null;
  /** Drugs for the chosen condition (null when none is chosen or it isn't built yet). */
  conditionDrugs: AlternativeDrug[] | null;
  /** Ingredients hidden for this drug. */
  hidden: string[];
  /** YYYY-MM-DD */
  today: string;
}

const byName = (a: AlternativeDrug, b: AlternativeDrug) => a.name.localeCompare(b.name);

export function groupAlternatives({
  ingredientRxcui,
  classId,
  classDrugs,
  conditionDrugs,
  hidden,
  today,
}: GroupInput): AlternativeGroups {
  const view = (drug: AlternativeDrug): AlternativeView => ({
    ...drug,
    approvedYear: drug.firstApproved ? Number(drug.firstApproved.slice(0, 4)) : null,
    isNew: isNewApproval(drug.firstApproved, today),
  });
  const hiddenSet = new Set(hidden);
  const hiddenViews = new Map<string, AlternativeView>();
  const visible = (drugs: AlternativeDrug[]) =>
    drugs
      .filter((d) => d.ingredientRxcui !== ingredientRxcui)
      .filter((d) => {
        if (!hiddenSet.has(d.ingredientRxcui)) return true;
        hiddenViews.set(d.ingredientRxcui, view(d));
        return false;
      })
      .sort(byName)
      .map(view);

  const sameClass = visible(classDrugs ?? []);
  const inSameClass = new Set(sameClass.map((d) => d.ingredientRxcui));
  const forCondition = visible(conditionDrugs ?? []);

  const others = new Map<string, OtherClass>();
  for (const drug of forCondition) {
    const sameAsViewed = classId !== null && drug.classId === classId;
    if (sameAsViewed || inSameClass.has(drug.ingredientRxcui)) continue;
    const key = drug.classId ?? drug.className ?? 'other';
    const group = others.get(key) ?? {
      classId: drug.classId,
      className: drug.className ?? 'Other',
      drugs: [],
    };
    group.drugs.push(drug);
    others.set(key, group);
  }

  return {
    newForCondition: forCondition.filter((d) => d.isNew),
    sameClass,
    otherClasses: [...others.values()].sort((a, b) =>
      // "Other" (no class) last, the rest by name.
      a.classId === null ? 1 : b.classId === null ? -1 : a.className.localeCompare(b.className),
    ),
    hidden: [...hiddenViews.values()].sort(byName),
  };
}
