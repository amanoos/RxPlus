import { defineEventHandler, getValidatedRouterParams, sendNoContent } from 'h3';

import { DigestIdParams, digestService } from '../../../../digest/service';

/** Marks a digest's items as read. */
export default defineEventHandler(async (event) => {
  const { id } = await getValidatedRouterParams(event, DigestIdParams.parse);
  await digestService().markRead(id);
  return sendNoContent(event);
});
