import type { DrugFacts, DrugSummary, ReportedReactions } from './drug-info';

/** Test helpers for lisinopril 10 MG Oral Tablet. */
export function factsFixture(overrides: Partial<DrugFacts> = {}): DrugFacts {
  return {
    rxcui: '314076',
    name: 'lisinopril 10 MG Oral Tablet',
    tty: 'SCD',
    strength: '10 MG',
    doseForm: 'Oral Tablet',
    brandName: null,
    ingredients: [{ rxcui: '29046', name: 'lisinopril' }],
    epcClasses: ['Angiotensin Converting Enzyme Inhibitor'],
    atcClasses: ['ACE inhibitors, plain'],
    mayTreat: ['Heart Failure', 'Hypertension'],
    mayPrevent: [],
    avoidWith: ['Angioedema', 'Pregnancy'],
    uses: [
      { id: 'D006333', name: 'Heart Failure' },
      { id: 'D006973', name: 'Hypertension' },
    ],
    label: {
      setId: 'set-1',
      version: '2',
      effectiveDate: '2026-09-10',
      manufacturer: 'Maker',
      dailyMedUrl: 'https://dailymed.nlm.nih.gov/dailymed/lookup.cfm?setid=set-1',
    },
    medlinePlus: [
      {
        ingredient: 'lisinopril',
        title: 'Lisinopril',
        url: 'https://medlineplus.gov/druginfo/meds/a692051.html',
      },
    ],
    unavailable: [],
    ...overrides,
  };
}

export function reactionsFixture(): ReportedReactions {
  return {
    ingredients: [
      {
        ingredient: 'lisinopril',
        total: 304318,
        reactions: [
          { term: 'COUGH', count: 17000 },
          { term: 'DIZZINESS', count: 12000 },
        ],
      },
    ],
    disclaimer: 'Reports submitted to the FDA by patients and professionals.',
  };
}

export function summaryFixture(overrides: Partial<DrugSummary> = {}): DrugSummary {
  return {
    status: 'ready',
    provider: 'ollama',
    model: 'qwen2.5:7b',
    label: {
      setId: 'set-1',
      version: '2',
      effectiveDate: '2026-09-10',
      dailyMedUrl: 'https://dailymed.nlm.nih.gov/dailymed/lookup.cfm?setid=set-1',
    },
    sections: [
      {
        heading: "What it's for",
        sentences: [
          {
            text: 'It treats high blood pressure.',
            citations: [
              { labelSection: 'indications_and_usage', text: 'treatment of hypertension' },
            ],
            uncited: false,
          },
          { text: 'It is gentle on the stomach.', citations: [], uncited: true },
        ],
      },
      {
        heading: 'How well it works',
        sentences: [
          { text: 'The label doesn’t say.', citations: [], uncited: false, noSupport: true },
        ],
      },
    ],
    sentenceCount: 2,
    uncitedCount: 1,
    removedAdvice: 0,
    lowCitation: true,
    error: null,
    startedAt: '2026-09-27T17:52:42.906Z',
    completedAt: '2026-09-27T17:56:40.000Z',
    ...overrides,
  };
}
