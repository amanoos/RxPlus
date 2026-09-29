import { defineNitroPlugin } from 'nitropack/runtime';

import { digestRunner } from '../digest/service';

// Runs cut off by a restart are marked failed and run again; a week missed while
// the server was off is caught up, per user, one after another.
export default defineNitroPlugin(() => {
  if (import.meta.prerender) return;
  digestRunner()
    .startup()
    .then((users) => {
      if (users.length) console.info(`[digest] catching up for ${users.length} user(s)`);
    })
    .catch((error: unknown) => {
      console.warn('[digest] could not check for a missed run:', (error as Error).message);
    });
});
