import { defineEventHandler, sendNoContent } from 'h3';

import { authSession } from '../../../utils/session';

// This browser only: other devices stay signed in (reset-password ends them all).
export default defineEventHandler(async (event) => {
  await (await authSession(event)).clear();
  return sendNoContent(event);
});
