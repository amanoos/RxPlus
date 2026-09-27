/**
 * Claude via the Messages API with citations: each source is a plain-text
 * document, and the reply comes back as text blocks citing those documents.
 * (Citations can't be combined with JSON output, so callers parse the text.)
 */
import Anthropic from '@anthropic-ai/sdk';
import type {
  BetaMessage,
  MessageCreateParamsNonStreaming,
} from '@anthropic-ai/sdk/resources/beta/messages/messages';

import { ProviderOutputError, ProviderUnavailableError } from './errors';

export const CLAUDE_MODEL = 'claude-opus-5';
const MAX_TOKENS = 16_000;

/** The part of the SDK client used here (mocked in tests). */
export interface ClaudeClient {
  beta: { messages: { create(params: MessageCreateParamsNonStreaming): Promise<BetaMessage> } };
}

export interface CitedBlock {
  text: string;
  citations: { documentIndex: number; citedText: string }[];
}

export interface CitedRequest {
  system: string;
  documents: { title: string; text: string }[];
  instruction: string;
  /** For messages: "Claude declined to <task>.", e.g. "summarize this label". */
  task: string;
  /** For messages: "Claude ran out of room writing the <output>", e.g. "summary". */
  output: string;
}

export interface CitedResult {
  blocks: CitedBlock[];
  inputTokens: number;
  outputTokens: number;
}

export interface ClaudeCited {
  model: string;
  generateCited(request: CitedRequest): Promise<CitedResult>;
}

export function createClaudeCited({
  apiKey,
  client = new Anthropic({ apiKey, timeout: 5 * 60_000, maxRetries: 2 }),
}: {
  apiKey: string;
  client?: ClaudeClient;
}): ClaudeCited {
  return {
    model: CLAUDE_MODEL,
    async generateCited({ system, documents, instruction, task, output }) {
      let message: BetaMessage;
      try {
        message = await client.beta.messages.create({
          model: CLAUDE_MODEL,
          max_tokens: MAX_TOKENS,
          thinking: { type: 'adaptive' },
          output_config: { effort: 'high' },
          betas: ['server-side-fallback-2026-07-01'],
          fallbacks: 'default',
          system,
          messages: [
            {
              role: 'user',
              content: [
                ...documents.map((doc) => ({
                  type: 'document' as const,
                  source: {
                    type: 'text' as const,
                    media_type: 'text/plain' as const,
                    data: doc.text,
                  },
                  title: doc.title,
                  citations: { enabled: true },
                })),
                { type: 'text', text: instruction },
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
        throw new ProviderOutputError(`Claude declined to ${task}.`);
      }
      if (message.stop_reason === 'max_tokens') {
        throw new ProviderOutputError(`Claude ran out of room writing the ${output} (max_tokens).`);
      }

      const blocks = message.content.flatMap((block): CitedBlock[] =>
        block.type === 'text'
          ? [
              {
                text: block.text,
                citations: (block.citations ?? []).flatMap((c) =>
                  c.type === 'char_location'
                    ? [{ documentIndex: c.document_index, citedText: c.cited_text }]
                    : [],
                ),
              },
            ]
          : [],
      );
      return {
        blocks,
        inputTokens: message.usage.input_tokens,
        outputTokens: message.usage.output_tokens,
      };
    },
  };
}
