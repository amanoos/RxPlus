import { defineNitroPlugin } from 'nitropack/runtime';

import { env, EnvError } from '../utils/env';

// Validate configuration once at server startup and fail fast on bad config.
// Skipped while prerendering during `npm run build`, where runtime config is absent.
export default defineNitroPlugin(() => {
  if (import.meta.prerender) return;
  try {
    env();
  } catch (error) {
    if (!(error instanceof EnvError)) throw error;
    console.error(`\n[rxplus] ${error.message}\n\nSee .env.example for the expected variables.\n`);
    process.exit(1);
  }
});
