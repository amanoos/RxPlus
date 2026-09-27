import { defineEventHandler, getValidatedRouterParams } from 'h3';

import { DrugParams } from '../../../../drug-info/facts';
import { summaryService } from '../../../../drug-info/service';

export default defineEventHandler(async (event) => {
  const { rxcui } = await getValidatedRouterParams(event, DrugParams.parse);
  return summaryService().get(rxcui);
});
