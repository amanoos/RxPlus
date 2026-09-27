import { defineEventHandler, getValidatedRouterParams } from 'h3';

import { DrugParams } from '../../../../../drug-info/facts';
import { literatureService } from '../../../../../literature/service';

/** Papers and trials per ingredient (searched on first use, then stored). */
export default defineEventHandler(async (event) => {
  const { rxcui } = await getValidatedRouterParams(event, DrugParams.parse);
  return literatureService().get(rxcui);
});
