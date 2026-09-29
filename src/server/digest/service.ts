/**
 * What the "What's new" page reads: recent digests grouped by drug, the running
 * one, the next scheduled time, and the unread count. The page never starts a
 * run by reading; POST /api/digests/run does.
 */
import { createError } from 'h3';
import { z } from 'zod';

import { claudeStartsToday } from '../ai/daily-limit';
import { createAlternativesRepository } from '../alternatives/repository';
import { sharedAlternativesBuilder } from '../alternatives/service';
import { ctGov } from '../ctgov';
import { db } from '../db/client';
import type { DigestItemDetails, PaperTakeaway } from '../db/schema';
import { takeawayProvider } from '../literature/providers';
import { createMedicationsRepository } from '../medications/repository';
import { openFda } from '../openfda';
import { pubMed } from '../pubmed';
import { env } from '../utils/env';
import {
  createDigestRepository,
  type Digest,
  type DigestItem,
  type DigestRepository,
  type DigestWithItems,
} from './repository';
import { addDays, createDigestRunner, dateIn, type DigestRunner } from './run';

export const DigestIdParams = z.object({ id: z.uuid() });

export interface DigestItemView {
  id: string;
  kind: DigestItem['kind'];
  title: string;
  url: string;
  ingredientRxcui: string | null;
  productRxcui: string | null;
  conditionId: string | null;
  details: DigestItemDetails | null;
  takeaway: PaperTakeaway | null;
  read: boolean;
}

export interface DigestGroup {
  /** The drug (or condition) the items are about. */
  subject: string;
  items: DigestItemView[];
}

export interface DigestView {
  id: string;
  status: Digest['status'];
  trigger: Digest['trigger'];
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
  /** Newest first, up to 12 weeks; the running one is not listed here. */
  digests: DigestView[];
  running: RunningDigest | null;
  /** ISO time of the next scheduled run. */
  nextRun: string;
  hasActiveMedications: boolean;
}

const HOUR = 60 * 60 * 1000;
/** Monday 6:00 AM, as in the schedule (vite.config.ts). */
const SCHEDULE = { weekday: 1, hour: 6 };

/** Minutes the time zone is ahead of UTC at an instant. */
function offsetMinutes(timeZone: string, at: number): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
      .formatToParts(at)
      .map((p) => [p.type, p.value]),
  );
  const local = Date.UTC(
    Number(parts['year']),
    Number(parts['month']) - 1,
    Number(parts['day']),
    Number(parts['hour']),
    Number(parts['minute']),
    Number(parts['second']),
  );
  return Math.round((local - Math.floor(at / 1000) * 1000) / 60_000);
}

/** The next Monday 6:00 AM in the time zone, after `now`. */
export function nextScheduledRun(now: number, timeZone: string): Date {
  const today = dateIn(timeZone, now);
  for (let i = 0; i <= 7; i++) {
    const date = addDays(today, i);
    if (new Date(`${date}T00:00:00Z`).getUTCDay() !== SCHEDULE.weekday) continue;
    const wall = Date.parse(`${date}T00:00:00Z`) + SCHEDULE.hour * HOUR;
    // Wall-clock time to an instant; the second pass settles DST changes.
    let at = wall - offsetMinutes(timeZone, wall) * 60_000;
    at = wall - offsetMinutes(timeZone, at) * 60_000;
    if (at > now) return new Date(at);
  }
  throw new Error('No scheduled run within a week.');
}

function toView(digest: DigestWithItems): DigestView {
  const groups: DigestGroup[] = [];
  for (const item of digest.items) {
    let group = groups.find((g) => g.subject === item.subject);
    if (!group) groups.push((group = { subject: item.subject, items: [] }));
    group.items.push({
      id: item.id,
      kind: item.kind,
      title: item.title,
      url: item.url,
      ingredientRxcui: item.ingredientRxcui,
      productRxcui: item.productRxcui,
      conditionId: item.conditionId,
      details: item.details,
      takeaway: item.takeaway,
      read: item.readAt !== null,
    });
  }
  return {
    id: digest.id,
    status: digest.status,
    trigger: digest.trigger,
    windowStart: digest.windowStart,
    windowEnd: digest.windowEnd,
    startedAt: digest.startedAt.toISOString(),
    finishedAt: digest.finishedAt?.toISOString() ?? null,
    error: digest.error,
    notes: digest.notes ?? [],
    itemCount: digest.items.length,
    unread: digest.items.filter((i) => i.readAt === null).length,
    groups,
  };
}

export interface DigestServiceDeps {
  repo: DigestRepository;
  runner: Pick<DigestRunner, 'start'>;
  medications: { list(): Promise<{ stoppedOn: string | null }[]> };
  timeZone: string;
  now?: () => number;
}

export function createDigestService({
  repo,
  runner,
  medications,
  timeZone,
  now = Date.now,
}: DigestServiceDeps) {
  return {
    async list(): Promise<DigestsResponse> {
      const [recent, meds] = await Promise.all([repo.recent(), medications.list()]);
      const running = recent.find((d) => d.status === 'running');
      return {
        digests: recent.filter((d) => d.status !== 'running').map(toView),
        running: running
          ? { id: running.id, trigger: running.trigger, startedAt: running.startedAt.toISOString() }
          : null,
        nextRun: nextScheduledRun(now(), timeZone).toISOString(),
        hasActiveMedications: meds.some((m) => !m.stoppedOn),
      };
    },

    async unreadCount(): Promise<{ count: number }> {
      return { count: await repo.unreadCount() };
    },

    /** Starts a run now; 409 when one is already running. */
    async run(): Promise<RunningDigest> {
      const digest = await runner.start('manual');
      if (!digest) {
        const message = 'A digest is already being collected.';
        throw createError({ statusCode: 409, statusMessage: message, message });
      }
      return {
        id: digest.id,
        trigger: digest.trigger,
        startedAt: digest.startedAt.toISOString(),
      };
    },

    async markRead(id: string): Promise<void> {
      if (!(await repo.markRead(id))) {
        throw createError({ statusCode: 404, statusMessage: 'Digest not found' });
      }
    },
  };
}

let runner: DigestRunner | undefined;

/** One runner per process, wired to the app database and upstream clients. */
export function digestRunner(): DigestRunner {
  if (runner) return runner;
  const config = env();
  const meds = createMedicationsRepository(db());
  runner = createDigestRunner({
    repo: createDigestRepository(db()),
    // Every user's active medications, until per-user-digest builds one digest per user.
    medications: { list: () => meds.listAllActive() },
    pubmed: pubMed(),
    ctgov: ctGov(),
    openFda: openFda(),
    alternatives: createAlternativesRepository(db()),
    builder: sharedAlternativesBuilder(),
    takeaways: takeawayProvider,
    dailyLimit: config.AI_DAILY_LIMIT,
    claudeStartsToday: () => claudeStartsToday(db(), config.TZ),
    timeZone: config.TZ,
  });
  return runner;
}

/** Service for the signed-in user, wired to the app database and the shared runner. */
export function digestService(userId: string) {
  return createDigestService({
    repo: createDigestRepository(db()),
    runner: digestRunner(),
    medications: createMedicationsRepository(db()).forUser(userId),
    timeZone: env().TZ,
  });
}

/** Tests only: drop the shared runner so the next call wires fresh clients. */
export function resetDigestRunner(): void {
  runner = undefined;
}
