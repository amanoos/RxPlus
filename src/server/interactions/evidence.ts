import type { OpenFdaClient } from '../openfda/client';
import type { RxNavClient } from '../rxnorm/client';

export interface OtherDrugTerms {
  ingredient: string;
  brands: string[];
  /** FDA established pharmacologic classes (RxClass EPC). */
  classes: string[];
}

export interface LabelEvidence {
  /** The product whose label is quoted. */
  label: string;
  missing?: true;
  manufacturer?: string | null;
  effectiveDate?: string | null;
  url?: string;
  /** Verbatim sentences mentioning the other drug (≤ 3). */
  sentences: string[];
}

export interface EvidenceSide {
  rxcui: string;
  name: string;
  ingredient: string;
  ingredientRxcui: string;
}

const MAX_SENTENCES = 3;
const MAX_LENGTH = 400;

/** How FDA labels commonly refer to these EPC classes. */
const CLASS_PHRASES: Record<string, string[]> = {
  'Angiotensin Converting Enzyme Inhibitor': [
    'ACE inhibitor',
    'angiotensin-converting enzyme inhibitor',
  ],
  'Angiotensin 2 Receptor Blocker': [
    'angiotensin receptor blocker',
    'ARB',
    'angiotensin II receptor blocker',
  ],
  'Aldosterone Antagonist': ['potassium-sparing diuretic', 'mineralocorticoid receptor antagonist'],
  'Potassium-sparing Diuretic': ['potassium-sparing diuretic'],
  'Nonsteroidal Anti-inflammatory Drug': ['NSAID', 'nonsteroidal anti-inflammatory'],
  'HMG-CoA Reductase Inhibitor': ['statin', 'HMG-CoA reductase inhibitor'],
  'Selective Serotonin Reuptake Inhibitor': ['SSRI', 'serotonin reuptake inhibitor'],
  'Serotonin and Norepinephrine Reuptake Inhibitor': ['SNRI'],
  'Monoamine Oxidase Inhibitor': ['MAOI', 'MAO inhibitor', 'monoamine oxidase inhibitor'],
  'Thiazide Diuretic': ['thiazide', 'diuretic'],
  'Thiazide-like Diuretic': ['thiazide', 'diuretic'],
  'Loop Diuretic': ['loop diuretic', 'diuretic'],
  'Macrolide Antimicrobial': ['macrolide'],
  'Azole Antifungal': ['azole antifungal'],
  'Vitamin K Antagonist': ['anticoagulant', 'vitamin K antagonist'],
  'Factor Xa Inhibitor': ['anticoagulant'],
  'Platelet Aggregation Inhibitor': ['antiplatelet', 'platelet aggregation inhibitor'],
  'Opioid Agonist': ['opioid'],
  Benzodiazepine: ['benzodiazepine', 'CNS depressant'],
  'Beta Adrenergic Blocker': ['beta-blocker', 'beta blocker', 'beta-adrenergic blocking'],
  'Calcium Channel Blocker': ['calcium channel blocker'],
  'Potassium Salt': ['potassium supplement', 'potassium-containing', 'potassium salt'],
  Sulfonylurea: ['sulfonylurea', 'antidiabetic'],
  Biguanide: ['antidiabetic'],
  Insulin: ['insulin', 'antidiabetic'],
  Lithium: ['lithium'],
};

/** Everything a label might call the other drug: name, brands, classes and their phrasings. */
export function termsFor({ ingredient, brands, classes }: OtherDrugTerms): string[] {
  return [
    ...new Set([
      ingredient,
      ...brands,
      ...classes,
      ...classes.flatMap((c) => CLASS_PHRASES[c] ?? []),
    ]),
  ].filter((t) => t.trim().length > 1);
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function termPattern(terms: string[]): RegExp {
  // Whole words; hyphens and spaces interchangeable; optional plural.
  const alternatives = terms.map((t) => escape(t.trim()).replace(/(\\-|\s)+/g, '[-\\s]+'));
  return new RegExp(`(?<![\\w-])(?:${alternatives.join('|')})(?:e?s)?(?![\\w-])`, 'i');
}

/** Sentences of `text` that mention the other drug, verbatim (≤ 3, each ≤ 400 chars). */
export function matchEvidence(text: string, other: OtherDrugTerms): string[] {
  const pattern = termPattern(termsFor(other));
  const sentences = text.split(/(?<=[.;:])\s+(?=[A-Z(•])/);
  const found: string[] = [];
  for (const raw of sentences) {
    const sentence = raw.trim();
    if (!pattern.test(sentence) || found.includes(sentence)) continue;
    found.push(
      sentence.length > MAX_LENGTH ? `${sentence.slice(0, MAX_LENGTH).trimEnd()}…` : sentence,
    );
    if (found.length === MAX_SENTENCES) break;
  }
  return found;
}

/** Label sentences from both products' FDA labels about the pair (a, b). */
export async function evidenceFor(
  pair: { a: EvidenceSide; b: EvidenceSide },
  { openFda, rxnav }: { openFda: OpenFdaClient; rxnav: RxNavClient },
): Promise<LabelEvidence[]> {
  // Brand and class names only widen the match; if RxNav is slow or down, match by name alone.
  const bestEffort = (lookup: Promise<string[]>) => lookup.catch(() => [] as string[]);
  const termsOf = async (side: EvidenceSide): Promise<OtherDrugTerms> => {
    const [brands, classes] = await Promise.all([
      bestEffort(rxnav.brandNames(side.ingredientRxcui)),
      bestEffort(rxnav.classNames(side.ingredientRxcui)),
    ]);
    return { ingredient: side.ingredient, brands, classes };
  };

  return Promise.all(
    (
      [
        [pair.a, pair.b],
        [pair.b, pair.a],
      ] as const
    ).map(async ([labelSide, other]): Promise<LabelEvidence> => {
      const [label, terms] = await Promise.all([
        openFda.interactionLabel(labelSide.rxcui),
        termsOf(other),
      ]);
      if (!label) return { label: labelSide.name, missing: true, sentences: [] };
      return {
        label: labelSide.name,
        manufacturer: label.manufacturer,
        effectiveDate: label.effectiveDate,
        url: label.dailyMedUrl,
        sentences: matchEvidence(label.text, terms),
      };
    }),
  );
}
