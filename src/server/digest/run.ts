/**
 * One digest run: over the window since the last successful run, collect news
 * for the active medications and store it as one digest at the end (or mark the
 * run failed). One run at a time; runs happen in the background.
 */
import type { AlternativesBuilder } from '../alternatives/builder';
import type { AlternativesRepository } from '../alternatives/repository';
import type { CtGovClient } from '../ctgov/client';
import type { TakeawayChoice } from '../literature/providers';
import type { Medication } from '../medications/repository';
import type { OpenFdaClient } from '../openfda/client';
import type { PubMedClient } from '../pubmed/client';
import { errorMessage, type Collected, type DigestIngredient, type DigestWindow } from './collect';
import { collectApprovals, type DigestCondition } from './collect-approvals';
import { collectLabels, type DigestProduct } from './collect-labels';
import { collectPapers } from './collect-papers';
import { collectTrials } from './collect-trials';
import type { Digest, DigestRepository, NewDigestItem } from './repository';

/** The first run, and a catch-up threshold: one week. */
export const WINDOW_DAYS = 7;
const DAY = 24 * 60 * 60 * 1000;

/** Today's date (YYYY-MM-DD) in a time zone. */
export const dateIn = (timeZone: string, at: number) =>
  new Intl.DateTimeFormat('en-CA', { timeZone }).format(at);

export const addDays = (date: string, days: number) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY).toISOString().slice(0, 10);

/**
 * From the end of the last successful run (that day again, so news entered
 * later that day isn't missed; repeats are filtered), or the past week.
 */
export function digestWindow(last: Digest | null, today: string): DigestWindow {
  return { from: last ? last.windowEnd : addDays(today, -WINDOW_DAYS), to: today };
}

/** At startup: run now when the last successful run is more than a week old. */
export function needsCatchUp(last: Digest | null, now: number): boolean {
  return !!last && last.startedAt.getTime() < now - WINDOW_DAYS * DAY;
}

export interface RunnerDeps {
  repo: DigestRepository;
  medications: { list(): Promise<Medication[]> };
  pubmed: Pick<PubMedClient, 'recentPapers' | 'paperDetails' | 'abstracts'>;
  ctgov: Pick<CtGovClient, 'recentUpdates'>;
  openFda: Pick<OpenFdaClient, 'summaryLabel'>;
  alternatives: Pick<AlternativesRepository, 'list' | 'drugs'>;
  builder: Pick<AlternativesBuilder, 'rebuild'>;
  takeaways: () => TakeawayChoice;
  dailyLimit: number;
  claudeStartsToday: () => Promise<number>;
  timeZone: string;
  now?: () => number;
}

/** Background runs; tests await them via settleDigestJobs(). */
const jobs = new Set<Promise<void>>();

export async function settleDigestJobs(): Promise<void> {
  await Promise.allSettled([...jobs]);
}

export function createDigestRunner(deps: RunnerDeps) {
  const { repo, now = Date.now } = deps;

  /** The takeaway provider for one call; a Claude call is counted before it's made. */
  async function takeawaysFor(digestId: string): Promise<TakeawayChoice> {
    const choice = deps.takeaways();
    if (choice.provider?.name !== 'claude') return choice;
    if ((await deps.claudeStartsToday()) >= deps.dailyLimit) {
      return {
        unavailable: `The daily limit of ${deps.dailyLimit} Claude requests has been reached.`,
      };
    }
    await repo.countClaudeCall(digestId);
    return choice;
  }

  async function collect(digest: Digest, window: DigestWindow) {
    const active = (await deps.medications.list()).filter((m) => !m.stoppedOn);
    const ingredients = new Map<string, DigestIngredient>();
    const conditions = new Map<string, DigestCondition>();
    const products: DigestProduct[] = [];
    for (const med of active) {
      for (const ing of med.ingredients) ingredients.set(ing.rxcui, ing);
      if (med.takenForId && med.takenForName) {
        conditions.set(med.takenForId, { id: med.takenForId, name: med.takenForName });
      }
      products.push({
        rxcui: med.rxcui,
        name: med.name,
        subject: med.ingredients.map((i) => i.name).join(' / ') || med.name,
      });
    }

    const seen = repo.seen.bind(repo);
    const found: Collected[] = [];
    for (const ingredient of ingredients.values()) {
      const takeaways = () => takeawaysFor(digest.id);
      found.push(await collectPapers(ingredient, window, { pubmed: deps.pubmed, seen, takeaways }));
      found.push(await collectTrials(ingredient, window, { ctgov: deps.ctgov, seen }));
    }
    const today = window.to;
    for (const condition of conditions.values()) {
      found.push(
        await collectApprovals(condition, {
          alternatives: deps.alternatives,
          builder: deps.builder,
          seen,
          today,
        }),
      );
    }
    const labels = await collectLabels(products, {
      openFda: deps.openFda,
      recorded: await repo.labelVersions(products.map((p) => p.rxcui)),
      seen,
    });
    found.push(labels);

    // The same trial or paper can turn up for two ingredients: list it once.
    const reported = new Set<string>();
    const items: NewDigestItem[] = [];
    for (const item of found.flatMap((f) => f.items)) {
      const id = item.externalId ? `${item.kind}:${item.externalId}` : null;
      if (id && reported.has(id)) continue;
      if (id) reported.add(id);
      items.push(item);
    }
    return { items, notes: found.flatMap((f) => f.notes), labelVersions: labels.labelVersions };
  }

  async function execute(digest: Digest, window: DigestWindow): Promise<void> {
    try {
      await repo.finish(digest.id, await collect(digest, window));
    } catch (error) {
      console.error('[digest] run failed:', error);
      await repo
        .fail(digest.id, errorMessage(error) || 'The digest could not be collected.')
        .catch((e: unknown) => console.error('[digest] could not record the failure:', e));
    }
  }

  /** Starts a run in the background; null when one is already running. */
  async function start(trigger: Digest['trigger']): Promise<Digest | null> {
    const today = dateIn(deps.timeZone, now());
    const window = digestWindow(await repo.lastSuccessful(), today);
    const digest = await repo.start({ trigger, windowStart: window.from, windowEnd: window.to });
    if (!digest) return null;
    const job = execute(digest, window);
    jobs.add(job);
    void job.finally(() => jobs.delete(job));
    return digest;
  }

  return {
    start,

    /**
     * At startup: fail a run cut off by a restart and run again, or catch up
     * when a week was missed.
     */
    async startup(): Promise<Digest | null> {
      const interrupted = await repo.failInterrupted();
      if (interrupted) console.warn('[digest] marked an interrupted run as failed');
      if (!interrupted && !needsCatchUp(await repo.lastSuccessful(), now())) return null;
      return start('catch-up');
    },
  };
}

export type DigestRunner = ReturnType<typeof createDigestRunner>;
