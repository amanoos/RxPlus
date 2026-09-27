import { defineEventHandler, getValidatedRouterParams } from 'h3';

import { DrugParams, drugFactsService } from '../../../../drug-info/facts';

export default defineEventHandler(async (event) => {
  const { rxcui } = await getValidatedRouterParams(event, DrugParams.parse);
  return drugFactsService().facts(rxcui);
});
