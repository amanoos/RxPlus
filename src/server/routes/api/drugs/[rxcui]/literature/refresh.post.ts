import { defineEventHandler, getValidatedRouterParams } from 'h3';

import { DrugParams } from '../../../../../drug-info/facts';
import { literatureService } from '../../../../../literature/service';
import { requireUser } from '../../../../../utils/auth-user';

/** "Check for new research": searches again now, keeping takeaways and hidden papers. */
export default defineEventHandler(async (event) => {
  const { rxcui } = await getValidatedRouterParams(event, DrugParams.parse);
  return literatureService(requireUser(event).id).refresh(rxcui);
});
