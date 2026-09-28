// @vitest-environment node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { createPubMedClient, parseAbstracts, PubMedUnavailableError } from './client';

const fixture = (name: string) => readFileSync(join(import.meta.dirname, 'fixtures', name), 'utf8');
const BASE = 'https://eutils.test/entrez/eutils';

/** Routes each request by endpoint (and, for esearch, by tier). */
function stubFetch(
  overrides: Partial<Record<'reviews' | 'rcts' | 'summary' | 'fetch', string>> = {},
) {
  const calls: URL[] = [];
  const fetchFn = vi.fn(async (input: string | URL | Request) => {
    const url = new URL(String(input));
    calls.push(url);
    const term = url.searchParams.get('term') ?? '';
    let body: string;
    if (url.pathname.endsWith('/esearch.fcgi')) {
      body = term.includes('[tiab]')
        ? (overrides.reviews ?? fixture('esearch-reviews-lisinopril.json'))
        : (overrides.rcts ?? fixture('esearch-rcts-lisinopril.json'));
    } else if (url.pathname.endsWith('/esummary.fcgi')) {
      body = overrides.summary ?? fixture('esummary-4.json');
    } else {
      body = overrides.fetch ?? fixture('efetch-4.xml');
    }
    return new Response(body, { status: 200 });
  });
  return { fetchFn, calls };
}

