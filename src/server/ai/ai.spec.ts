// @vitest-environment node
import type { BetaMessage } from '@anthropic-ai/sdk/resources/beta/messages/messages';
import { z } from 'zod';

import { createClaudeCited, type ClaudeClient } from './claude';
import { InputTooLargeError, ProviderOutputError } from './errors';
import { createOllamaJson } from './ollama';
import { ignoreSet, isAdvice, isRelevant, normalizeText } from './verify';

describe('verify helpers', () => {
  it('normalizes case, quote marks, dashes, spaces and edge punctuation', () => {
    expect(normalizeText('  “Blood‐pressure”  fell,  ')).toBe('blood-pressure" fell');
  });

  it('spots advice to start, stop or change a medication', () => {
    expect(isAdvice('Stop taking it if your face swells.')).toBe(true);
    expect(isAdvice('You should not take it while pregnant.')).toBe(true);
    expect(isAdvice('In the trial, people took it for 12 weeks.')).toBe(false);
  });

  it('judges relevance by shared stems and synonyms, ignoring the drug name', () => {
    const ignore = ignoreSet(['Lisinopril', 'hydrochlorothiazide 12.5 MG']);
    expect(isRelevant('It lowered blood pressure.', 'reduced systolic BP by 8 mmHg', ignore)).toBe(
      true,
    );
    expect(isRelevant('Lisinopril caused a cough.', 'lisinopril 10 mg daily', ignore)).toBe(false);
  });
});

describe('Ollama JSON generation', () => {
  const schema = z.object({ answer: z.string() });
  const reply = (content: unknown) =>
    new Response(JSON.stringify({ message: { content: JSON.stringify(content) }, eval_count: 7 }));

  it('sends the schema as the format and validates the answer against it', async () => {
    const fetchFn = vi.fn(async () => reply({ answer: 'yes' }));
    const ollama = createOllamaJson({
      baseUrl: 'http://ollama.test/',
      model: 'm',
      numCtx: 8192,
      timeoutMs: 1000,
      fetch: fetchFn,
    });
    const result = await ollama.generateJson({
      system: 'S',
      user: 'U',
      schema,
      inputName: 'abstracts',
    });
    expect(result).toEqual({ data: { answer: 'yes' }, inputTokens: undefined, outputTokens: 7 });
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://ollama.test/api/chat');
    expect(JSON.parse(String(init.body)).format).toHaveProperty('properties.answer');

    const wrong = createOllamaJson({
      baseUrl: 'http://ollama.test',
      model: 'm',
      numCtx: 8192,
      timeoutMs: 1000,
      fetch: vi.fn(async () => reply({ other: 1 })),
    });
    await expect(
      wrong.generateJson({ system: 'S', user: 'U', schema, inputName: 'abstracts' }),
    ).rejects.toBeInstanceOf(ProviderOutputError);
  });

  it('names the input in the too-large error', async () => {
    const ollama = createOllamaJson({
      baseUrl: 'http://ollama.test',
      model: 'm',
      numCtx: 4096,
      timeoutMs: 1000,
      fetch: vi.fn(),
    });
    const error = await ollama
      .generateJson({ system: '', user: 'x'.repeat(4000), schema, inputName: 'abstracts' })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(InputTooLargeError);
    expect((error as Error).message).toMatch(/^The abstracts \(~\d+ tokens\) doesn't fit/);
  });
});

describe('Claude cited generation', () => {
  const message = (stopReason: string) =>
    ({
      stop_reason: stopReason,
      usage: { input_tokens: 10, output_tokens: 4 },
      content: [
        { type: 'thinking', thinking: '', signature: 's' },
        {
          type: 'text',
          text: 'Found it.',
          citations: [
            {
              type: 'char_location',
              document_index: 1,
              cited_text: 'quote',
              document_title: 'b',
              start_char_index: 0,
              end_char_index: 5,
              file_id: null,
            },
            { type: 'web_search_result_location', cited_text: 'ignored' },
          ],
        },
        { type: 'text', text: ' More.', citations: null },
      ],
    }) as unknown as BetaMessage;

  const request = {
    system: 'S',
    documents: [
      { title: 'a', text: 'A' },
      { title: 'b', text: 'B' },
    ],
    instruction: 'Do it.',
    task: 'summarize these abstracts',
    output: 'takeaways',
  };

  it('returns text blocks with document citations', async () => {
    const create = vi.fn(async () => message('end_turn'));
    const claude = createClaudeCited({
      apiKey: 'test',
      client: { beta: { messages: { create } } } as unknown as ClaudeClient,
    });
    expect(await claude.generateCited(request)).toEqual({
      blocks: [
        { text: 'Found it.', citations: [{ documentIndex: 1, citedText: 'quote' }] },
        { text: ' More.', citations: [] },
      ],
      inputTokens: 10,
      outputTokens: 4,
    });
  });

  it('names the task and output in refusal and cut-off errors', async () => {
    for (const [stop, text] of [
      ['refusal', 'Claude declined to summarize these abstracts.'],
      ['max_tokens', 'Claude ran out of room writing the takeaways (max_tokens).'],
    ]) {
      const claude = createClaudeCited({
        apiKey: 'test',
        client: {
          beta: { messages: { create: async () => message(stop) } },
        } as unknown as ClaudeClient,
      });
      await expect(claude.generateCited(request)).rejects.toThrow(text);
    }
  });
});
