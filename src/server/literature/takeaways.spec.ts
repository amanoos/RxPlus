// @vitest-environment node
import type { BetaMessage } from '@anthropic-ai/sdk/resources/beta/messages/messages';

import type { ClaudeClient } from '../ai/claude';
import { ProviderOutputError, ProviderUnavailableError } from '../ai/errors';
import type { PaperTakeaway } from '../db/schema';
import {
  buildAbstractsMessage,
  buildSupportMessage,
  createClaudeTakeawayProvider,
  createJevSubjectCheck,
  createJevSupportCheck,
  createOllamaTakeawayProvider,
  labelStudySubjects,
  parseCitedTakeaways,
  SUPPORT_SYSTEM_PROMPT,
  TAKEAWAY_SYSTEM_PROMPT,
  verifyTakeaways,
  type PaperInput,
  type TakeawayProvider,
} from './takeaways';

const papers: PaperInput[] = [
  {
    pmid: '111',
    abstract:
      'METHODS: 200 adults with hypertension received lisinopril or placebo.\nRESULTS: Lisinopril reduced systolic blood pressure by 12 mmHg compared with placebo.',
  },
  {
    pmid: '222',
    abstract:
      'RESULTS: Cough occurred in 11% of patients taking ACE inhibitors versus 3% on placebo.',
  },
];

describe('takeaway prompt', () => {
  it('sends only the abstracts, each headed by its PMID', () => {
    const message = buildAbstractsMessage(papers);
    expect(message).toBe(
      `### PMID 111\n${papers[0].abstract}\n\n### PMID 222\n${papers[1].abstract}`,
    );
    expect(TAKEAWAY_SYSTEM_PROMPT).toMatch(/only that paper's abstract/i);
    expect(TAKEAWAY_SYSTEM_PROMPT).toMatch(/do not advise starting, stopping/i);
  });

  it('asks Ollama for the takeaways schema with the abstracts as input', async () => {
    const fetchFn = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            message: { content: JSON.stringify({ takeaways: [] }) },
            prompt_eval_count: 900,
          }),
        ),
    );
    const provider = createOllamaTakeawayProvider({
      baseUrl: 'http://ollama.test',
      model: 'qwen2.5:7b',
      numCtx: 16384,
      timeoutMs: 1000,
      fetch: fetchFn,
    });
    expect(await provider.generate(papers)).toEqual({
      raw: { takeaways: [] },
      inputTokens: 900,
      outputTokens: undefined,
    });
    const body = JSON.parse(
      String((fetchFn.mock.calls[0] as unknown as [string, RequestInit])[1].body),
    );
    expect(body.messages).toEqual([
      { role: 'system', content: TAKEAWAY_SYSTEM_PROMPT },
      { role: 'user', content: buildAbstractsMessage(papers) },
    ]);
    expect(body.format).toHaveProperty('properties.takeaways');
    // The grammar only lets the model write digits for the PMID.
    expect(body.format.properties.takeaways.items.properties.pmid.pattern).toBe('^[0-9]{1,9}$');
  });
});

