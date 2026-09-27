import { env } from '../../utils/env';
import { createOllamaProvider } from './ollama';
import type { SummaryProvider } from './provider';

export * from './provider';

export type ProviderChoice =
  | { provider: SummaryProvider; unavailable?: undefined }
  | { provider?: undefined; unavailable: string };

let override: ProviderChoice | undefined;

/** The configured summary provider, or why none is available (shown to the user). */
export function summaryProvider(): ProviderChoice {
  if (override) return override;
  const config = env();
  if (config.SUMMARY_PROVIDER === 'ollama') {
    if (!config.OLLAMA_MODEL) return { unavailable: 'No local model configured (OLLAMA_MODEL).' };
    return {
      provider: createOllamaProvider({
        baseUrl: config.OLLAMA_BASE_URL,
        model: config.OLLAMA_MODEL,
        numCtx: config.OLLAMA_NUM_CTX,
        timeoutMs: config.OLLAMA_TIMEOUT_MS,
      }),
    };
  }
  return { unavailable: 'Claude summaries are not set up yet.' };
}

/** Tests only: force a provider choice (pass undefined to restore). */
export function useSummaryProvider(choice: ProviderChoice | undefined): void {
  override = choice;
}
