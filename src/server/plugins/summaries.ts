import { defineNitroPlugin } from 'nitropack/runtime';

import { db } from '../db/client';
import { createSummaryRepository } from '../drug-info/repository';

// Summaries generate in this process, so pending rows left by a restart will never
// finish: mark them failed so the page offers "Try again".
export default defineNitroPlugin(() => {
  if (import.meta.prerender) return;
  createSummaryRepository(db())
    .failInterrupted()
    .then((n) => {
      if (n) console.warn(`[summary] marked ${n} interrupted summaries as failed`);
    })
    .catch((error: unknown) => {
      console.warn(
        '[summary] could not check for interrupted summaries:',
        (error as Error).message,
      );
    });
});
