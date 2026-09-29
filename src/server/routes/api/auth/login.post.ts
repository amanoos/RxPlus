import { defineEventHandler, readValidatedBody, sendNoContent } from 'h3';
import { z } from 'zod';

import { accounts } from '../../../accounts/service';
import { authSession } from '../../../utils/session';

const LoginBody = z.object({
  username: z.string().min(1).max(64),
  password: z.string().min(1).max(1024),
});

export default defineEventHandler(async (event) => {
  const { username, password } = await readValidatedBody(event, LoginBody.parse);
  const user = await accounts().verifyLogin(username, password);
  await (await authSession(event)).update({ userId: user.id, version: user.sessionVersion });
  return sendNoContent(event);
});