describe('PubMed client', () => {
  const create = (fetchFn: typeof fetch, options: { apiKey?: string; email?: string } = {}) =>
    createPubMedClient({
      baseUrl: BASE,
      fetch: fetchFn,
      sleep: async () => undefined,
      ...options,
    });

  it('searches reviews by title/abstract and randomized trials by major topic', async () => {
    const { fetchFn, calls } = stubFetch();
    const result = await create(fetchFn, { email: 'me@example.com' }).searchPapers('Lisinopril');

    expect(calls.map((u) => u.searchParams.get('term'))).toEqual([
      '"lisinopril"[tiab] AND (meta-analysis[pt] OR systematic review[pt]) AND hasabstract',
      '"lisinopril"[majr] AND randomized controlled trial[pt] AND hasabstract',
    ]);
    expect(Object.fromEntries(calls[0].searchParams)).toMatchObject({
      db: 'pubmed',
      retmode: 'json',
      retmax: '20',
      sort: 'relevance',
      tool: 'rxplus',
      email: 'me@example.com',
    });
    expect(result.reviews.slice(0, 3)).toEqual(['37417783', '41421750', '29971804']);
    expect(result.reviews).toHaveLength(20);
    expect(result.rcts[0]).toBe('10587334');
  });

  it('lists a paper found by both searches once, as a review', async () => {
    const { fetchFn } = stubFetch({
      rcts: JSON.stringify({ esearchresult: { count: '2', idlist: ['37417783', '1'] } }),
    });
    const { reviews, rcts } = await create(fetchFn).searchPapers('lisinopril');
    expect(reviews).toContain('37417783');
    expect(rcts).toEqual(['1']);
  });

  it('quotes multi-word ingredients and ignores unsafe characters', async () => {
    const { fetchFn, calls } = stubFetch();
    await create(fetchFn).searchPapers('insulin glargine" OR cancer[mh]');
    expect(calls[0].searchParams.get('term')).toMatch(/^"insulin glargine or cancer mh"\[tiab\]/);
    const empty = stubFetch();
    expect(await create(empty.fetchFn).searchPapers(' "[]" ')).toEqual({ reviews: [], rcts: [] });
    expect(empty.fetchFn).not.toHaveBeenCalled();
  });

  it('returns empty lists when nothing matches', async () => {
    const none = fixture('esearch-none.json');
    const { fetchFn } = stubFetch({ reviews: none, rcts: none });
    expect(await create(fetchFn).searchPapers('zzqxnotadrug')).toEqual({ reviews: [], rcts: [] });
  });

  it('maps summaries: journal, year, study type, DOI and PMC id, in the order asked', async () => {
    const { fetchFn, calls } = stubFetch();
    const papers = await create(fetchFn).paperDetails(['9269212', '37417783', '29971804']);
    expect(calls[0].searchParams.get('id')).toBe('9269212,37417783,29971804');
    expect(papers.map((p) => p.pmid)).toEqual(['9269212', '37417783', '29971804']);
    expect(papers[0]).toMatchObject({
      journal: 'Lancet',
      year: 1997,
      studyType: 'rct',
      doi: null,
      pmcid: null,
    });
    expect(papers[0].title).toMatch(/^Randomised placebo-controlled trial of lisinopril/);
    expect(papers[1]).toMatchObject({
      studyType: 'meta-analysis',
      year: 2023,
      doi: '10.1111/jch.14695',
      pmcid: 'PMC10423763',
    });
    expect(papers[1].pubTypes).toContain('Network Meta-Analysis');
    expect(papers[2].studyType).toBe('systematic-review');
    expect(await create(fetchFn).paperDetails([])).toEqual([]);
  });

  it('reads plain and structured abstracts, decoding entities and dropping markup', async () => {
    const { fetchFn, calls } = stubFetch();
    const abstracts = await create(fetchFn).abstracts(['37417783', '29971804']);
    expect(Object.fromEntries(calls[0].searchParams)).toMatchObject({
      db: 'pubmed',
      retmode: 'xml',
      id: '37417783,29971804',
    });
    expect(abstracts.get('37417783')).toMatch(/^Studies have shown that angiotensin converting/);
    const structured = abstracts.get('29971804')!;
    expect(structured).toMatch(
      /^AIMS: Lisinopril is an angiotensin[-‐]converting[-‐]enzyme inhibitor/,
    );
    expect(structured).toMatch(/\nMETHODS: /);
    expect(structured).toMatch(/\nCONCLUSIONS: /);
    expect(structured).not.toMatch(/<\/?[a-z]+>|&#x/);
  });

  it('spaces requests: 400 ms without a key, 110 ms with one (sent, never in errors)', async () => {
    let clock = 0;
    const waits: number[] = [];
    const run = async (apiKey?: string) => {
      waits.length = 0;
      const { fetchFn, calls } = stubFetch();
      const client = createPubMedClient({
        baseUrl: BASE,
        apiKey,
        fetch: fetchFn,
        now: () => clock,
        sleep: async (ms) => {
          waits.push(ms);
          clock += ms;
        },
      });
      await Promise.all([client.searchPapers('lisinopril'), client.paperDetails(['1'])]);
      return calls;
    };
    await run();
    expect(waits).toEqual([400, 400]);
    const calls = await run('secret-key');
    expect(waits).toEqual([110, 110]);
    expect(calls.every((u) => u.searchParams.get('api_key') === 'secret-key')).toBe(true);

    const failing = createPubMedClient({
      baseUrl: BASE,
      apiKey: 'secret-key',
      fetch: vi.fn(async () => new Response('down', { status: 503 })),
      sleep: async () => undefined,
    });
    const error = await failing.searchPapers('lisinopril').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(PubMedUnavailableError);
    expect((error as Error).message).not.toContain('secret-key');
  });

  it('backs off and retries after a 429, then gives up', async () => {
    const waits: number[] = [];
    let limited = 2;
    const fetchFn = vi.fn(async () =>
      limited-- > 0
        ? new Response('', { status: 429 })
        : new Response(fixture('esearch-none.json'), { status: 200 }),
    );
    const client = createPubMedClient({
      baseUrl: BASE,
      fetch: fetchFn,
      sleep: async (ms) => void waits.push(ms),
    });
    expect(await client.searchPapers('lisinopril')).toEqual({ reviews: [], rcts: [] });
    expect(waits.filter((ms) => ms >= 1000)).toEqual([1000, 2000]);

    const always = createPubMedClient({
      baseUrl: BASE,
      fetch: vi.fn(async () => new Response('', { status: 429 })),
      sleep: async () => undefined,
    });
    await expect(always.searchPapers('lisinopril')).rejects.toThrow('PubMed rate limited (429)');
  });

  it('reports errors and unexpected answers as unavailable', async () => {
    const errorBody = stubFetch({
      reviews: JSON.stringify({ esearchresult: { ERROR: 'Invalid query' } }),
    });
    await expect(create(errorBody.fetchFn).searchPapers('lisinopril')).rejects.toBeInstanceOf(
      PubMedUnavailableError,
    );
    const badStatus = vi.fn(async () => new Response('', { status: 400 }));
    await expect(create(badStatus).abstracts(['1'])).rejects.toBeInstanceOf(PubMedUnavailableError);
  });

  describe('recentPapers', () => {
    const recent = () => {
      const calls: URL[] = [];
      const fetchFn = vi.fn(async (input: string | URL | Request) => {
        calls.push(new URL(String(input)));
        return new Response(fixture('esearch-recent-atorvastatin.json'), { status: 200 });
      });
      return { fetchFn, calls };
    };

    it('searches title/abstract by entry date, most relevant first, up to the limit', async () => {
      const { fetchFn, calls } = recent();
      const result = await create(fetchFn).recentPapers('Atorvastatin', {
        from: '2026-09-20',
        to: '2026-09-27',
        limit: 5,
      });

      expect(Object.fromEntries(calls[0].searchParams)).toMatchObject({
        term: '"atorvastatin"[tiab] AND hasabstract',
        datetype: 'edat',
        mindate: '2026/09/20',
        maxdate: '2026/09/27',
        retmax: '5',
        sort: 'relevance',
      });
      expect(result.pmids).toEqual(['42779940', '42793522', '42769353', '42794645', '42764572']);
      expect(result.total).toBe(14);
    });

    it('links to the same search on the PubMed website', async () => {
      const { fetchFn } = recent();
      const { searchUrl } = await create(fetchFn).recentPapers('atorvastatin', {
        from: '2026-09-20',
        to: '2026-09-27',
        limit: 5,
      });
      const url = new URL(searchUrl);
      expect(url.origin).toBe('https://pubmed.ncbi.nlm.nih.gov');
      expect(url.searchParams.get('term')).toBe(
        '"atorvastatin"[tiab] AND hasabstract AND ("2026/09/20"[edat] : "2026/09/27"[edat])',
      );
    });

    it('asks nothing for a name without letters', async () => {
      const { fetchFn } = recent();
      const result = await create(fetchFn).recentPapers('()', {
        from: '2026-09-20',
        to: '2026-09-27',
        limit: 5,
      });
      expect(result).toMatchObject({ pmids: [], total: 0 });
      expect(fetchFn).not.toHaveBeenCalled();
    });
  });
});

describe('parseAbstracts', () => {
  it('skips articles without an abstract and ignores copyright notes', () => {
    const xml = `<PubmedArticleSet>
      <PubmedArticle><MedlineCitation><PMID Version="1">1</PMID>
        <Article><Abstract><AbstractText>A &amp; B &lt; C, 5&#xa0;mg, &#946;-blockers.</AbstractText>
        <CopyrightInformation>© Publisher</CopyrightInformation></Abstract></Article>
        <CommentsCorrectionsList><CommentsCorrections><PMID Version="1">99</PMID></CommentsCorrections></CommentsCorrectionsList>
      </MedlineCitation></PubmedArticle>
      <PubmedArticle><MedlineCitation><PMID Version="1">2</PMID><Article></Article></MedlineCitation></PubmedArticle>
    </PubmedArticleSet>`;
    const abstracts = parseAbstracts(xml);
    expect([...abstracts.keys()]).toEqual(['1']);
    // Non-breaking spaces become plain spaces, which quote matching relies on.
    expect(abstracts.get('1')).toBe('A & B < C, 5 mg, β-blockers.');
  });
});
