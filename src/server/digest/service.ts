import { claudeStartsToday } from '../ai/daily-limit';
import { createAlternativesRepository } from '../alternatives/repository';
import { sharedAlternativesBuilder } from '../alternatives/service';
import { ctGov } from '../ctgov';
import { db } from '../db/client';
import { takeawayProvider } from '../literature/providers';
import { createMedicationsRepository } from '../medications/repository';
import { openFda } from '../openfda';
import { pubMed } from '../pubmed';
import { env } from '../utils/env';
import { createDigestRepository } from './repository';
import { createDigestRunner, type DigestRunner } from './run';

let runner: DigestRunner | undefined;

/** One runner per process, wired to the app database and upstream clients. */
export function digestRunner(): DigestRunner {
  if (runner) return runner;
  const config = env();
  runner = createDigestRunner({
    repo: createDigestRepository(db()),
    medications: createMedicationsRepository(db()),
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
