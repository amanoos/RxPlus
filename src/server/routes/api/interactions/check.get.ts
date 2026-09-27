import { defineEventHandler, getValidatedQuery } from 'h3';

import { CheckQuery, interactionsService } from '../../../interactions/service';

export default defineEventHandler(async (event) => {
  const { rxcui } = await getValidatedQuery(event, CheckQuery.parse);
  return interactionsService().check(rxcui);
});
