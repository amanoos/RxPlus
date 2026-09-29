import { createError, type H3Event } from 'h3';

import type { SessionUser } from '../accounts/service';

/** The signed-in user; scope per-user queries with its id. Throws 401 without one. */
export function requireUser(event: H3Event): SessionUser {
  const user = event.context.user;
  if (!user) throw createError({ statusCode: 401 });
  return user;
}
