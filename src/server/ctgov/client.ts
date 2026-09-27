/**
 * ClinicalTrials.gov API v2 client: the only place the app talks to ClinicalTrials.gov.
 * Docs: https://clinicaltrials.gov/data-api/api
 */
import { createTtlCache, getJson } from '../utils/upstream';

export interface Trial {
  nctId: string;
  title: string;
  /** e.g. COMPLETED, RECRUITING */
  status: string;
  /** e.g. ["PHASE4"], ["EARLY_PHASE1"], ["NA"] */
  phases: string[];
  hasResults: boolean;
  /** YYYY-MM or YYYY-MM-DD */
  startDate: string | null;
  /** YYYY-MM-DD */
  lastUpdate: string | null;
}

export interface CtGovClient {
  /** Up to 3 completed trials with posted results, then recruiting ones, 5 in all. */
  trials(ingredient: string): Promise<Trial[]>;
}

export class CtGovUnavailableError extends Error {
  override readonly name = 'CtGovUnavailableError';
}

export interface CtGovClientOptions {
  /** e.g. https://clinicaltrials.gov/api/v2 */
  baseUrl: string;
  fetch?: typeof fetch;
  now?: () => number;
  timeoutMs?: number;
}

export const MAX_TRIALS = 5;
const MAX_COMPLETED = 3;
const WEEK = 7 * 24 * 60 * 60 * 1000;
const FIELDS = 'NCTId,BriefTitle,OverallStatus,Phase,HasResults,StartDate,LastUpdatePostDate';

interface Study {
  hasResults?: boolean;
  protocolSection?: {
    identificationModule?: { nctId?: string; briefTitle?: string };
    statusModule?: {
      overallStatus?: string;
      startDateStruct?: { date?: string };
      lastUpdatePostDateStruct?: { date?: string };
    };
    designModule?: { phases?: string[] };
  };
}

/** Letters, digits, spaces and hyphens only. */
const searchName = (ingredient: string) =>
  ingredient
    .toLowerCase()
    .replace(/[^a-z0-9 -]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

function toTrial(study: Study): Trial | null {
  const p = study.protocolSection;
  const nctId = p?.identificationModule?.nctId;
  const title = p?.identificationModule?.briefTitle;
  if (!nctId || !title) return null;
  return {
    nctId,
    title,
    status: p?.statusModule?.overallStatus ?? 'UNKNOWN',
    phases: p?.designModule?.phases ?? [],
    hasResults: study.hasResults === true,
    startDate: p?.statusModule?.startDateStruct?.date ?? null,
    lastUpdate: p?.statusModule?.lastUpdatePostDateStruct?.date ?? null,
  };
}

export function createCtGovClient({
  baseUrl,
  fetch: fetchFn = fetch,
  now = Date.now,
  timeoutMs = 10_000,
}: CtGovClientOptions): CtGovClient {
  const cached = createTtlCache(now);
  const unavailable = (message: string) =>
    new CtGovUnavailableError(`ClinicalTrials.gov ${message}`);

  async function studies(name: string, params: Record<string, string>): Promise<Trial[]> {
    const search = new URLSearchParams({
      'query.intr': name,
      sort: 'LastUpdatePostDate:desc',
      fields: FIELDS,
      ...params,
    });
    const { status, body } = await getJson(`${baseUrl.replace(/\/$/, '')}/studies?${search}`, {
      fetch: fetchFn,
      timeoutMs,
      unavailable,
    });
    if (status !== 200) throw unavailable(`responded ${status}`);
    const list = (body as { studies?: Study[] } | null)?.studies ?? [];
    return list.map(toTrial).filter((t): t is Trial => t !== null);
  }

  return {
    trials(ingredient) {
      const name = searchName(ingredient);
      if (!name) return Promise.resolve([]);
      return cached(`trials:${name}`, WEEK, async () => {
        const [completed, recruiting] = await Promise.all([
          studies(name, {
            'filter.overallStatus': 'COMPLETED',
            aggFilters: 'results:with',
            pageSize: String(MAX_COMPLETED),
          }),
          studies(name, { 'filter.overallStatus': 'RECRUITING', pageSize: String(MAX_TRIALS) }),
        ]);
        const picked = completed.slice(0, MAX_COMPLETED);
        for (const trial of recruiting) {
          if (picked.length >= MAX_TRIALS) break;
          if (!picked.some((t) => t.nctId === trial.nctId)) picked.push(trial);
        }
        return picked;
      });
    },
  };
}
