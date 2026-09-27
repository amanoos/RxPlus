import { defineEventHandler, getValidatedRouterParams, setResponseStatus } from 'h3';

import { literatureService, PaperParams } from '../../../../../../literature/service';

/** Hides a paper; the next candidate takes its place. */
export default defineEventHandler(async (event) => {
  const { ingredient, pmid } = await getValidatedRouterParams(event, PaperParams.parse);
  await literatureService().setHidden(ingredient, pmid, true);
  setResponseStatus(event, 204);
  return null;
});
