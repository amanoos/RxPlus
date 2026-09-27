import { defineEventHandler, getValidatedQuery } from 'h3';

import { EvidenceQuery, interactionsService } from '../../../interactions/service';

export default defineEventHandler(async (event) => {
  const query = await getValidatedQuery(event, EvidenceQuery.parse);
  return interactionsService().evidence(query);
});
