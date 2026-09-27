import { createActionGroup, props } from '@ngrx/store';

import type { DrugFacts, DrugSummary, ReportedReactions } from '../drug-info';

export const DrugInfoActions = createActionGroup({
  source: 'Drug Info',
  events: {
    /** The drug page opened: load facts, reported reactions and the stored summary. */
    'Open Drug': props<{ rxcui: string }>(),
    /** The drug page closed: stop polling. */
    'Leave Drug': props<{ rxcui: string }>(),
    'Load Facts Success': props<{ rxcui: string; facts: DrugFacts }>(),
    'Load Facts Failure': props<{ rxcui: string; error: string }>(),
    'Load Reactions Success': props<{ rxcui: string; reactions: ReportedReactions }>(),
    'Load Reactions Failure': props<{ rxcui: string; error: string }>(),
    'Load Summary Success': props<{ rxcui: string; summary: DrugSummary | null }>(),
    'Load Summary Failure': props<{ rxcui: string; error: string }>(),
    /** `refresh`: "Check for a newer label". */
    'Start Summary': props<{ rxcui: string; refresh?: boolean }>(),
    'Start Summary Success': props<{ rxcui: string; summary: DrugSummary }>(),
    'Start Summary Failure': props<{ rxcui: string; error: string }>(),
    'Poll Summary Success': props<{ rxcui: string; summary: DrugSummary | null }>(),
    /** Still pending when polling gave up. */
    'Poll Summary Timeout': props<{ rxcui: string }>(),
  },
});
