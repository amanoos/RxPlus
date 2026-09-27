/** Shapes returned by /api/interactions/* (see SPEC-interactions.md). */

export type InteractionLevel = 'Major' | 'Moderate' | 'Minor' | 'Unknown';

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
  level: InteractionLevel;
}

export interface InteractionReport {
  results: InteractionResult[];
  notCovered: { rxcui: string; name: string; ingredient: string }[];
  source: { name: string; license: string; url: string; importedAt: string };
}

export interface LabelEvidence {
  label: string;
  missing?: true;
  manufacturer?: string | null;
  effectiveDate?: string | null;
  url?: string;
  sentences: string[];
}

export interface EvidenceQuery {
  a: string;
  aIngredient: string;
  b: string;
  bIngredient: string;
}

/** Stable key for one ingredient pair in a report. */
export function pairKey(result: InteractionResult): string {
  return `${result.a.rxcui}:${result.a.ingredientRxcui}|${result.b.rxcui}:${result.b.ingredientRxcui}`;
}

export function evidenceQuery(result: InteractionResult): EvidenceQuery {
  return {
    a: result.a.rxcui,
    aIngredient: result.a.ingredientRxcui,
    b: result.b.rxcui,
    bIngredient: result.b.ingredientRxcui,
  };
}
