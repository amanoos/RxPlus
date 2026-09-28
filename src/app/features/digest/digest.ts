/** Client-side shapes of the /api/digests responses. */

export interface DigestTakeaway {
  text: string;
  quote: string | null;
  uncited: boolean;
  supported?: boolean | null;
}

export interface DigestItemDetails {
  journal?: string | null;
  year?: number | null;
  studyType?: string;
  count?: number;
  nctId?: string;
  event?: 'new' | 'results';
  status?: string;
  phases?: string[];
  condition?: string;
  firstApproved?: string | null;
  labelDate?: string | null;
  dailyMedUrl?: string | null;
}

export type DigestItemKind = 'paper' | 'more-papers' | 'trial' | 'approval' | 'label';

export interface DigestItem {
  id: string;
  kind: DigestItemKind;
  title: string;
  /** External link, or an app path ("/drugs/…") for approvals and labels. */
  url: string;
  ingredientRxcui: string | null;
  productRxcui: string | null;
  conditionId: string | null;
  details: DigestItemDetails | null;
  takeaway: DigestTakeaway | null;
  read: boolean;
}

export interface DigestGroup {
  subject: string;
  items: DigestItem[];
}

export interface Digest {
  id: string;
  status: 'ready' | 'failed';
  trigger: 'schedule' | 'manual' | 'catch-up';
  /** YYYY-MM-DD */
  windowStart: string;
  windowEnd: string;
  startedAt: string;
  finishedAt: string | null;
  error: string | null;
  notes: string[];
  itemCount: number;
  unread: number;
  groups: DigestGroup[];
}

export interface RunningDigest {
  id: string;
  trigger: Digest['trigger'];
  startedAt: string;
}

export interface DigestsResponse {
  digests: Digest[];
  running: RunningDigest | null;
  nextRun: string;
  hasActiveMedications: boolean;
}

/** While a run is going, the page re-reads every 5 s, for up to 30 minutes. */
export const DIGEST_POLL_MS = 5_000;
export const DIGEST_MAX_POLL_MS = 30 * 60 * 1000;
