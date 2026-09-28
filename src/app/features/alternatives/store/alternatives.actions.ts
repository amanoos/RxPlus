import { createActionGroup, props } from '@ngrx/store';

import type { AlternativesResponse, Condition } from '../alternatives';

/** Keyed by the drug page's product RXCUI. */
export const AlternativesActions = createActionGroup({
  source: 'Alternatives',
  events: {
    /** The Alternatives section opened. */
    Open: props<{ rxcui: string }>(),
    /** The drug page closed: stop polling. */
    Leave: props<{ rxcui: string }>(),
    Reload: props<{ rxcui: string }>(),
    'Load Success': props<{ rxcui: string; data: AlternativesResponse }>(),
    'Load Failure': props<{ rxcui: string; error: string }>(),
    /**
     * "What do you take it for?": saved on the medication when the product is on
     * the list (`medicationId`), otherwise for this visit only.
     */
    'Choose Condition': props<{
      rxcui: string;
      condition: Condition;
      medicationId: string | null;
    }>(),
    /** "Change": back to the chooser (a saved choice is cleared on the medication). */
    'Clear Condition': props<{ rxcui: string; medicationId: string | null }>(),
    /** "Check for new approvals". */
    Refresh: props<{ rxcui: string }>(),
    'Poll Success': props<{ rxcui: string; data: AlternativesResponse }>(),
    'Poll Timeout': props<{ rxcui: string }>(),
    Hide: props<{ rxcui: string; ingredient: string; target: string }>(),
    Unhide: props<{ rxcui: string; ingredient: string; target: string }>(),
    'Hide Failure': props<{ rxcui: string; error: string }>(),
  },
});
