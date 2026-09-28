/** Client-side shapes of the /api/drugs/:rxcui/literature responses. */

export type StudyType = 'meta-analysis' | 'systematic-review' | 'rct' | 'other';

export interface PaperTakeaway {
  /** Empty when the model gave no usable takeaway for this paper. */
  text: string;
  /** Abstract sentence the takeaway rewrites; null when it couldn't be verified. */
  quote: string | null;
  uncited: boolean;
  /** Only with a check model: false when the quote doesn't back up the takeaway. */
  supported?: boolean | null;
  /** Speaks to the reader or recommends, instead of describing the study. */
  readerDirected?: boolean;
}

/** Who or what a paper studied, from its title and abstract. */
export type StudySubject = 'review' | 'animal' | 'lab' | 'human';

const SUBJECT_LABELS: Record<StudySubject, string> = {
  review: 'Review of studies',
  animal: 'Animal study',
  lab: 'Lab study',
  human: 'Study in people',
};

/** "Animal study"; null when unknown. */
export const studySubjectLabel = (subject: StudySubject | null | undefined) =>
  subject ? SUBJECT_LABELS[subject] : null;

export interface Paper {
  pmid: string;
  tier: 'review' | 'rct';
  studyType: StudyType;
  /** Who or what was studied (optional: older answers lack it). */
  studySubject?: StudySubject | null;
  title: string;
  journal: string | null;
  year: number | null;
  pubmedUrl: string;
  fullTextUrl: string | null;
  takeaway: PaperTakeaway | null;
}

export interface Trial {
  nctId: string;
  title: string;
  status: string;
  phases: string[];
  hasResults: boolean;
  startDate: string | null;
  url: string;
}

export interface TakeawayJob {
  status: 'none' | 'pending' | 'ready' | 'failed';
  provider: 'ollama' | 'claude' | null;
  model: string | null;
  error: string | null;
  startedAt: string | null;
}

export interface IngredientLiterature {
  rxcui: string;
  name: string;
  fetchedAt: string;
  papers: Paper[];
  hidden: Paper[];
  trials: Trial[];
  takeaways: TakeawayJob;
}

export interface LiteratureResponse {
  ingredients: IngredientLiterature[];
}

/** Papers shown without a takeaway (not yet written), per ingredient. */
export const needsTakeaways = (lit: IngredientLiterature) =>
  lit.papers.some((p) => p.takeaway === null);
