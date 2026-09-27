import { env } from '../utils/env';
import { createRxNavClient, RxNavUnavailableError, type RxNavClient } from './client';

export { RxNavUnavailableError };
export type { RxNavClient, RxProduct, RxProductDetails } from './client';

let shared: RxNavClient | undefined;
let override: RxNavClient | undefined;

/** The app-wide RxNav client (one cache per server process). */
export function rxnav(): RxNavClient {
  if (override) return override;
  shared ??= createRxNavClient({ baseUrl: env().RXNAV_BASE_URL });
  return shared;
}

/** Tests only: replace the client (pass undefined to restore). */
export function useRxNavClient(client: RxNavClient | undefined): void {
  override = client;
}

export const RXNAV_UNAVAILABLE_MESSAGE = 'Drug lookup is unavailable right now.';
