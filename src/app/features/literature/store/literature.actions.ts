import { createActionGroup, props } from '@ngrx/store';

import type { LiteratureResponse } from '../literature';

/** Keyed by the drug page's product RXCUI; each response lists its ingredients. */
export const LiteratureActions = createActionGroup({
  source: 'Literature',
  events: {
    /** The Research section opened: load (and on first use, search) the lists. */
    'Open Research': props<{ rxcui: string }>(),
    /** The drug page closed: stop polling. */
    'Leave Research': props<{ rxcui: string }>(),
    'Load Success': props<{ rxcui: string; data: LiteratureResponse }>(),
    'Load Failure': props<{ rxcui: string; error: string }>(),
    /** "Check for new research". */
    Refresh: props<{ rxcui: string }>(),
    'Refresh Success': props<{ rxcui: string; data: LiteratureResponse }>(),
    'Refresh Failure': props<{ rxcui: string; error: string }>(),
    'Start Takeaways': props<{ rxcui: string }>(),
    'Start Takeaways Success': props<{ rxcui: string; data: LiteratureResponse }>(),
    'Start Takeaways Failure': props<{ rxcui: string; error: string }>(),
    'Poll Success': props<{ rxcui: string; data: LiteratureResponse }>(),
    /** Still generating when polling gave up. */
    'Poll Timeout': props<{ rxcui: string }>(),
    'Hide Paper': props<{ rxcui: string; ingredient: string; pmid: string }>(),
    'Unhide Paper': props<{ rxcui: string; ingredient: string; pmid: string }>(),
    'Hide Failure': props<{ rxcui: string; error: string }>(),
  },
});
