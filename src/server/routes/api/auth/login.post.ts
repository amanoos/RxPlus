import { createError, defineEventHandler, readValidatedBody, sendNoContent } from 'h3';
import { z } from 'zod';

import { env } from '../../../utils/env';
import { verifyPassword } from '../../../utils/password';
import { loginLimiter } from '../../../utils/rate-limit';
import { authSession } from '../../../utils/session';

const LoginBody = z.object({ password: z.string().min(1).max(1024) });

export default defineEventHandler(async (event) => {
  const { password } = await readValidatedBody(event, LoginBody.parse);

  if (loginLimiter.isBlocked()) {
    throw createError({ statusCode: 429, message: 'Too many attempts. Try again later.' });
  }
  if (!(await verifyPassword(password, env().APP_PASSWORD_HASH))) {
    loginLimiter.recordFailure();
    throw createError({ statusCode: 401, message: 'Invalid password.' });
  }

  loginLimiter.reset();
  await (await authSession(event)).update({ authenticated: true });
  return sendNoContent(event);
});
