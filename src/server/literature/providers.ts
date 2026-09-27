import { env } from '../utils/env';
import {
  createClaudeTakeawayProvider,
  createOllamaTakeawayProvider,
  type TakeawayProvider,
} from './takeaways';

export type TakeawayChoice =
  | { provider: TakeawayProvider; unavailable?: undefined }
  | { provider?: undefined; unavailable: string };

let override: TakeawayChoice | undefined;

/** The configured takeaway provider (same settings as summaries), or why none is available. */
export function takeawayProvider(): TakeawayChoice {
  if (override) return override;
  const config = env();
  if (config.SUMMARY_PROVIDER === 'ollama') {
    if (!config.OLLAMA_MODEL) return { unavailable: 'No local model configured (OLLAMA_MODEL).' };
    return {
      provider: createOllamaTakeawayProvider(
        {
          baseUrl: config.OLLAMA_BASE_URL,
          model: config.OLLAMA_MODEL,
          numCtx: config.OLLAMA_NUM_CTX,
          timeoutMs: config.OLLAMA_TIMEOUT_MS,
        },
        { checkModel: config.OLLAMA_CHECK_MODEL },
      ),
    };
  }
  if (!config.ANTHROPIC_API_KEY) {
    return { unavailable: 'Claude takeaways need an API key (ANTHROPIC_API_KEY).' };
  }
  return { provider: createClaudeTakeawayProvider({ apiKey: config.ANTHROPIC_API_KEY }) };
}

/** Tests only: force a provider choice (pass undefined to restore). */
export function useTakeawayProvider(choice: TakeawayChoice | undefined): void {
  override = choice;
}
