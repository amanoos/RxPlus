/** Label summaries from a local model via Ollama (see ai/ollama.ts). */
import { createOllamaJson, type OllamaOptions } from '../../ai/ollama';
import type { SummaryLabel } from '../../openfda/client';
import { buildLabelMessage, RawSummarySchema, SYSTEM_PROMPT } from '../summary';
import type { SummaryProvider } from './provider';

export type { OllamaOptions };

export function createOllamaProvider(options: OllamaOptions): SummaryProvider {
  const ollama = createOllamaJson(options);
  return {
    name: 'ollama',
    model: ollama.model,
    async generate(label: SummaryLabel) {
      const { data, inputTokens, outputTokens } = await ollama.generateJson({
        system: SYSTEM_PROMPT,
        user: buildLabelMessage(label),
        schema: RawSummarySchema,
        inputName: 'label',
      });
      return { raw: data, inputTokens, outputTokens };
    },
  };
}
