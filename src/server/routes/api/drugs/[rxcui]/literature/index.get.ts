import { defineEventHandler, getValidatedRouterParams } from 'h3';

import { DrugParams } from '../../../../../drug-info/facts';
import { literatureService } from '../../../../../literature/service';
import { requireUser } from '../../../../../utils/auth-user';

/** Papers and trials per ingredient (searched on first use, then stored). */
export default defineEventHandler(async (event) => {
  const { rxcui } = await getValidatedRouterParams(event, DrugParams.parse);
  return literatureService(requireUser(event).id).get(rxcui);
});
