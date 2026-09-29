import { defineEventHandler, getValidatedRouterParams, setResponseStatus } from 'h3';

import { alternativesService, HiddenParams } from '../../../../../alternatives/service';
import { requireUser } from '../../../../../utils/auth-user';

/** Shows a hidden alternative again. */
export default defineEventHandler(async (event) => {
  const { ingredient, rxcui } = await getValidatedRouterParams(event, HiddenParams.parse);
  await alternativesService(requireUser(event).id).unhide(ingredient, rxcui);
  setResponseStatus(event, 204);
  return null;
});
