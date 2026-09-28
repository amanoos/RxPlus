import type { Digest, DigestItem, DigestsResponse } from './digest';

/** Test helpers: a week with lisinopril news. */
export function digestItemFixture(overrides: Partial<DigestItem> = {}): DigestItem {
  return {
    id: 'i1',
    kind: 'paper',
    title: 'Lisinopril and kidney outcomes',
    url: 'https://pubmed.ncbi.nlm.nih.gov/101/',
    ingredientRxcui: '29046',
    productRxcui: null,
    conditionId: null,
    details: { journal: 'Hypertension', year: 2026, studyType: 'rct' },
    takeaway: {
      text: 'In this trial, lisinopril slowed kidney decline.',
      quote: 'Lisinopril slowed the decline in kidney function compared with placebo.',
      uncited: false,
    },
    read: false,
    ...overrides,
  };
}

export function digestFixture(overrides: Partial<Digest> = {}): Digest {
  const items = [digestItemFixture()];
  return {
    id: 'd1',
    status: 'ready',
    trigger: 'schedule',
    windowStart: '2026-09-21',
    windowEnd: '2026-09-28',
    startedAt: '2026-09-28T10:00:00.000Z',
    finishedAt: '2026-09-28T10:04:00.000Z',
    error: null,
    notes: [],
    itemCount: items.length,
    unread: items.length,
    groups: [{ subject: 'lisinopril', items }],
    ...overrides,
  };
}

export function digestsFixture(overrides: Partial<DigestsResponse> = {}): DigestsResponse {
  return {
    digests: [digestFixture()],
    running: null,
    nextRun: '2026-10-05T10:00:00.000Z',
    hasActiveMedications: true,
    ...overrides,
  };
}
