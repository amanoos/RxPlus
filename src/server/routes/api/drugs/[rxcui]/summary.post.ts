import { defineEventHandler, getValidatedRouterParams, setResponseStatus } from 'h3';

import { DrugParams } from '../../../../drug-info/facts';
import { summaryService } from '../../../../drug-info/service';

/** Starts (or joins) generation; 202 while pending, 200 once ready. */
export default defineEventHandler(async (event) => {
  const { rxcui } = await getValidatedRouterParams(event, DrugParams.parse);
  const summary = await summaryService().start(rxcui);
  if (summary.status === 'pending') setResponseStatus(event, 202);
  return summary;
});
