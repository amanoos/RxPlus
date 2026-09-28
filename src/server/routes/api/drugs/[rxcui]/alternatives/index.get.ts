import { defineEventHandler, getValidatedQuery, getValidatedRouterParams } from 'h3';

import { alternativesService, ConditionQuery } from '../../../../../alternatives/service';
import { DrugParams } from '../../../../../drug-info/facts';

/** Same-class drugs and, for the condition it's taken for, new drugs and other classes. */
export default defineEventHandler(async (event) => {
  const { rxcui } = await getValidatedRouterParams(event, DrugParams.parse);
  const { condition } = await getValidatedQuery(event, ConditionQuery.parse);
  return alternativesService().get(rxcui, condition);
});
