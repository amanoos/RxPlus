import type { IngredientLiterature, LiteratureResponse, Paper, TakeawayJob } from './literature';

/** Test helpers: lisinopril research lists. */
export function paperFixture(overrides: Partial<Paper> = {}): Paper {
  const pmid = overrides.pmid ?? '37417783';
  return {
    pmid,
    tier: 'review',
    studyType: 'meta-analysis',
    title: 'ACE inhibitor induced cough compared with placebo: a network meta-analysis',
    journal: 'J Clin Hypertens (Greenwich)',
    year: 2023,
    pubmedUrl: `https://pubmed.ncbi.nlm.nih.gov/${pmid}/`,
    fullTextUrl: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC10423763/',
    takeaway: {
      text: 'In this review, cough was more common with ACE inhibitors than with placebo.',
      quote: 'ACEIs were associated with a higher risk of cough than placebo.',
      uncited: false,
    },
    ...overrides,
  };
}

export function ingredientFixture(
  overrides: Partial<IngredientLiterature> = {},
  takeaways: Partial<TakeawayJob> = {},
): IngredientLiterature {
  return {
    rxcui: '29046',
    name: 'lisinopril',
    fetchedAt: '2026-09-27T20:00:00.000Z',
    papers: [
      paperFixture(),
      paperFixture({
        pmid: '10587334',
        tier: 'rct',
        studyType: 'rct',
        title: 'Low and high doses of lisinopril in chronic heart failure (ATLAS)',
        journal: 'Circulation',
        year: 1999,
        fullTextUrl: null,
        takeaway: {
          text: 'In this trial, higher doses led to fewer hospital stays.',
          quote: 'a significant 12% lower risk of death or hospitalization for any reason',
          uncited: false,
        },
      }),
    ],
    hidden: [],
    trials: [
      {
        nctId: 'NCT05049616',
        title: 'Oral Combined Hydrochlorothiazide/Lisinopril Versus Oral Nifedipine',
        status: 'COMPLETED',
        phases: ['PHASE4'],
        hasResults: true,
        startDate: '2021-10-18',
        url: 'https://clinicaltrials.gov/study/NCT05049616',
      },
      {
        nctId: 'NCT07594535',
        title: 'The Effect Of Lisinopril On Polycythemia',
        status: 'RECRUITING',
        phases: ['PHASE4'],
        hasResults: false,
        startDate: '2026-07-01',
        url: 'https://clinicaltrials.gov/study/NCT07594535',
      },
    ],
    takeaways: {
      status: 'ready',
      provider: 'ollama',
      model: 'qwen2.5:7b',
      error: null,
      startedAt: '2026-09-27T20:01:00.000Z',
      ...takeaways,
    },
    ...overrides,
  };
}

export function literatureFixture(...ingredients: IngredientLiterature[]): LiteratureResponse {
  return { ingredients: ingredients.length ? ingredients : [ingredientFixture()] };
}
