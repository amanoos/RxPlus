import { env } from '../utils/env';
import {
  createClaudeTakeawayProvider,
  createJevSubjectCheck,
  createOllamaTakeawayProvider,
  type TakeawayProvider,
} from './takeaways';

export type TakeawayChoice =
  | { provider: TakeawayProvider; unavailable?: undefined }
  | { provider?: undefined; unavailable: string };

let override: TakeawayChoice | undefined;

/**
 * The configured takeaway provider (TAKEAWAY_PROVIDER, else the summaries' provider),
 * or why none is available.
 */
export function takeawayProvider(): TakeawayChoice {
  if (override) return override;
  const config = env();
  const jev = config.JEV_API_KEY
    ? {
        provider: config.JEV_PROVIDER,
        apiKey: config.JEV_API_KEY,
        baseUrl: config.JEV_BASE_URL,
        timeoutMs: config.JEV_TIMEOUT_MS,
      }
    : undefined;
  // Labeling who was studied doesn't depend on the takeaway model, so both get it.
  const withSubjects = (provider: TakeawayProvider): TakeawayProvider =>
    jev ? { ...provider, classifySubjects: createJevSubjectCheck(jev) } : provider;
  if ((config.TAKEAWAY_PROVIDER ?? config.SUMMARY_PROVIDER) === 'ollama') {
    const model = config.OLLAMA_TAKEAWAY_MODEL ?? config.OLLAMA_MODEL;
    if (!model) return { unavailable: 'No local model configured (OLLAMA_MODEL).' };
    return {
      provider: withSubjects(
        createOllamaTakeawayProvider(
          {
            baseUrl: config.OLLAMA_BASE_URL,
            model,
            numCtx: config.OLLAMA_NUM_CTX,
            timeoutMs: config.OLLAMA_TIMEOUT_MS,
          },
          { checkModel: config.OLLAMA_CHECK_MODEL, jev },
        ),
      ),
    };
  }
  if (!config.ANTHROPIC_API_KEY) {
    return { unavailable: 'Claude takeaways need an API key (ANTHROPIC_API_KEY).' };
  }
  return {
    provider: withSubjects(createClaudeTakeawayProvider({ apiKey: config.ANTHROPIC_API_KEY })),
  };
}

/** Tests only: force a provider choice (pass undefined to restore). */
export function useTakeawayProvider(choice: TakeawayChoice | undefined): void {
  override = choice;
}
