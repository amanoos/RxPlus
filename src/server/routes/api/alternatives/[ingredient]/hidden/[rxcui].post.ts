import { defineEventHandler, getValidatedRouterParams, setResponseStatus } from 'h3';

import { alternativesService, HiddenParams } from '../../../../../alternatives/service';

/** Hides an alternative for this drug. */
export default defineEventHandler(async (event) => {
  const { ingredient, rxcui } = await getValidatedRouterParams(event, HiddenParams.parse);
  await alternativesService().hide(ingredient, rxcui);
  setResponseStatus(event, 204);
  return null;
});
