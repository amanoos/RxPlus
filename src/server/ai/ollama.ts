/**
 * Local model via Ollama's HTTP API (https://github.com/ollama/ollama/blob/main/docs/api.md).
 * Structured outputs: `format` takes the JSON schema the reply must follow.
 */
import { z } from 'zod';

import { InputTooLargeError, ProviderOutputError, ProviderUnavailableError } from './errors';

export interface OllamaOptions {
  baseUrl: string;
  model: string;
  /** Context window. Ollama's small default would silently cut the input off. */
  numCtx: number;
  timeoutMs: number;
  fetch?: typeof fetch;
}

export interface JsonRequest<T> {
  system: string;
  user: string;
  schema: z.ZodType<T>;
  /**
   * A stricter schema for generation only (e.g. digit patterns the grammar enforces),
   * while the answer is still parsed with the lenient `schema`. Defaults to `schema`.
   */
  format?: z.ZodType;
  /** What the input is, for the too-large message (e.g. "label"). */
  inputName: string;
}

export interface JsonResult<T> {
  data: T;
  inputTokens?: number;
  outputTokens?: number;
}

export interface OllamaJson {
  model: string;
  generateJson<T>(request: JsonRequest<T>): Promise<JsonResult<T>>;
}

/** Room left in the context window for the model's JSON answer. */
const OUTPUT_RESERVE_TOKENS = 4096;

/** Rough token estimate (≈3.5 characters per token for English medical text). */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 3.5);
}

export function createOllamaJson({
  baseUrl,
  model,
  numCtx,
  timeoutMs,
  fetch: fetchFn = fetch,
}: OllamaOptions): OllamaJson {
  return {
    model,
    async generateJson<T>({ system, user, schema, format, inputName }: JsonRequest<T>) {
      const promptTokens = estimateTokens(system + user);
      if (promptTokens + OUTPUT_RESERVE_TOKENS > numCtx) {
        throw new InputTooLargeError(
          `The ${inputName} (~${promptTokens} tokens) doesn't fit OLLAMA_NUM_CTX=${numCtx}.`,
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
              format: z.toJSONSchema(format ?? schema),
              // Answer only: thinking models (qwen3) otherwise reason first, slower and
              // no better for these short JSON answers. Other models ignore it.
              think: false,
              options: { num_ctx: numCtx, temperature: 0.2 },
              messages: [
                { role: 'system', content: system },
                { role: 'user', content: user },
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
      const parsed = schema.safeParse(json);
      if (!parsed.success) {
        throw new ProviderOutputError('Ollama returned JSON in the wrong shape.');
      }
      return {
        data: parsed.data,
        inputTokens: body?.prompt_eval_count,
        outputTokens: body?.eval_count,
      };
    },
  };
}
