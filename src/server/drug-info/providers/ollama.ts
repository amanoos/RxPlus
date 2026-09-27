/**
 * Local model via Ollama's HTTP API (https://github.com/ollama/ollama/blob/main/docs/api.md).
 * Structured outputs: `format` takes the JSON schema the reply must follow.
 */
import type { SummaryLabel } from '../../openfda/client';
import {
  buildLabelMessage,
  estimateTokens,
  RawSummarySchema,
  rawSummaryJsonSchema,
  SYSTEM_PROMPT,
} from '../summary';
import {
  LabelTooLargeError,
  ProviderOutputError,
  ProviderUnavailableError,
  type SummaryProvider,
} from './provider';

export interface OllamaOptions {
  baseUrl: string;
  model: string;
  /** Context window. Ollama's small default would silently cut the label off. */
  numCtx: number;
  timeoutMs: number;
  fetch?: typeof fetch;
}

/** Room left in the context window for the model's JSON answer. */
const OUTPUT_RESERVE_TOKENS = 4096;

export function createOllamaProvider({
  baseUrl,
  model,
  numCtx,
  timeoutMs,
  fetch: fetchFn = fetch,
}: OllamaOptions): SummaryProvider {
  return {
    name: 'ollama',
    model,
    async generate(label: SummaryLabel) {
      const userMessage = buildLabelMessage(label);
      const promptTokens = estimateTokens(SYSTEM_PROMPT + userMessage);
      if (promptTokens + OUTPUT_RESERVE_TOKENS > numCtx) {
        throw new LabelTooLargeError(
          `The label (~${promptTokens} tokens) doesn't fit OLLAMA_NUM_CTX=${numCtx}.`,
        );
      }

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      let response: Response;
      // Race the abort too, so the timeout holds even if a fetch ignores the signal.
      const aborted = new Promise<never>((_, reject) =>
        controller.signal.addEventListener('abort', () => reject(new Error('aborted'))),
      );
      try {
        response = await Promise.race([
          aborted,
          fetchFn(`${baseUrl.replace(/\/$/, '')}/api/chat`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            signal: controller.signal,
            body: JSON.stringify({
              model,
              stream: false,
              format: rawSummaryJsonSchema(),
              options: { num_ctx: numCtx, temperature: 0.2 },
              messages: [
                { role: 'system', content: SYSTEM_PROMPT },
                { role: 'user', content: userMessage },
              ],
            }),
          }),
        ]);
      } catch (error) {
        if (controller.signal.aborted) {
          throw new ProviderUnavailableError(`Ollama timed out after ${timeoutMs / 1000}s.`);
        }
        throw new ProviderUnavailableError(
          `Ollama is unreachable at ${baseUrl} (${(error as Error).message}).`,
        );
      } finally {
        clearTimeout(timer);
      }

      const body = (await response.json().catch(() => null)) as {
        error?: string;
        message?: { content?: string };
        prompt_eval_count?: number;
        eval_count?: number;
      } | null;
      if (response.status === 404) {
        throw new ProviderUnavailableError(
          `Ollama model "${model}" not found. Run: ollama pull ${model}`,
        );
      }
      if (!response.ok) {
        throw new ProviderUnavailableError(
          `Ollama responded ${response.status}${body?.error ? `: ${body.error}` : ''}.`,
        );
      }

      let json: unknown;
      try {
        json = JSON.parse(body?.message?.content ?? '');
      } catch {
        throw new ProviderOutputError('Ollama did not return JSON.');
      }
      const parsed = RawSummarySchema.safeParse(json);
      if (!parsed.success) {
        throw new ProviderOutputError('Ollama returned JSON in the wrong shape.');
      }
      return {
        raw: parsed.data,
        inputTokens: body?.prompt_eval_count,
        outputTokens: body?.eval_count,
      };
    },
  };
}