describe('verifyTakeaways', () => {
  it('cites a takeaway whose quote is in its own abstract and on topic', () => {
    const result = verifyTakeaways(
      {
        takeaways: [
          {
            pmid: '111',
            text: 'In a trial of 200 adults, it lowered systolic pressure by 12 mmHg.',
            quote: 'Lisinopril reduced systolic blood pressure by 12 mmHg compared with placebo.',
          },
        ],
      },
      papers,
      { ignoreWords: ['lisinopril'] },
    );
    expect(result.byPmid.get('111')).toEqual({
      text: 'In a trial of 200 adults, it lowered systolic pressure by 12 mmHg.',
      quote: 'Lisinopril reduced systolic blood pressure by 12 mmHg compared with placebo.',
      uncited: false,
    });
    expect(result).toMatchObject({ verifiedCount: 1, uncitedCount: 0 });
  });

  it("marks a quote from another paper's abstract, or an invented one, as uncited", () => {
    const result = verifyTakeaways(
      {
        takeaways: [
          {
            pmid: '111',
            text: 'Cough was more common with ACE inhibitors.',
            quote: 'Cough occurred in 11% of patients taking ACE inhibitors',
          },
          { pmid: '222', text: 'Cough was common.', quote: 'Cough was very common overall' },
        ],
      },
      papers,
    );
    expect(result.byPmid.get('111')).toMatchObject({ quote: null, uncited: true });
    expect(result.byPmid.get('222')).toMatchObject({ quote: null, uncited: true });
    expect(result.uncitedCount).toBe(2);
  });

  it('drops unknown PMIDs, duplicates and advice', () => {
    const result = verifyTakeaways(
      {
        takeaways: [
          { pmid: '999', text: 'Some other study.', quote: 'x' },
          {
            pmid: 'PMID 222',
            text: 'Cough affected 11% of patients.',
            quote: 'Cough occurred in 11% of patients',
          },
          { pmid: '222', text: 'A second takeaway.', quote: 'y' },
          { pmid: '111', text: 'You should stop taking it if you cough.', quote: 'z' },
        ],
      },
      papers,
    );
    expect([...result.byPmid.keys()]).toEqual(['222']);
    expect(result.byPmid.get('222')?.uncited).toBe(false);
    expect(result.removedAdvice).toBe(1);
  });

  it('recovers a takeaway with a wrong PMID, or with its fields shifted, by its quote', () => {
    const result = verifyTakeaways(
      {
        takeaways: [
          // Wrong PMID, right quote.
          {
            pmid: '999',
            quote: 'Lisinopril reduced systolic blood pressure by 12 mmHg compared with placebo.',
            text: 'In this trial, lisinopril lowered systolic blood pressure by 12 mmHg.',
          },
          // Shifted (qwen2.5:7b, live): the sentence where the PMID belongs.
          {
            pmid: 'Cough occurred in 11% of patients taking ACE inhibitors versus 3% on placebo.',
            quote: 'Cough was more common with ACE inhibitors than placebo.',
            text: 'In this study, cough affected 11% of patients on ACE inhibitors.',
          },
          // Neither matches any abstract: dropped.
          { pmid: 'a sentence', quote: 'not in any abstract here', text: 'Something.' },
        ],
      },
      papers,
    );
    expect([...result.byPmid.keys()]).toEqual(['111', '222']);
    expect(result.byPmid.get('111')).toMatchObject({ uncited: false });
    expect(result.byPmid.get('222')).toMatchObject({
      quote: 'Cough occurred in 11% of patients taking ACE inhibitors versus 3% on placebo.',
      uncited: false,
    });
  });

  it('keeps takeaways that speak to the reader or recommend, marked as such', () => {
    const quote = 'Cough occurred in 11% of patients';
    const marked = (text: string) => {
      const result = verifyTakeaways({ takeaways: [{ pmid: '222', text, quote }] }, papers);
      expect(result.removedAdvice).toBe(0);
      return result.byPmid.get('222')?.readerDirected ?? false;
    };
    expect(marked('Taking a higher dose right after surgery can help your heart.')).toBe(true);
    expect(marked('If you take it, cough is common.')).toBe(true);
    expect(marked('Doctors should consider combining these medicines.')).toBe(true);
    expect(marked('In this study, cough affected 11% of patients.')).toBe(false);
    expect(marked('Youth athletes in this study coughed more.')).toBe(false);
  });
});

describe('Claude takeaways', () => {
  const cite = (documentIndex: number, citedText: string) => ({ documentIndex, citedText });

  it('splits the reply at the PMID headings and takes the first citation as the quote', () => {
    const raw = parseCitedTakeaways(
      [
        { text: '## PMID 111\nIn a trial of 200 adults, ', citations: [] },
        {
          text: 'it lowered systolic pressure by 12 mmHg.',
          citations: [cite(0, 'Lisinopril reduced systolic blood pressure by 12 mmHg')],
        },
        { text: '\n\n## PMID 222\n', citations: [] },
        { text: 'Cough affected 11% of patients.', citations: [cite(1, 'Cough occurred in 11%')] },
      ],
      papers,
    );
    expect(raw.takeaways).toEqual([
      {
        pmid: '111',
        text: 'In a trial of 200 adults, it lowered systolic pressure by 12 mmHg.',
        quote: 'Lisinopril reduced systolic blood pressure by 12 mmHg',
      },
      { pmid: '222', text: 'Cough affected 11% of patients.', quote: 'Cough occurred in 11%' },
    ]);
  });

  it('sends each abstract as a cited document and fails without PMID headings', async () => {
    const message = (text: string) =>
      ({
        stop_reason: 'end_turn',
        usage: { input_tokens: 1, output_tokens: 1 },
        content: [{ type: 'text', text, citations: null }],
      }) as unknown as BetaMessage;
    const create = vi.fn(async () => message('## PMID 111\nA finding.'));
    const provider = createClaudeTakeawayProvider({
      apiKey: 'test',
      client: { beta: { messages: { create } } } as unknown as ClaudeClient,
    });
    await provider.generate(papers);
    const params = create.mock.calls[0][0 as never] as { messages: { content: unknown[] }[] };
    expect(params.messages[0].content[0]).toMatchObject({
      type: 'document',
      title: 'PMID 111',
      source: { data: papers[0].abstract },
      citations: { enabled: true },
    });

    create.mockResolvedValue(message('Here are some thoughts.'));
    await expect(provider.generate(papers)).rejects.toBeInstanceOf(ProviderOutputError);
  });
});

