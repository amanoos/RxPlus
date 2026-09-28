import { createActionGroup, emptyProps, props } from '@ngrx/store';

import type { DigestsResponse, RunningDigest } from '../digest';

export const DigestActions = createActionGroup({
  source: 'Digest',
  events: {
    /** The What's new page opened. */
    Open: emptyProps(),
    /** The page closed: stop polling. */
    Leave: emptyProps(),
    Reload: emptyProps(),
    'Load Success': props<{ data: DigestsResponse }>(),
    'Load Failure': props<{ error: string }>(),
    /** "Run now" or "Try again". */
    Run: emptyProps(),
    'Run Started': props<{ running: RunningDigest }>(),
    'Run Failure': props<{ error: string }>(),
    'Poll Success': props<{ data: DigestsResponse }>(),
    'Poll Timeout': emptyProps(),
    /** The page showed these digests with unread items. */
    'Mark Read': props<{ ids: string[] }>(),
    /** Navigation badge. */
    'Refresh Unread': emptyProps(),
    'Unread Loaded': props<{ count: number }>(),
  },
});
