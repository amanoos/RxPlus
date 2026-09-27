import { env } from '../utils/env';
import { createOpenFdaClient, OpenFdaUnavailableError, type OpenFdaClient } from './client';

export { OpenFdaUnavailableError };
export type { InteractionLabel, OpenFdaClient } from './client';

let shared: OpenFdaClient | undefined;
let override: OpenFdaClient | undefined;

/** The app-wide openFDA client (one cache per server process). */
export function openFda(): OpenFdaClient {
  if (override) return override;
  const { OPENFDA_BASE_URL, OPENFDA_API_KEY } = env();
  shared ??= createOpenFdaClient({ baseUrl: OPENFDA_BASE_URL, apiKey: OPENFDA_API_KEY });
  return shared;
}

/** Tests only: replace the client (pass undefined to restore). */
export function useOpenFdaClient(client: OpenFdaClient | undefined): void {
  override = client;
}
