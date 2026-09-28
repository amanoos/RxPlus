/** Shared shapes for the digest collectors. */
import type { DigestKind, NewDigestItem } from './repository';

/** Inclusive dates (YYYY-MM-DD) a run covers. */
export interface DigestWindow {
  from: string;
  to: string;
}

export interface DigestIngredient {
  rxcui: string;
  name: string;
}

/** What a collector found, plus notes on anything it couldn't check. */
export interface Collected {
  items: NewDigestItem[];
  notes: string[];
}

/** External ids already reported in an earlier digest. */
export type Seen = (kind: DigestKind, externalIds: string[]) => Promise<Set<string>>;

export const inWindow = (date: string | null | undefined, { from, to }: DigestWindow) =>
  !!date && date.slice(0, 10) >= from && date.slice(0, 10) <= to;

export const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : String(error);
