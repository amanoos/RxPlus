import { defineNitroPlugin } from 'nitropack/runtime';

import { db } from '../db/client';
import { createSummaryRepository } from '../drug-info/repository';
import { createLiteratureRepository } from '../literature/repository';

// AI summaries and takeaways generate in this process, so work left pending by a
// restart will never finish: mark it failed so the page offers "Try again".
export default defineNitroPlugin(() => {
  if (import.meta.prerender) return;
  const cleanups = [
    ['summaries', createSummaryRepository(db()).failInterrupted()],
    ['takeaway jobs', createLiteratureRepository(db()).failInterrupted()],
  ] as const;
  for (const [what, cleanup] of cleanups) {
    cleanup
      .then((n) => {
        if (n) console.warn(`[ai] marked ${n} interrupted ${what} as failed`);
      })
      .catch((error: unknown) => {
        console.warn(`[ai] could not check for interrupted ${what}:`, (error as Error).message);
      });
  }
});
