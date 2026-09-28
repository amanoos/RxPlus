// @vitest-environment node
import type { AlternativeDrug, AlternativeList } from '../alternatives/repository';
import { collectApprovals } from './collect-approvals';

const HTN = { id: 'D006973', name: 'Hypertension' };
const TODAY = '2026-09-27';

const drug = (rxcui: string, name: string, firstApproved: string | null): AlternativeDrug => ({
  ingredientRxcui: rxcui,
  name,
  classId: null,
  className: null,
  firstApproved,
  genericAvailable: false,
  productRxcui: `p${rxcui}`,
});
const OLD = [drug('29046', 'lisinopril', '1987-12-29')];

const list = (overrides: Partial<AlternativeList> = {}): AlternativeList => ({
  key: 'condition:D006973',
  kind: 'condition',
  name: 'Hypertension',
  status: 'ready',
  startedAt: new Date(),
  builtAt: new Date(),
  skipped: 0,
  error: null,
  ...overrides,
});

/** `before`: the list and drugs before the rebuild; `after`: what the rebuild leaves. */
function setup({
  before,
  after,
  seen = [],
}: {
  before: { list: AlternativeList | null; drugs: AlternativeDrug[] };
  after: { list: AlternativeList; drugs: AlternativeDrug[] };
  seen?: string[];
}) {
  let state = before;
  const alternatives = {
    list: vi.fn(async () => state.list),
    drugs: vi.fn(async () => state.drugs),
  };
  const builder = {
    rebuild: vi.fn(async () => {
      state = after;
      return 'condition:D006973';
    }),
  };
  return {
    alternatives,
    builder,
    today: TODAY,
    seen: vi.fn(
      async (_kind: string, ids: string[]) => new Set(ids.filter((id) => seen.includes(id))),
    ),
  };
}

describe('collectApprovals', () => {
  it('reports drugs newly listed for the condition and approved within 5 years', async () => {
    const deps = setup({
      before: { list: list(), drugs: OLD },
      after: {
        list: list(),
        drugs: [
          ...OLD,
          drug('2679059', 'aprocitentan', '2024-03-19'),
          drug('1000', 'older drug', '2019-01-01'),
          drug('1001', 'unknown date', null),
        ],
      },
    });
    const { items, notes } = await collectApprovals(HTN, deps);

    expect(deps.builder.rebuild).toHaveBeenCalledWith('condition', 'D006973', 'Hypertension');
    expect(items).toEqual([
      {
        kind: 'approval',
        ingredientRxcui: '2679059',
        productRxcui: 'p2679059',
        conditionId: 'D006973',
        subject: 'Hypertension',
        title: 'aprocitentan',
        url: '/drugs/p2679059',
        details: { condition: 'Hypertension', firstApproved: '2024-03-19' },
        externalId: 'D006973:2679059',
      },
    ]);
    expect(notes).toEqual([]);
  });

  it('treats the first build of a condition as a baseline', async () => {
    const deps = setup({
      before: { list: null, drugs: [] },
      after: { list: list(), drugs: [...OLD, drug('2679059', 'aprocitentan', '2024-03-19')] },
    });
    expect(await collectApprovals(HTN, deps)).toEqual({ items: [], notes: [] });
  });

  it('does not repeat a drug reported before', async () => {
    const deps = setup({
      before: { list: list(), drugs: OLD },
      after: { list: list(), drugs: [...OLD, drug('2679059', 'aprocitentan', '2024-03-19')] },
      seen: ['D006973:2679059'],
    });
    expect((await collectApprovals(HTN, deps)).items).toEqual([]);
  });

  it('notes a failed rebuild', async () => {
    const deps = setup({
      before: { list: list(), drugs: OLD },
      after: { list: list({ status: 'failed', error: 'RxNav unreachable' }), drugs: OLD },
    });
    expect(await collectApprovals(HTN, deps)).toEqual({
      items: [],
      notes: ["New drugs for Hypertension couldn't be checked: RxNav unreachable"],
    });
  });

  it('notes an error while reading the list', async () => {
    const deps = setup({
      before: { list: list(), drugs: OLD },
      after: { list: list(), drugs: OLD },
    });
    deps.builder.rebuild.mockRejectedValue(new Error('database gone'));
    expect((await collectApprovals(HTN, deps)).notes).toEqual([
      "New drugs for Hypertension couldn't be checked: database gone",
    ]);
  });
});
