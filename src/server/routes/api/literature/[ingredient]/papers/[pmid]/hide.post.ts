import { defineEventHandler, getValidatedRouterParams, setResponseStatus } from 'h3';

import { literatureService, PaperParams } from '../../../../../../literature/service';
import { requireUser } from '../../../../../../utils/auth-user';

/** Hides a paper; the next candidate takes its place. */
export default defineEventHandler(async (event) => {
  const { ingredient, pmid } = await getValidatedRouterParams(event, PaperParams.parse);
  await literatureService(requireUser(event).id).setHidden(ingredient, pmid, true);
  setResponseStatus(event, 204);
  return null;
});
