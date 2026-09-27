// @vitest-environment node
import type { BetaMessage } from '@anthropic-ai/sdk/resources/beta/messages/messages';

import type { SummaryLabel } from '../../openfda/client';
import { HEADINGS } from '../summary';
import { CLAUDE_MODEL, createClaudeProvider, type ClaudeClient } from './claude';
import { ProviderOutputError, ProviderUnavailableError } from './provider';

const label: SummaryLabel = {
  rxcui: '314076',
  setId: 'set',
  version: '2',
  manufacturer: null,
  effectiveDate: null,
  dailyMedUrl: 'https://dailymed.nlm.nih.gov/dailymed/lookup.cfm?setid=set',
  sections: [
    { name: 'indications_and_usage', text: 'Indicated for the treatment of hypertension.' },
    {
      name: 'adverse_reactions',
      text: 'The most common adverse reactions are headache and cough.',
    },
  ],
};

const cite = (documentIndex: number, citedText: string) => ({
  type: 'char_location' as const,
  cited_text: citedText,
  document_index: documentIndex,
  document_title: label.sections[documentIndex].name,
  start_char_index: 0,
  end_char_index: citedText.length,
  file_id: null,
});

interface Block {
  text: string;
  citations?: ReturnType<typeof cite>[];
}

const response = (blocks: Block[], stopReason = 'end_turn') =>
  ({
    id: 'msg_1',
    type: 'message',
    role: 'assistant',
    model: CLAUDE_MODEL,
    stop_reason: stopReason,
    content: [
      { type: 'thinking', thinking: '', signature: 'sig' },
      ...blocks.map((b) => ({ type: 'text', text: b.text, citations: b.citations ?? null })),
    ],
    usage: { input_tokens: 5000, output_tokens: 800 },
  }) as unknown as BetaMessage;

const fullReply: Block[] = [
  { text: "## What it's for\nIt treats " },
  {
    text: 'high blood pressure.',
    citations: [cite(0, 'Indicated for the treatment of hypertension.')],
  },
  { text: '\n\n## How it works\nThe label doesn’t say.\n\n## Common side effects\n' },
  {
    text: 'Headache and cough are common.',
    citations: [cite(1, 'The most common adverse reactions are headache and cough.')],
  },
  { text: ' It can also make you tired.\n\n## Serious warnings\n' },
  { text: '\n## How well it works\nThe label doesn’t say.' },
];

const clientReturning = (message: BetaMessage | Error) => {
  const create = vi.fn(async () => {
    if (message instanceof Error) throw message;
    return message;
  });
  return { client: { beta: { messages: { create } } } as unknown as ClaudeClient, create };
};

describe('Claude provider', () => {
  it('sends each label section as a cited plain-text document with fallbacks enabled', async () => {
    const { client, create } = clientReturning(response(fullReply));
    await createClaudeProvider({ apiKey: 'test', client }).generate(label);

    const params = create.mock.calls[0][0 as never] as Record<string, unknown>;
    expect(params).toMatchObject({
      model: 'claude-opus-5',
      max_tokens: 16000,
      thinking: { type: 'adaptive' },
      output_config: { effort: 'high' },
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
    });
    expect(params['system']).toContain("## What it's for");
    const content = (params['messages'] as { content: unknown[] }[])[0].content;
    expect(content[0]).toEqual({
      type: 'document',
      source: { type: 'text', media_type: 'text/plain', data: label.sections[0].text },
      title: 'indications_and_usage',
      citations: { enabled: true },
    });
    expect(content).toHaveLength(3);
  });

  it('turns cited text into sentence quotes under the fixed headings', async () => {
    const { client } = clientReturning(response(fullReply));
    const result = await createClaudeProvider({ apiKey: 'test', client }).generate(label);

    expect(result.raw.sections.map((s) => s.heading)).toEqual([...HEADINGS]);
    expect(result.raw.sections[0].sentences).toEqual([
      {
        text: 'It treats high blood pressure.',
        quotes: [
          {
            labelSection: 'indications_and_usage',
            text: 'Indicated for the treatment of hypertension.',
          },
        ],
      },
    ]);
    expect(result.raw.sections[2].sentences).toEqual([
      {
        text: 'Headache and cough are common.',
        quotes: [
          {
            labelSection: 'adverse_reactions',
            text: 'The most common adverse reactions are headache and cough.',
          },
        ],
      },
      { text: 'It can also make you tired.', quotes: [] },
    ]);
    // An empty section becomes an honest gap rather than failing the whole summary.
    expect(result.raw.sections[3].sentences).toEqual([
      { text: 'The label doesn’t say.', quotes: [] },
    ]);
    expect(result).toMatchObject({ inputTokens: 5000, outputTokens: 800 });
  });

  it('fails on a refusal or a cut-off answer', async () => {
    for (const stop of ['refusal', 'max_tokens']) {
      const { client } = clientReturning(response(fullReply, stop));
      await expect(
        createClaudeProvider({ apiKey: 'test', client }).generate(label),
      ).rejects.toBeInstanceOf(ProviderOutputError);
    }
  });

  it('fails when headings are missing', async () => {
    const { client } = clientReturning(response([{ text: 'Lisinopril treats blood pressure.' }]));
    await expect(
      createClaudeProvider({ apiKey: 'test', client }).generate(label),
    ).rejects.toBeInstanceOf(ProviderOutputError);
  });

  it('reports API errors as unavailable', async () => {
    const { client } = clientReturning(new Error('Connection error.'));
    await expect(
      createClaudeProvider({ apiKey: 'test', client }).generate(label),
    ).rejects.toBeInstanceOf(ProviderUnavailableError);
  });
});