describe('support check', () => {
  const items = [
    {
      pmid: '222',
      takeaway: 'Lisinopril caused more cough than other ACE inhibitors.',
      quote: 'Moexipril ranked as number one for inducing cough',
    },
  ];

  it('sends each takeaway with its quote and keeps answers for asked PMIDs only', async () => {
    const fetchFn = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            message: {
              content: JSON.stringify({
                checks: [
                  { pmid: 'PMID 222', supported: false },
                  { pmid: '999', supported: true },
                ],
              }),
            },
          }),
        ),
    );
    const provider = createOllamaTakeawayProvider(
      {
        baseUrl: 'http://ollama.test',
        model: 'qwen2.5:7b',
        numCtx: 16384,
        timeoutMs: 1000,
        fetch: fetchFn,
      },
      { checkModel: 'qwen2.5:14b' },
    );
    const answers = await provider.checkSupport!(items);
    expect([...answers]).toEqual([['222', false]]);

    const body = JSON.parse(
      String((fetchFn.mock.calls[0] as unknown as [string, RequestInit])[1].body),
    );
    expect(body.model).toBe('qwen2.5:14b');
    expect(body.messages).toEqual([
      { role: 'system', content: SUPPORT_SYSTEM_PROMPT },
      { role: 'user', content: buildSupportMessage(items) },
    ]);
    expect(buildSupportMessage(items)).toBe(
      '### PMID 222\nTAKEAWAY: Lisinopril caused more cough than other ACE inhibitors.\nQUOTE: Moexipril ranked as number one for inducing cough',
    );
    expect(SUPPORT_SYSTEM_PROMPT).toMatch(/every number and the direction/i);
  });

  it('is off unless a check model is set, and never offered for Claude', () => {
    const plain = createOllamaTakeawayProvider({
      baseUrl: 'http://ollama.test',
      model: 'qwen2.5:7b',
      numCtx: 16384,
      timeoutMs: 1000,
    });
    expect(plain.checkSupport).toBeUndefined();
    const provider = createClaudeTakeawayProvider({ apiKey: 'test', client: {} as ClaudeClient });
    expect(provider.checkSupport).toBeUndefined();
  });
});

describe('Jev support check', () => {
  const items = [
    {
      pmid: '111',
      takeaway: 'Lisinopril lowered blood pressure.',
      quote: 'Lisinopril reduced systolic blood pressure by 12 mmHg.',
    },
    {
      pmid: '222',
      takeaway: 'Lisinopril caused more cough than other ACE inhibitors.',
      quote: 'Moexipril ranked as number one for inducing cough',
    },
  ];
  const reply = (answers: unknown, status = 200) =>
    vi.fn(async () => new Response(JSON.stringify({ answers }), { status }));
  const callOf = (fetchFn: ReturnType<typeof vi.fn>) =>
    fetchFn.mock.calls[0] as unknown as [string, RequestInit];

  it('asks one yes/no per takeaway on TypeSafe and keeps answers for asked PMIDs only', async () => {
    const fetchFn = reply({
      'supported::111': { noul: 0.95, confidence: 0.9 },
      'supported::222': { noul: 0.05, confidence: 0.9 },
      'supported::999': { noul: 0.99 },
    });
    const check = createJevSupportCheck({
      provider: 'typesafe',
      apiKey: 'k',
      timeoutMs: 1000,
      fetch: fetchFn,
    });
    expect([...(await check(items))]).toEqual([
      ['111', true],
      ['222', false],
    ]);

    const [url, init] = callOf(fetchFn);
    expect(url).toBe('https://api.typesafe.ai/v1/systemone');
    expect(init.headers).toMatchObject({ authorization: 'Bearer k' });
    const body = JSON.parse(String(init.body));
    expect(body.model).toBe('jev-latest');
    expect(Object.keys(body.questions)).toEqual(['supported::111', 'supported::222']);
    expect(body.questions['supported::222'].instructions).toContain('QUOTE: Moexipril ranked');
  });

  it('speaks the Gateway shape, at a custom address', async () => {
    const fetchFn = reply({ 'supported::111': { probability: 0.9 } });
    const check = createJevSupportCheck({
      provider: 'gateway',
      apiKey: 'k',
      baseUrl: 'http://gateway.test/v4/ai/',
      timeoutMs: 1000,
      fetch: fetchFn,
    });
    expect([...(await check(items))]).toEqual([['111', true]]);
    const [url, init] = callOf(fetchFn);
    expect(url).toBe('http://gateway.test/v4/ai/evaluation-model');
    expect(init.headers).toMatchObject({ 'ai-model-id': 'typesafe-ai/jev' });
    expect(JSON.parse(String(init.body)).model).toBeUndefined();
  });

  it('throws on an error status, a body with no answers, or a timeout', async () => {
    const options = { provider: 'typesafe' as const, apiKey: 'k', timeoutMs: 1000 };
    await expect(
      createJevSupportCheck({ ...options, fetch: reply({}, 401) })(items),
    ).rejects.toThrow(ProviderUnavailableError);
    const garbled = vi.fn(async () => new Response('<html>'));
    await expect(createJevSupportCheck({ ...options, fetch: garbled })(items)).rejects.toThrow(
      ProviderOutputError,
    );
    const hung = vi.fn(() => new Promise<Response>(() => undefined));
    await expect(
      createJevSupportCheck({ ...options, timeoutMs: 20, fetch: hung })(items),
    ).rejects.toThrow(/timed out/);
  });

  it('takes the place of the local check model', async () => {
    const fetchFn = reply({ 'supported::111': { noul: 0.9 } });
    const provider = createOllamaTakeawayProvider(
      { baseUrl: 'http://ollama.test', model: 'qwen2.5:7b', numCtx: 16384, timeoutMs: 1000 },
      {
        checkModel: 'qwen2.5:14b',
        jev: { provider: 'typesafe', apiKey: 'k', timeoutMs: 1000, fetch: fetchFn },
      },
    );
    await provider.checkSupport!(items);
    expect(callOf(fetchFn)[0]).toBe('https://api.typesafe.ai/v1/systemone');
  });
});

