import { defineEventHandler, getValidatedRouterParams } from 'h3';

import { DrugParams } from '../../../../drug-info/facts';
import { pricingService } from '../../../../pricing/service';

/** Cost Plus Drugs price for the product, with the owner's monthly figures if it's on the list. */
export default defineEventHandler(async (event) => {
  const { rxcui } = await getValidatedRouterParams(event, DrugParams.parse);
  return pricingService().forProduct(rxcui);
});
