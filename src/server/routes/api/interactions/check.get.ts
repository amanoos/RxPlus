import { defineEventHandler, getValidatedQuery } from 'h3';

import { CheckQuery, interactionsService } from '../../../interactions/service';
import { requireUser } from '../../../utils/auth-user';

export default defineEventHandler(async (event) => {
  const { rxcui } = await getValidatedQuery(event, CheckQuery.parse);
  return interactionsService(requireUser(event).id).check(rxcui);
});
