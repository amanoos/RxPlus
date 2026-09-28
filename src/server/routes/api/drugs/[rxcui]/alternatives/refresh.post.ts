import {
  defineEventHandler,
  getValidatedQuery,
  getValidatedRouterParams,
  setResponseStatus,
} from 'h3';

import { alternativesService, ConditionQuery } from '../../../../../alternatives/service';
import { DrugParams } from '../../../../../drug-info/facts';

/** "Check for new approvals": rebuilds this drug's lists in the background. */
export default defineEventHandler(async (event) => {
  const { rxcui } = await getValidatedRouterParams(event, DrugParams.parse);
  const { condition } = await getValidatedQuery(event, ConditionQuery.parse);
  const result = await alternativesService().refresh(rxcui, condition);
  setResponseStatus(event, 202);
  return result;
});
