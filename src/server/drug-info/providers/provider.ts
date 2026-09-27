import type { SummaryLabel } from '../../openfda/client';
import type { RawSummary } from '../summary';

export {
  InputTooLargeError as LabelTooLargeError,
  ProviderOutputError,
  ProviderUnavailableError,
} from '../../ai/errors';

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
