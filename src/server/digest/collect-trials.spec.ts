// @vitest-environment node
import type { CtGovClient, TrialUpdate } from '../ctgov/client';
import { collectTrials } from './collect-trials';

const WINDOW = { from: '2026-09-21', to: '2026-09-27' };
const LISINOPRIL = { rxcui: '29046', name: 'lisinopril' };

const update = (nctId: string, overrides: Partial<TrialUpdate> = {}): TrialUpdate => ({
  nctId,
  title: `Trial ${nctId}`,
  status: 'RECRUITING',
  phases: ['PHASE4'],
  hasResults: false,
  startDate: '2026-01',
  lastUpdate: '2026-09-24',
  firstPosted: '2024-01-01',
  resultsFirstPosted: null,
  ...overrides,
});

function setup(updates: TrialUpdate[], seen: string[] = []) {
  const ctgov = { recentUpdates: vi.fn<CtGovClient['recentUpdates']>(async () => updates) };
  const seenFn = vi.fn(
    async (_kind: string, ids: string[]) => new Set(ids.filter((id) => seen.includes(id))),
  );
  return { ctgov, seen: seenFn };
}

describe('collectTrials', () => {
  it('reports trials first posted, or with results first posted, in the window', async () => {
    const deps = setup([
      update('NCT1', { firstPosted: '2026-09-21' }),
      update('NCT2', { resultsFirstPosted: '2026-09-27', hasResults: true, status: 'COMPLETED' }),
      update('NCT3'),
      update('NCT4', { firstPosted: '2026-09-28' }),
      update('NCT5', { resultsFirstPosted: '2026-09-20' }),
    ]);
    const { items, notes } = await collectTrials(LISINOPRIL, WINDOW, deps);

    expect(deps.ctgov.recentUpdates).toHaveBeenCalledWith('lisinopril', '2026-09-21');
    expect(items).toEqual([
      {
        kind: 'trial',
        ingredientRxcui: '29046',
        subject: 'lisinopril',
        title: 'Trial NCT1',
        url: 'https://clinicaltrials.gov/study/NCT1',
        details: { nctId: 'NCT1', event: 'new', status: 'RECRUITING', phases: ['PHASE4'] },
        externalId: 'NCT1:new',
      },
      expect.objectContaining({
        externalId: 'NCT2:results',
        details: { nctId: 'NCT2', event: 'results', status: 'COMPLETED', phases: ['PHASE4'] },
      }),
    ]);
    expect(deps.seen).toHaveBeenCalledWith('trial', ['NCT1:new', 'NCT2:results']);
    expect(notes).toEqual([]);
  });

  it('skips news reported before, but reports results for a trial reported as new', async () => {
    const deps = setup(
      [
        update('NCT1', { firstPosted: '2026-09-22' }),
        update('NCT2', { resultsFirstPosted: '2026-09-22' }),
      ],
      ['NCT1:new', 'NCT2:new'],
    );
    const { items } = await collectTrials(LISINOPRIL, WINDOW, deps);
    expect(items.map((i) => i.externalId)).toEqual(['NCT2:results']);
  });

  it('notes a ClinicalTrials.gov failure instead of failing the run', async () => {
    const deps = setup([]);
    deps.ctgov.recentUpdates.mockRejectedValue(new Error('ClinicalTrials.gov responded 503'));
    expect(await collectTrials(LISINOPRIL, WINDOW, deps)).toEqual({
      items: [],
      notes: ["Trials for lisinopril couldn't be checked: ClinicalTrials.gov responded 503"],
    });
  });
});
