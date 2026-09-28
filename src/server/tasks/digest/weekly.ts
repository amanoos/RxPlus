import { defineTask } from 'nitropack/runtime';

import { digestRunner } from '../../digest/service';

// Scheduled in vite.config.ts: Monday 6:00 AM in the server's time zone (TZ).
export default defineTask({
  meta: { name: 'digest:weekly', description: "Collect this week's news for the medications" },
  async run() {
    const digest = await digestRunner().start('schedule');
    return { result: digest ? `started ${digest.id}` : 'a digest is already running' };
  },
});
