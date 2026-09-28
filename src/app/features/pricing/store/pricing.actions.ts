import { createActionGroup, emptyProps, props } from '@ngrx/store';

import type { CostsResponse, PricesResponse } from '../pricing';

export const PricingActions = createActionGroup({
  source: 'Pricing',
  events: {
    /** The drug page's Prices section opened. */
    'Load Prices': props<{ rxcui: string }>(),
    'Prices Loaded': props<{ rxcui: string; data: PricesResponse }>(),
    'Prices Failure': props<{ rxcui: string; error: string }>(),
    /** The Costs page opened. */
    'Load Costs': emptyProps(),
    'Costs Loaded': props<{ data: CostsResponse }>(),
    'Costs Failure': props<{ error: string }>(),
  },
});
