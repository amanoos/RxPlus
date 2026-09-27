/** Errors shared by every AI provider call (summaries, takeaways). */

/** Not configured, unreachable, timed out, model missing, over a limit. */
export class ProviderUnavailableError extends Error {
  override readonly name = 'ProviderUnavailableError';
}

/** The model answered, but not with usable output (invalid JSON, refusal, cut off). */
export class ProviderOutputError extends Error {
  override readonly name = 'ProviderOutputError';
}

/** The input is too long for the model's context window (never truncated silently). */
export class InputTooLargeError extends Error {
  override readonly name = 'InputTooLargeError';
}
