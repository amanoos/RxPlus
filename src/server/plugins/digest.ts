import { defineNitroPlugin } from 'nitropack/runtime';

import { digestRunner } from '../digest/service';

// A run cut off by a restart is marked failed and run again; a week missed while
// the server was off is caught up.
export default defineNitroPlugin(() => {
  if (import.meta.prerender) return;
  digestRunner()
    .startup()
    .then((digest) => {
      if (digest) console.info(`[digest] catching up: run ${digest.id} started`);
    })
    .catch((error: unknown) => {
      console.warn('[digest] could not check for a missed run:', (error as Error).message);
    });
});
