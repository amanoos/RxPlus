import { defineEventHandler, sendNoContent } from 'h3';

import { authSession } from '../../../utils/session';

export default defineEventHandler(async (event) => {
  await (await authSession(event)).clear();
  return sendNoContent(event);
});
