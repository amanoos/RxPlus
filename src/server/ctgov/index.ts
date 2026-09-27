import { env } from '../utils/env';
import { createCtGovClient, CtGovUnavailableError, type CtGovClient } from './client';

export { CtGovUnavailableError };
export type { CtGovClient, Trial } from './client';

let shared: CtGovClient | undefined;
let override: CtGovClient | undefined;

/** The app-wide ClinicalTrials.gov client (one cache per server process). */
export function ctGov(): CtGovClient {
  if (override) return override;
  shared ??= createCtGovClient({ baseUrl: env().CTGOV_BASE_URL });
  return shared;
}

/** Tests only: replace the client (pass undefined to restore). */
export function useCtGovClient(client: CtGovClient | undefined): void {
  override = client;
}
