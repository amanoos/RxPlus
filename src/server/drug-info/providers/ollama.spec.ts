// @vitest-environment node
import type { SummaryLabel } from '../../openfda/client';
import { HEADINGS, SYSTEM_PROMPT } from '../summary';
import { createOllamaProvider } from './ollama';
import { LabelTooLargeError, ProviderOutputError, ProviderUnavailableError } from './provider';

const label: SummaryLabel = {
  rxcui: '314076',
  setId: 'set',
  version: '2',
  manufacturer: null,
  effectiveDate: null,
  dailyMedUrl: 'https://dailymed.nlm.nih.gov/dailymed/lookup.cfm?setid=set',
  sections: [
    { name: 'indications_and_usage', text: 'indicated for the treatment of hypertension' },
  ],
};

const validSummary = {
  sections: HEADINGS.map((heading) => ({
    heading,
    sentences: [{ text: 'The label doesn’t say.', quotes: [] }],
  })),
};

const reply = (content: unknown, status = 200) =>
  new Response(
    JSON.stringify(
      status === 200
        ? {
            message: { role: 'assistant', content: JSON.stringify(content) },
            prompt_eval_count: 900,
            eval_count: 300,
          }
        : content,
    ),
    { status },
  );

describe('Ollama provider', () => {
  const create = (fetchFn: typeof fetch, overrides = {}) =>
    createOllamaProvider({
      baseUrl: 'http://ollama.test:11434',
      model: 'qwen2.5:7b',
      numCtx: 16384,
      timeoutMs: 1000,
      fetch: fetchFn,
      ...overrides,
    });

  it('sends a structured-output chat request with an explicit context window', async () => {
    const fetchFn = vi.fn(async () => reply(validSummary));
    const result = await create(fetchFn).generate(label);

    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://ollama.test:11434/api/chat');
    const body = JSON.parse(String(init.body));
    expect(body).toMatchObject({
      model: 'qwen2.5:7b',
      stream: false,
      options: { num_ctx: 16384, temperature: 0.2 },
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: expect.stringContaining('### indications_and_usage') },
      ],
    });
    expect(body.format).toHaveProperty('properties.sections');
    expect(result).toMatchObject({ raw: validSummary, inputTokens: 900, outputTokens: 300 });
  });

  it('refuses a label that would not fit the context window', async () => {
    const fetchFn = vi.fn();
    const huge = {
      ...label,
      sections: [{ name: 'clinical_studies' as const, text: 'x'.repeat(60_000) }],
    };
    await expect(create(fetchFn).generate(huge)).rejects.toBeInstanceOf(LabelTooLargeError);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('explains a missing model', async () => {
    const fetchFn = vi.fn(async () =>
      reply({ error: 'model "qwen2.5:7b" not found, try pulling it first' }, 404),
    );
    const error = await create(fetchFn)
      .generate(label)
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ProviderUnavailableError);
    expect((error as Error).message).toContain('ollama pull qwen2.5:7b');
  });

  it('reports an unreachable server and a timeout as unavailable', async () => {
    const down = vi.fn(async () => {
      throw new TypeError('fetch failed');
    });
    await expect(create(down).generate(label)).rejects.toBeInstanceOf(ProviderUnavailableError);

    vi.useFakeTimers();
    try {
      const hang = vi.fn(() => new Promise<Response>(() => undefined));
      const result = create(hang).generate(label);
      const assertion = expect(result).rejects.toThrow(/timed out/);
      await vi.advanceTimersByTimeAsync(1000);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });

  it('rejects output that is not valid summary JSON', async () => {
    const notJson = vi.fn(
      async () =>
        new Response(JSON.stringify({ message: { content: 'Sure! Here is a summary…' } })),
    );
    await expect(create(notJson).generate(label)).rejects.toBeInstanceOf(ProviderOutputError);
    const wrongShape = vi.fn(async () => reply({ sections: [] }));
    await expect(create(wrongShape).generate(label)).rejects.toBeInstanceOf(ProviderOutputError);
  });
});
