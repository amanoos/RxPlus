/**
 * Cleaning a condition's drug list. MED-RT lists drugs for a more specific form
 * of a condition under the condition too (e.g. pulmonary arterial hypertension
 * drugs under "Hypertension"). Those drugs are kept only if their FDA labels
 * mention the condition outside that specific form.
 */

export interface SpecificForm {
  /** MED-RT name, e.g. "Hypertension, Pulmonary". */
  name: string;
  /** Ingredients MED-RT lists for this form. */
  ingredientRxcuis: Set<string>;
}

/**
 * The word(s) that make a form specific, e.g. "Hypertension, Pulmonary" →
 * "pulmonary", "Isolated Systolic Hypertension" → "isolated systolic". Null when
 * the form's name doesn't contain the condition (e.g. "Hypertensive Crisis").
 */
export function qualifierOf(formName: string, condition: string): string | null {
  const form = formName.toLowerCase();
  const term = condition.toLowerCase();
  if (!form.includes(term)) return null;
  const qualifier = form
    .replace(term, ' ')
    .replace(/[^a-z-]+/g, ' ')
    .trim();
  return qualifier || null;
}

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Whether label texts mention the condition other than as one of the given
 * specific forms ("pulmonary arterial hypertension" doesn't count as
 * "hypertension"; "essential hypertension" does unless "essential" is a qualifier).
 */
export function mentionsCondition(
  texts: string[],
  condition: string,
  qualifiers: string[],
): boolean {
  const term = escape(condition.toLowerCase());
  const specific = qualifiers.map(
    // The qualifier, up to one more word ("pulmonary arterial"), then the condition.
    (q) => new RegExp(`\\b${escape(q)}(?:\\s+[a-z-]+)?\\s+${term}\\b`, 'g'),
  );
  return texts.some((text) => {
    let rest = text.toLowerCase();
    for (const pattern of specific) rest = rest.replace(pattern, ' ');
    return new RegExp(`\\b${term}\\b`).test(rest);
  });
}

export interface CleanInput<T extends { rxcui: string }> {
  condition: string;
  candidates: T[];
  forms: SpecificForm[];
  /** Label indications per ingredient, for the candidates that need a check. */
  indications: Map<string, string[]>;
}

/** Candidates also listed for a specific form, which need a label check. */
export function needsLabelCheck<T extends { rxcui: string }>(
  candidates: T[],
  forms: SpecificForm[],
): T[] {
  return candidates.filter((c) => forms.some((f) => f.ingredientRxcuis.has(c.rxcui)));
}

/**
 * Keeps each candidate unless it's listed for a specific form and none of its
 * labels mention the condition otherwise. Without label text, it's kept (Hide
 * covers what this misses).
 */
export function cleanCondition<T extends { rxcui: string }>({
  condition,
  candidates,
  forms,
  indications,
}: CleanInput<T>): { kept: T[]; dropped: T[] } {
  const kept: T[] = [];
  const dropped: T[] = [];
  for (const candidate of candidates) {
    const qualifiers = forms
      .filter((f) => f.ingredientRxcuis.has(candidate.rxcui))
      .map((f) => qualifierOf(f.name, condition))
      .filter((q): q is string => q !== null);
    const texts = indications.get(candidate.rxcui) ?? [];
    const keep =
      !qualifiers.length || !texts.length || mentionsCondition(texts, condition, qualifiers);
    (keep ? kept : dropped).push(candidate);
  }
  return { kept, dropped };
}
