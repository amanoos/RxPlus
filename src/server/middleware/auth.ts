import { createError, defineEventHandler, getRequestURL } from 'h3';

import { accounts } from '../accounts/service';
import { authSession } from '../utils/session';

const PUBLIC_API = new Set(['/api/auth/login', '/api/health']);

// Every /api route requires a signed-in user except login and health. Pages are
// guarded separately (SSR + client guard) so they can redirect to /login instead of 401.
export default defineEventHandler(async (event) => {
  const { pathname } = getRequestURL(event);
  if (!pathname.startsWith('/api/') || PUBLIC_API.has(pathname)) return;
  const user = await accounts().resolveSession((await authSession(event)).data);
  if (!user) throw createError({ statusCode: 401 });
  event.context.user = user;
});
