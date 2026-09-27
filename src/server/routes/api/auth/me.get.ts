import { createError, defineEventHandler } from 'h3';

import { isAuthenticated } from '../../../utils/session';

export default defineEventHandler(async (event) => {
  if (!(await isAuthenticated(event))) throw createError({ statusCode: 401 });
  return { authenticated: true };
});
