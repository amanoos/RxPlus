// @vitest-environment node
import type { BetaMessage } from '@anthropic-ai/sdk/resources/beta/messages/messages';

import type { ClaudeClient } from '../ai/claude';
import { ProviderOutputError } from '../ai/errors';
import {
  buildAbstractsMessage,
  buildSupportMessage,
  createClaudeTakeawayProvider,
  createOllamaTakeawayProvider,
  parseCitedTakeaways,
  SUPPORT_SYSTEM_PROMPT,
  TAKEAWAY_SYSTEM_PROMPT,
  verifyTakeaways,
  type PaperInput,
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
