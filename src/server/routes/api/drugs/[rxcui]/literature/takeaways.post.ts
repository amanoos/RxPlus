import { defineEventHandler, getValidatedRouterParams, setResponseStatus } from 'h3';

import { DrugParams } from '../../../../../drug-info/facts';
import { literatureService } from '../../../../../literature/service';

/** Starts takeaways for papers that lack one; 202 while any ingredient is generating. */
export default defineEventHandler(async (event) => {
  const { rxcui } = await getValidatedRouterParams(event, DrugParams.parse);
  const result = await literatureService().startTakeaways(rxcui);
  if (result.ingredients.some((i) => i.takeaways.status === 'pending'))
    setResponseStatus(event, 202);
  return result;
});
