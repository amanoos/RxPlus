// @vitest-environment node
import { ProviderUnavailableError } from '../ai/errors';
import type { TakeawayChoice } from '../literature/providers';
import type { TakeawayProvider } from '../literature/takeaways';
import type { PaperDetails, PubMedClient } from '../pubmed/client';
import { collectPapers, PAPERS_PER_INGREDIENT } from './collect-papers';

const WINDOW = { from: '2026-09-21', to: '2026-09-27' };
const ATORVASTATIN = { rxcui: '83367', name: 'atorvastatin' };
const SEARCH_URL = 'https://pubmed.ncbi.nlm.nih.gov/?term=x';

const details = (pmid: string): PaperDetails => ({
  pmid,
  title: `Paper ${pmid}`,
  journal: 'Lancet',
  year: 2026,
  pubTypes: ['Journal Article'],
  studyType: 'other',
  doi: null,
  pmcid: null,
});
const abstractOf = (pmid: string) =>
  `Background text. In paper ${pmid}, atorvastatin lowered LDL cholesterol by 40 percent in adults.`;

function setup({
  pmids = ['1', '2', '3', '4', '5', '6', '7'],
  total = 14,
  seen = [] as string[],
  choice,
}: { pmids?: string[]; total?: number; seen?: string[]; choice?: TakeawayChoice } = {}) {
  const pubmed = {
    recentPapers: vi.fn<PubMedClient['recentPapers']>(async () => ({
      pmids,
      total,
      searchUrl: SEARCH_URL,
    })),
    paperDetails: vi.fn<PubMedClient['paperDetails']>(async (ids) => ids.map(details)),
    abstracts: vi.fn<PubMedClient['abstracts']>(
      async (ids) => new Map(ids.map((id) => [id, abstractOf(id)])),
    ),
  };
  const provider: TakeawayProvider = {
    name: 'ollama',
    model: 'test',
    generate: vi.fn<TakeawayProvider['generate']>(async (papers) => ({
      raw: {
        takeaways: papers.map((p) => ({
          pmid: p.pmid,
          quote: `In paper ${p.pmid}, atorvastatin lowered LDL cholesterol by 40 percent in adults.`,
          text: 'In this study, atorvastatin lowered LDL cholesterol.',
        })),
      },
    })),
  };
  const seenFn = vi.fn(
    async (_kind: string, ids: string[]) => new Set(ids.filter((id) => seen.includes(id))),
  );
  const takeaways = vi.fn(async () => choice ?? { provider });
  return { pubmed, provider, seen: seenFn, takeaways };
}

describe('collectPapers', () => {
  it('lists the 5 most relevant new papers with takeaways and counts the rest', async () => {
    const deps = setup();
    const { items, notes } = await collectPapers(ATORVASTATIN, WINDOW, deps);

    expect(deps.pubmed.recentPapers).toHaveBeenCalledWith('atorvastatin', {
      ...WINDOW,
      limit: 20,
    });
    expect(items.filter((i) => i.kind === 'paper').map((i) => i.externalId)).toEqual([
      '1',
      '2',
      '3',
      '4',
      '5',
    ]);
    expect(items[0]).toEqual({
      kind: 'paper',
      ingredientRxcui: '83367',
      subject: 'atorvastatin',
      title: 'Paper 1',
      url: 'https://pubmed.ncbi.nlm.nih.gov/1/',
      details: { journal: 'Lancet', year: 2026, studyType: 'other' },
      takeaway: {
        text: 'In this study, atorvastatin lowered LDL cholesterol.',
        quote: 'In paper 1, atorvastatin lowered LDL cholesterol by 40 percent in adults.',
        uncited: false,
      },
      externalId: '1',
    });
    expect(items.at(-1)).toEqual({
      kind: 'more-papers',
      ingredientRxcui: '83367',
      subject: 'atorvastatin',
      title: '9 more new papers on PubMed',
      url: SEARCH_URL,
      details: { count: 9 },
    });
    expect(deps.provider.generate).toHaveBeenCalledTimes(1);
    expect(notes).toEqual([]);
    expect(PAPERS_PER_INGREDIENT).toBe(5);
  });

  it('skips papers reported in an earlier digest', async () => {
    const deps = setup({ seen: ['1', '3'] });
    const { items } = await collectPapers(ATORVASTATIN, WINDOW, deps);
    expect(items.filter((i) => i.kind === 'paper').map((i) => i.externalId)).toEqual([
      '2',
      '4',
      '5',
      '6',
      '7',
    ]);
    expect(items.at(-1)?.details).toEqual({ count: 7 });
  });

  it('adds no count when every new paper is listed', async () => {
    const deps = setup({ pmids: ['1'], total: 1 });
    const { items } = await collectPapers(ATORVASTATIN, WINDOW, deps);
    expect(items.map((i) => i.kind)).toEqual(['paper']);
  });

  it('asks nothing more when there are no new papers', async () => {
    const deps = setup({ pmids: [], total: 0 });
    expect(await collectPapers(ATORVASTATIN, WINDOW, deps)).toEqual({ items: [], notes: [] });
    expect(deps.pubmed.paperDetails).not.toHaveBeenCalled();
    expect(deps.takeaways).not.toHaveBeenCalled();
  });

  it('lists papers without takeaways, with a note, when none can be written', async () => {
    const deps = setup({
      choice: { unavailable: 'The daily limit of 20 Claude requests has been reached.' },
    });
    const { items, notes } = await collectPapers(ATORVASTATIN, WINDOW, deps);
    expect(items.filter((i) => i.kind === 'paper').every((i) => i.takeaway === null)).toBe(true);
    expect(notes).toEqual([
      "Takeaways for atorvastatin couldn't be written: The daily limit of 20 Claude requests has been reached.",
    ]);
  });

  it('lists papers without takeaways, with a note, when the model fails', async () => {
    const deps = setup();
    vi.mocked(deps.provider.generate).mockRejectedValue(
      new ProviderUnavailableError('The local model is not reachable.'),
    );
    const { items, notes } = await collectPapers(ATORVASTATIN, WINDOW, deps);
    expect(items.filter((i) => i.kind === 'paper')).toHaveLength(5);
    expect(notes).toEqual([
      "Takeaways for atorvastatin couldn't be written: The local model is not reachable.",
    ]);
  });

  it('drops advice and a takeaway for a paper that was not asked about', async () => {
    const deps = setup({ pmids: ['1', '2'], total: 2 });
    vi.mocked(deps.provider.generate).mockResolvedValue({
      raw: {
        takeaways: [
          { pmid: '1', quote: 'x', text: 'You should stop taking atorvastatin.' },
          { pmid: '99', quote: 'y', text: 'Another paper.' },
        ],
      },
    });
    const { items } = await collectPapers(ATORVASTATIN, WINDOW, deps);
    expect(items.map((i) => i.takeaway)).toEqual([null, null]);
  });

  it('notes a PubMed failure instead of failing the run', async () => {
    const deps = setup();
    deps.pubmed.recentPapers.mockRejectedValue(new Error('PubMed responded 500'));
    expect(await collectPapers(ATORVASTATIN, WINDOW, deps)).toEqual({
      items: [],
      notes: ["New papers for atorvastatin couldn't be checked: PubMed responded 500"],
    });
  });
});
