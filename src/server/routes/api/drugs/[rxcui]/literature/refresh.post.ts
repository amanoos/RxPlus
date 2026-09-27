import { defineEventHandler, getValidatedRouterParams } from 'h3';

import { DrugParams } from '../../../../../drug-info/facts';
import { literatureService } from '../../../../../literature/service';

/** "Check for new research": searches again now, keeping takeaways and hidden papers. */
export default defineEventHandler(async (event) => {
  const { rxcui } = await getValidatedRouterParams(event, DrugParams.parse);
  return literatureService().refresh(rxcui);
});
