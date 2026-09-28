import { defineEventHandler, getValidatedRouterParams, setResponseStatus } from 'h3';

import { alternativesService, HiddenParams } from '../../../../../alternatives/service';

/** Shows a hidden alternative again. */
export default defineEventHandler(async (event) => {
  const { ingredient, rxcui } = await getValidatedRouterParams(event, HiddenParams.parse);
  await alternativesService().unhide(ingredient, rxcui);
  setResponseStatus(event, 204);
  return null;
});
