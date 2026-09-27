import type { SummaryLabel } from '../../openfda/client';
import type { RawSummary } from '../summary';

export type ProviderName = 'ollama' | 'claude';

export interface GeneratedSummary {
  raw: RawSummary;
  inputTokens?: number;
  outputTokens?: number;
}

/** Writes a summary of an FDA label; the caller verifies quotes and stores it. */
export interface SummaryProvider {
  name: ProviderName;
  model: string;
  generate(label: SummaryLabel): Promise<GeneratedSummary>;
}

/** Not configured, unreachable, timed out, model missing, over a limit. */
export class ProviderUnavailableError extends Error {
  override readonly name = 'ProviderUnavailableError';
}

/** The model answered, but not with a usable summary (invalid JSON, refusal, cut off). */
export class ProviderOutputError extends Error {
  override readonly name = 'ProviderOutputError';
}

/** The label is too long for the model's context window (never truncated silently). */
export class LabelTooLargeError extends Error {
  override readonly name = 'LabelTooLargeError';
}
