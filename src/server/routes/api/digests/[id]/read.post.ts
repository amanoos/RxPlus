import { defineEventHandler, getValidatedRouterParams, sendNoContent } from 'h3';

import { DigestIdParams, digestService } from '../../../../digest/service';
import { requireUser } from '../../../../utils/auth-user';

/** Marks a digest's items as read. */
export default defineEventHandler(async (event) => {
  const { id } = await getValidatedRouterParams(event, DigestIdParams.parse);
  await digestService(requireUser(event).id).markRead(id);
  return sendNoContent(event);
});
