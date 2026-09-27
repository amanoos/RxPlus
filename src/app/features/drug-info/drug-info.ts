/** Client-side shapes of the /api/drugs/:rxcui responses. */

export const POLL_INTERVAL_MS = 2_000;
/** The local model can take several minutes; the server gives it 10 (+ one retry). */
export const MAX_POLL_MS = 12 * 60_000;

export interface DrugFacts {
  rxcui: string;
  name: string;
  tty: 'SCD' | 'SBD';
  strength: string | null;
  doseForm: string | null;
  brandName: string | null;
  ingredients: { rxcui: string; name: string }[];
  epcClasses: string[];
  atcClasses: string[];
  mayTreat: string[];
  mayPrevent: string[];
  avoidWith: string[];
  label: {
    setId: string;
    version: string;
    effectiveDate: string | null;
    manufacturer: string | null;
    dailyMedUrl: string;
  } | null;
  medlinePlus: { ingredient: string; title: string; url: string }[];
  unavailable: ('RxClass' | 'FDA label' | 'MedlinePlus')[];
}

export interface ReportedReactions {
  ingredients: {
    ingredient: string;
    total: number;
    reactions: { term: string; count: number }[];
  }[];
  disclaimer: string;
}

export interface SummaryCitation {
  labelSection: string;
  text: string;
}

export interface SummarySentence {
  text: string;
  citations: SummaryCitation[];
  uncited: boolean;
  noSupport?: true;
}

export interface DrugSummary {
  status: 'pending' | 'ready' | 'failed';
  provider: 'ollama' | 'claude';
  model: string;
  label: { setId: string; version: string; effectiveDate: string | null; dailyMedUrl: string };
  sections: { heading: string; sentences: SummarySentence[] }[] | null;
  sentenceCount: number | null;
  uncitedCount: number | null;
  removedAdvice: number | null;
  lowCitation: boolean;
  error: string | null;
  startedAt: string;
  completedAt: string | null;
}

/** FDA label section ids as readable names, for the citation popover. */
export const LABEL_SECTION_NAMES: Record<string, string> = {
  indications_and_usage: 'Indications and usage',
  boxed_warning: 'Boxed warning',
  contraindications: 'Contraindications',
  warnings_and_cautions: 'Warnings and precautions',
  warnings: 'Warnings',
  adverse_reactions: 'Adverse reactions',
  clinical_studies: 'Clinical studies',
  mechanism_of_action: 'Mechanism of action',
  information_for_patients: 'Information for patients',
};
