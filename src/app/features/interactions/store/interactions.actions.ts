import { createActionGroup, emptyProps, props } from '@ngrx/store';

import type { EvidenceQuery, InteractionReport, LabelEvidence } from '../interaction';

export const InteractionsActions = createActionGroup({
  source: 'Interactions',
  events: {
    'Load Current': emptyProps(),
    'Load Current Success': props<{ report: InteractionReport }>(),
    'Load Current Failure': props<{ error: string; noData: boolean }>(),
    'Check Candidate': props<{ rxcui: string }>(),
    'Check Candidate Success': props<{ rxcui: string; report: InteractionReport }>(),
    'Check Candidate Failure': props<{ rxcui: string; error: string; noData: boolean }>(),
    'Clear Candidate': emptyProps(),
    'Load Evidence': props<{ key: string; query: EvidenceQuery }>(),
    'Load Evidence Success': props<{ key: string; items: LabelEvidence[] }>(),
    'Load Evidence Failure': props<{ key: string; error: string }>(),
  },
});
