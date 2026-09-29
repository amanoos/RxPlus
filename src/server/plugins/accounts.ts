import { defineNitroPlugin } from 'nitropack/runtime';

import { createUsersRepository } from '../accounts/repository';
import { db } from '../db/client';

// With no accounts nobody can sign in: say how to create the first one.
export default defineNitroPlugin(() => {
  if (import.meta.prerender) return;
  createUsersRepository(db())
    .count()
    .then((n) => {
      if (!n) {
        console.warn(
          '[rxplus] No accounts yet. Create one with: docker compose exec app node dist/user.cjs add <username>' +
            ' (in development: npm run user -- add <username>)',
        );
      }
    })
    .catch((error: unknown) => {
      console.warn('[rxplus] could not count accounts:', (error as Error).message);
    });
});
