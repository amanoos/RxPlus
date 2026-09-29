import { defineEventHandler } from 'h3';

import { pricingService } from '../../pricing/service';
import { requireUser } from '../../utils/auth-user';

/** Monthly cash and insured costs for the active medications, with totals. */
export default defineEventHandler((event) => pricingService(requireUser(event).id).costs());
