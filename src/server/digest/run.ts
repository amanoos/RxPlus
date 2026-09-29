/**
 * One digest run for one user: over the window since their last successful run,
 * collect news for their active medications and store it as one digest at the end
 * (or mark the run failed). One run per user at a time; runs happen in the
 * background, and the weekly and catch-up runs go one user after another.
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
import type { Digest, DigestRepository, NewDigestItem, UserDigests } from './repository';

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
  repo: Pick<DigestRepository, 'forUser' | 'failInterrupted' | 'takeawayFor'>;
  medications: {
    forUser(userId: string): { list(): Promise<Medication[]> };
    usersWithActiveMedications(): Promise<string[]>;
  };
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
  async function takeawaysFor(mine: UserDigests, digestId: string): Promise<TakeawayChoice> {
    const choice = deps.takeaways();
    if (choice.provider?.name !== 'claude') return choice;
    if ((await deps.claudeStartsToday()) >= deps.dailyLimit) {
      return {
        unavailable: `The daily limit of ${deps.dailyLimit} Claude requests has been reached.`,
      };
    }
    await mine.countClaudeCall(digestId);
    return choice;
  }

  async function collect(userId: string, mine: UserDigests, digest: Digest, window: DigestWindow) {
    const active = (await deps.medications.forUser(userId).list()).filter((m) => !m.stoppedOn);
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

    const seen = mine.seen.bind(mine);
    const storedTakeaway = (pmid: string) => repo.takeawayFor(pmid);
    const found: Collected[] = [];
    for (const ingredient of ingredients.values()) {
      const takeaways = () => takeawaysFor(mine, digest.id);
      found.push(
        await collectPapers(ingredient, window, {
          pubmed: deps.pubmed,
          seen,
          takeaways,
          storedTakeaway,
        }),
      );
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
      recorded: await mine.labelVersions(products.map((p) => p.rxcui)),
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

  async function execute(
    userId: string,
    mine: UserDigests,
    digest: Digest,
    window: DigestWindow,
  ): Promise<void> {
    try {
      await mine.finish(digest.id, await collect(userId, mine, digest, window));
    } catch (error) {
      console.error('[digest] run failed:', error);
      await mine
        .fail(digest.id, errorMessage(error) || 'The digest could not be collected.')
        .catch((e: unknown) => console.error('[digest] could not record the failure:', e));
    }
  }

  const track = <T>(job: Promise<T>): Promise<T> => {
    const tracked = job.then(() => undefined);
    jobs.add(tracked);
    void tracked.finally(() => jobs.delete(tracked));
    return job;
  };

  /** Starts one user's run; resolves when it has finished (or failed). Null when one is running. */
  async function begin(
    trigger: Digest['trigger'],
    userId: string,
  ): Promise<{ digest: Digest; done: Promise<void> } | null> {
    const mine = repo.forUser(userId);
    const today = dateIn(deps.timeZone, now());
    const window = digestWindow(await mine.lastSuccessful(), today);
    const digest = await mine.start({ trigger, windowStart: window.from, windowEnd: window.to });
    if (!digest) return null;
    return { digest, done: track(execute(userId, mine, digest, window)) };
  }

  /** Runs these users one after another, in the background: upstream APIs see one run at a time. */
  function inTurn(trigger: Digest['trigger'], userIds: string[]): string[] {
    void track(
      (async () => {
        for (const userId of userIds) {
          try {
            await (
              await begin(trigger, userId)
            )?.done;
          } catch (error) {
            console.error('[digest] could not start a run:', error);
          }
        }
      })(),
    );
    return userIds;
  }

  return {
    /** Starts one user's run in the background (Run now); null when theirs is already running. */
    async start(trigger: Digest['trigger'], userId: string): Promise<Digest | null> {
      return (await begin(trigger, userId))?.digest ?? null;
    },

    /** The weekly run: every user with an active medication, one after another. */
    async runAll(trigger: Digest['trigger']): Promise<string[]> {
      return inTurn(trigger, await deps.medications.usersWithActiveMedications());
    },

    /**
     * At startup: fail runs cut off by a restart and run those users again, and catch
     * up users whose last successful digest is more than a week old; one at a time.
     */
    async startup(): Promise<string[]> {
      const interrupted = new Set(await repo.failInterrupted());
      if (interrupted.size) {
        console.warn(`[digest] marked ${interrupted.size} interrupted run(s) as failed`);
      }
      const due: string[] = [];
      for (const userId of await deps.medications.usersWithActiveMedications()) {
        const last = await repo.forUser(userId).lastSuccessful();
        if (interrupted.has(userId) || needsCatchUp(last, now())) due.push(userId);
      }
      return due.length ? inTurn('catch-up', due) : [];
    },
  };
}

export type DigestRunner = ReturnType<typeof createDigestRunner>;
