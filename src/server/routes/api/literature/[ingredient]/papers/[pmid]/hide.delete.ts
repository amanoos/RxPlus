import { defineEventHandler, getValidatedRouterParams, setResponseStatus } from 'h3';

import { literatureService, PaperParams } from '../../../../../../literature/service';

/** Shows a hidden paper again. */
export default defineEventHandler(async (event) => {
  const { ingredient, pmid } = await getValidatedRouterParams(event, PaperParams.parse);
  await literatureService().setHidden(ingredient, pmid, false);
  setResponseStatus(event, 204);
  return null;
});
