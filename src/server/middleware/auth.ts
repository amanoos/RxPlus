import { createError, defineEventHandler, getRequestURL } from 'h3';

import { isAuthenticated } from '../utils/session';

const PUBLIC_API = new Set(['/api/auth/login', '/api/health']);

// Every /api route requires a session except login and health. Pages are guarded
// separately (SSR + client guard) so they can redirect to /login instead of 401.
export default defineEventHandler(async (event) => {
  const { pathname } = getRequestURL(event);
  if (!pathname.startsWith('/api/') || PUBLIC_API.has(pathname)) return;
  if (!(await isAuthenticated(event))) throw createError({ statusCode: 401 });
});
