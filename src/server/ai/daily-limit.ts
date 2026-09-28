import type { Db } from '../db/client';
import { createDigestRepository } from '../digest/repository';
import { createSummaryRepository } from '../drug-info/repository';
import { createLiteratureRepository } from '../literature/repository';

/**
 * Claude generations started today (in `timeZone`): summaries, takeaways and
 * digest takeaways together. AI_DAILY_LIMIT caps them as one budget.
 */
export async function claudeStartsToday(db: Db, timeZone: string): Promise<number> {
  const [summaries, takeaways, digests] = await Promise.all([
    createSummaryRepository(db).startedToday('claude', timeZone),
    createLiteratureRepository(db).startedToday('claude', timeZone),
    createDigestRepository(db).claudeCallsToday(timeZone),
  ]);
  return summaries + takeaways + digests;
}
