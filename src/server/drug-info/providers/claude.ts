/**
 * Claude via the Messages API with citations: each label section is a plain-text
 * document, and the cited text becomes the sentence quotes. Citations can't be
 * combined with JSON output, so the headings are fixed by the prompt and parsed here.
 */
import Anthropic from '@anthropic-ai/sdk';
import type {
  BetaMessage,
  MessageCreateParamsNonStreaming,
} from '@anthropic-ai/sdk/resources/beta/messages/messages';

import type { SummaryLabel } from '../../openfda/client';
import { HEADINGS, RawSummarySchema, SYSTEM_PROMPT, type RawSummary } from '../summary';
import { ProviderOutputError, ProviderUnavailableError, type SummaryProvider } from './provider';

export const CLAUDE_MODEL = 'claude-opus-5';
const MAX_TOKENS = 16_000;

/** The part of the SDK client the provider uses (mocked in tests). */
export interface ClaudeClient {
  beta: { messages: { create(params: MessageCreateParamsNonStreaming): Promise<BetaMessage> } };
}

const CLAUDE_FORMAT = `Format:
- Start each section with a Markdown heading line, exactly: ${HEADINGS.map((h) => `"## ${h}"`).join(', ')}.
- Under each heading, write short sentences, one per line. Cite the label for every sentence.`;

const NO_SUPPORT_SENTENCE = 'The label doesn’t say.';

export function createClaudeProvider({
  apiKey,
  client = new Anthropic({ apiKey, timeout: 5 * 60_000, maxRetries: 2 }),
}: {
  apiKey: string;
  client?: ClaudeClient;
}): SummaryProvider {
  return {
    name: 'claude',
    model: CLAUDE_MODEL,
    async generate(label: SummaryLabel) {
      let message: BetaMessage;
      try {
        message = await client.beta.messages.create({
          model: CLAUDE_MODEL,
          max_tokens: MAX_TOKENS,
          thinking: { type: 'adaptive' },
          output_config: { effort: 'high' },
          betas: ['server-side-fallback-2026-07-01'],
          fallbacks: 'default',
          system: `${SYSTEM_PROMPT}\n\n${CLAUDE_FORMAT}`,
          messages: [
            {
              role: 'user',
              content: [
                ...label.sections.map((section) => ({
                  type: 'document' as const,
                  source: {
                    type: 'text' as const,
                    media_type: 'text/plain' as const,
                    data: section.text,
                  },
                  title: section.name,
                  citations: { enabled: true },
                })),
                { type: 'text', text: 'Summarize this FDA drug label.' },
              ],
            },
          ],
        });
      } catch (error) {
        // SDK errors carry the status and message, never the API key.
        const status =
          error instanceof Anthropic.APIError ? ` (${error.status ?? 'no response'})` : '';
        throw new ProviderUnavailableError(
          `Claude request failed${status}: ${(error as Error).message}`,
        );
      }

      if (message.stop_reason === 'refusal') {
        throw new ProviderOutputError('Claude declined to summarize this label.');
      }
      if (message.stop_reason === 'max_tokens') {
        throw new ProviderOutputError('Claude’s summary was cut off (max_tokens).');
      }

      const parsed = RawSummarySchema.safeParse(parseCitedText(message, label));
      if (!parsed.success) {
        throw new ProviderOutputError('Claude’s summary did not follow the section headings.');
      }
      return {
        raw: parsed.data,
        inputTokens: message.usage.input_tokens,
        outputTokens: message.usage.output_tokens,
      };
    },
  };
}

type Quote = RawSummary['sections'][number]['sentences'][number]['quotes'][number];

const HEADING_LINE = /^#{1,3}\s*(.+?)\s*$/;
const plain = (s: string) => s.toLowerCase().replace(/[‘’]/g, "'").trim();

/**
 * Rebuilds the five sections from the response's text blocks. A cited block's
 * quotes attach to every sentence it contributes text to.
 */
export function parseCitedText(message: BetaMessage, label: SummaryLabel): RawSummary {
  const sections = new Map<string, RawSummary['sections'][number]['sentences']>();
  let current: RawSummary['sections'][number]['sentences'] | undefined;
  let sentence: { text: string; quotes: Quote[] } | undefined;

  const finish = () => {
    const text = sentence?.text
      .replace(/\s+/g, ' ')
      .replace(/^[-*•]\s*/, '')
      .trim();
    if (current && sentence && text) current.push({ text, quotes: dedupe(sentence.quotes) });
    sentence = undefined;
  };

  for (const block of message.content) {
    if (block.type !== 'text') continue;
    const quotes: Quote[] = (block.citations ?? []).flatMap((c) => {
      const section = c.type === 'char_location' ? label.sections[c.document_index] : undefined;
      return section ? [{ labelSection: section.name, text: c.cited_text }] : [];
    });

    // Split into lines, then sentences; a heading line opens a new section.
    const lines = block.text.split('\n');
    lines.forEach((line, i) => {
      const heading = HEADING_LINE.exec(line.trim());
      const known = heading && HEADINGS.find((h) => plain(h) === plain(heading[1]));
      if (known) {
        finish();
        current = [];
        sections.set(known, current);
      } else {
        for (const part of line.split(/(?<=[.!?])\s+/)) {
          if (!part.trim()) continue;
          sentence ??= { text: '', quotes: [] };
          sentence.text += part;
          sentence.quotes.push(...quotes);
          if (/[.!?]\s*$/.test(part)) finish();
          else sentence.text += ' ';
        }
      }
      if (i < lines.length - 1) finish(); // a line break ends a sentence
    });
  }
  finish();

  return {
    sections: HEADINGS.flatMap((heading) => {
      const sentences = sections.get(heading);
      if (!sentences) return [];
      return [
        {
          heading,
          sentences: sentences.length ? sentences : [{ text: NO_SUPPORT_SENTENCE, quotes: [] }],
        },
      ];
    }),
  };
}

function dedupe(quotes: Quote[]): Quote[] {
  const seen = new Set<string>();
  return quotes.filter((q) => {
    const key = `${q.labelSection}|${q.text}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
