// @vitest-environment node
import type { OpenFdaClient, SummaryLabel } from '../openfda/client';
import { collectLabels } from './collect-labels';
import type { LabelVersion } from './repository';

const LISINOPRIL = { rxcui: '314076', name: 'lisinopril 10 MG Oral Tablet', subject: 'lisinopril' };
const METFORMIN = { rxcui: '861007', name: 'metformin 500 MG Oral Tablet', subject: 'metformin' };

const label = (rxcui: string, setId: string, version: string): SummaryLabel => ({
  rxcui,
  setId,
  version,
  manufacturer: null,
  effectiveDate: '2026-09-15',
  dailyMedUrl: `https://dailymed.nlm.nih.gov/dailymed/lookup.cfm?setid=${setId}`,
  sections: [],
});

function setup(
  labels: Record<string, SummaryLabel | null | Error>,
  recorded: LabelVersion[] = [],
  seen: string[] = [],
) {
  const openFda = {
    summaryLabel: vi.fn<OpenFdaClient['summaryLabel']>(async (rxcui) => {
      const found = labels[rxcui];
      if (found instanceof Error) throw found;
      return found ?? null;
    }),
  };
  return {
    openFda,
    recorded: new Map(recorded.map((v) => [v.productRxcui, v])),
    seen: vi.fn(
      async (_kind: string, ids: string[]) => new Set(ids.filter((id) => seen.includes(id))),
    ),
  };
}

describe('collectLabels', () => {
  it('records the first label seen for a product without reporting it', async () => {
    const deps = setup({ '314076': label('314076', 'set-a', '12') });
    const result = await collectLabels([LISINOPRIL], deps);
    expect(deps.openFda.summaryLabel).toHaveBeenCalledWith('314076', { refresh: true });
    expect(result).toEqual({
      items: [],
      notes: [],
      labelVersions: [{ productRxcui: '314076', setId: 'set-a', version: '12' }],
    });
  });

  it('reports a new version or set id once, and records it', async () => {
    const deps = setup(
      {
        '314076': label('314076', 'set-a', '13'),
        '861007': label('861007', 'set-b', '4'),
      },
      [
        { productRxcui: '314076', setId: 'set-a', version: '12' },
        { productRxcui: '861007', setId: 'set-b', version: '4' },
      ],
    );
    const result = await collectLabels([LISINOPRIL, METFORMIN], deps);
    expect(result.items).toEqual([
      {
        kind: 'label',
        productRxcui: '314076',
        subject: 'lisinopril',
        title: 'New FDA label for lisinopril 10 MG Oral Tablet',
        url: '/drugs/314076',
        details: {
          labelDate: '2026-09-15',
          dailyMedUrl: 'https://dailymed.nlm.nih.gov/dailymed/lookup.cfm?setid=set-a',
        },
        externalId: 'set-a:13',
      },
    ]);
    expect(result.labelVersions).toEqual([
      { productRxcui: '314076', setId: 'set-a', version: '13' },
    ]);
  });

  it('does not repeat a label version reported before', async () => {
    const deps = setup(
      { '314076': label('314076', 'set-a', '13') },
      [{ productRxcui: '314076', setId: 'set-a', version: '12' }],
      ['set-a:13'],
    );
    const result = await collectLabels([LISINOPRIL], deps);
    expect(result.items).toEqual([]);
    expect(result.labelVersions).toHaveLength(1);
  });

  it('skips products without a label and notes lookups that failed', async () => {
    const deps = setup({ '314076': null, '861007': new Error('openFDA responded 500') });
    expect(await collectLabels([LISINOPRIL, METFORMIN], deps)).toEqual({
      items: [],
      notes: [
        "The FDA label for metformin 500 MG Oral Tablet couldn't be checked: openFDA responded 500",
      ],
      labelVersions: [],
    });
  });
});
