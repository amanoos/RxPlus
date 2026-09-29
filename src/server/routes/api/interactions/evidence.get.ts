import { defineEventHandler, getValidatedQuery } from 'h3';

import { EvidenceQuery, interactionsService } from '../../../interactions/service';
import { requireUser } from '../../../utils/auth-user';

export default defineEventHandler(async (event) => {
  const query = await getValidatedQuery(event, EvidenceQuery.parse);
  return interactionsService(requireUser(event).id).evidence(query);
});
