import { env } from '../utils/env';
import { createPubMedClient, PubMedUnavailableError, type PubMedClient } from './client';

export { PubMedUnavailableError };
export type { PaperDetails, PaperSearch, PubMedClient, StudyType } from './client';

let shared: PubMedClient | undefined;
let override: PubMedClient | undefined;

/** The app-wide PubMed client (one request queue per server process). */
export function pubMed(): PubMedClient {
  if (override) return override;
  const { PUBMED_BASE_URL, NCBI_API_KEY, NCBI_EMAIL } = env();
  shared ??= createPubMedClient({
    baseUrl: PUBMED_BASE_URL,
    apiKey: NCBI_API_KEY,
    email: NCBI_EMAIL,
  });
  return shared;
}

/** Tests only: replace the client (pass undefined to restore). */
export function usePubMedClient(client: PubMedClient | undefined): void {
  override = client;
}
