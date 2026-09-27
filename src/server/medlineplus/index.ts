import { createMedlinePlusClient, type MedlinePlusClient } from './client';

export type { MedlinePlusClient, MedlinePlusPage } from './client';

let shared: MedlinePlusClient | undefined;
let override: MedlinePlusClient | undefined;

/** The app-wide MedlinePlus Connect client (one cache per server process). */
export function medlinePlus(): MedlinePlusClient {
  if (override) return override;
  shared ??= createMedlinePlusClient();
  return shared;
}

/** Tests only: replace the client (pass undefined to restore). */
export function useMedlinePlusClient(client: MedlinePlusClient | undefined): void {
  override = client;
}
