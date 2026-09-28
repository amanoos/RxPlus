/** Client-side shapes of the /api/drugs/:rxcui/alternatives responses. */

export interface Condition {
  id: string;
  name: string;
}

export interface Alternative {
  ingredientRxcui: string;
  name: string;
  classId: string | null;
  className: string | null;
  /** YYYY-MM-DD */
  firstApproved: string | null;
  approvedYear: number | null;
  genericAvailable: boolean;
  isNew: boolean;
  /** A representative product, for the link to its drug page. */
  productRxcui: string | null;
}

export interface OtherClass {
  classId: string | null;
  className: string;
  drugs: Alternative[];
}

export interface AlternativeGroups {
  newForCondition: Alternative[];
  sameClass: Alternative[];
  otherClasses: OtherClass[];
  hidden: Alternative[];
}

export interface ListStatus {
  status: 'pending' | 'ready' | 'failed';
  builtAt: string | null;
  skipped: number | null;
  error: string | null;
}

export interface IngredientAlternatives {
  rxcui: string;
  name: string;
  drugClass: Condition | null;
  classList: ListStatus | null;
  conditionList: ListStatus | null;
  groups: AlternativeGroups;
}

export interface AlternativesResponse {
  uses: Condition[];
  condition: Condition | null;
  conditionSource: 'medication' | 'visit' | null;
  medicationId: string | null;
  ingredients: IngredientAlternatives[];
}

/** Any list still building (first build or rebuild). */
export const anyBuilding = (data: AlternativesResponse) =>
  data.ingredients.some(
    (i) => i.classList?.status === 'pending' || i.conditionList?.status === 'pending',
  );

/** Build polling: every 2 s, for at most 5 minutes (a first build takes about a minute). */
export const ALTERNATIVES_POLL_MS = 2_000;
export const ALTERNATIVES_MAX_POLL_MS = 5 * 60_000;
