import { defineEventHandler, getQuery, getValidatedRouterParams, setResponseStatus } from 'h3';

import { DrugParams } from '../../../../drug-info/facts';
import { summaryService } from '../../../../drug-info/service';

/** Starts (or joins) generation; 202 while pending, 200 once ready. `?refresh=1` re-reads the label. */
export default defineEventHandler(async (event) => {
  const { rxcui } = await getValidatedRouterParams(event, DrugParams.parse);
  const refresh = getQuery(event)['refresh'] === '1';
  const summary = await summaryService().start(rxcui, { refresh });
  if (summary.status === 'pending') setResponseStatus(event, 202);
  return summary;
});
