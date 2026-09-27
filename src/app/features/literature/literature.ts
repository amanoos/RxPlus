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
}

export interface Paper {
  pmid: string;
  tier: 'review' | 'rct';
  studyType: StudyType;
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
