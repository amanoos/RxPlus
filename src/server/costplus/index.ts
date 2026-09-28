import { env } from '../utils/env';
import { createCostPlusClient, CostPlusUnavailableError, type CostPlusClient } from './client';

export { CostPlusUnavailableError };
export type { CostPlusClient, CostPlusItem } from './client';

let shared: CostPlusClient | undefined;
let override: CostPlusClient | undefined;

/** The app-wide Cost Plus Drugs client (one cache per server process). */
export function costPlus(): CostPlusClient {
  if (override) return override;
  shared ??= createCostPlusClient({ baseUrl: env().COSTPLUS_BASE_URL });
  return shared;
}

/** Tests only: replace the client (pass undefined to restore). */
export function useCostPlusClient(client: CostPlusClient | undefined): void {
  override = client;
}
