import { defineEventHandler } from 'h3';

import { pricingService } from '../../pricing/service';

/** Monthly cash and insured costs for the active medications, with totals. */
export default defineEventHandler(() => pricingService().costs());
