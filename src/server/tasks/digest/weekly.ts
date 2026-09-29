import { defineTask } from 'nitropack/runtime';

import { digestRunner } from '../../digest/service';

// Scheduled in vite.config.ts: Monday 6:00 AM in the server's time zone (TZ).
export default defineTask({
  meta: {
    name: 'digest:weekly',
    description: "Collect this week's news for each user's medications",
  },
  async run() {
    // One user after another, in the background.
    const users = await digestRunner().runAll('schedule');
    return { result: `digests queued for ${users.length} user(s)` };
  },
});