describe('Jev study subject', () => {
  const papers = [
    { pmid: '1', title: 'Drug X in mice', abstract: 'Mice were given drug X.' },
    { pmid: '2', title: 'Drug X exposure', abstract: 'Exposure was measured over time.' },
    { pmid: '3', title: 'Drug X outcomes', abstract: 'Outcomes were compared.' },
  ];
  const takeaway = (): PaperTakeaway => ({ text: 't', quote: null, uncited: true });

  it('asks one choice per paper and keeps answers for asked PMIDs only', async () => {
    const fetchFn = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            answers: {
              'subject::2': { choice: 'human', confidence: 0.8 },
              'subject::3': { choice: 'unclear' },
              'subject::9': { choice: 'lab' },
            },
          }),
        ),
    );
    const check = createJevSubjectCheck({
      provider: 'typesafe',
      apiKey: 'k',
      timeoutMs: 1000,
      fetch: fetchFn,
    });
    expect([...(await check(papers.slice(1)))]).toEqual([
      ['2', 'human'],
      ['3', null],
    ]);
    const body = JSON.parse(
      String((fetchFn.mock.calls[0] as unknown as [string, RequestInit])[1].body),
    );
    expect(body.questions['subject::2']).toMatchObject({ type: 'choice' });
    expect(body.questions['subject::2'].instructions).toContain('TITLE: Drug X exposure');
  });

  it('labels only takeaways whose paper the regex leaves unlabeled', async () => {
    const classifySubjects = vi.fn(async () => new Map([['2', 'human' as const]]));
    const provider = { classifySubjects } as unknown as TakeawayProvider;
    const byPmid = new Map([
      ['1', takeaway()],
      ['2', takeaway()],
    ]);
    await labelStudySubjects(byPmid, papers, provider);
    // Paper 1 says "mice"; paper 3 has no takeaway entry.
    expect(classifySubjects).toHaveBeenCalledWith([papers[1]]);
    expect(byPmid.get('2')?.studySubject).toBe('human');
    expect(byPmid.get('1')).not.toHaveProperty('studySubject');
  });

  it('leaves takeaways unlabeled when the check fails or is not configured', async () => {
    const byPmid = new Map([['2', takeaway()]]);
    const failing = {
      classifySubjects: vi.fn(async () => {
        throw new Error('Jev responded 500.');
      }),
    } as unknown as TakeawayProvider;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await labelStudySubjects(byPmid, papers, failing);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('study subject check failed'));
    warn.mockRestore();
    await labelStudySubjects(byPmid, papers, {} as TakeawayProvider);
    expect(byPmid.get('2')).not.toHaveProperty('studySubject');
  });
});
