import { isPlatformBrowser } from '@angular/common';
import { inject, PLATFORM_ID } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import {
  catchError,
  concat,
  concatMap,
  defer,
  EMPTY,
  exhaustMap,
  filter,
  groupBy,
  map,
  mergeMap,
  of,
  switchMap,
  take,
  takeUntil,
  takeWhile,
  tap,
  timer,
} from 'rxjs';

import { MAX_POLL_MS, POLL_INTERVAL_MS } from '../../drug-info/drug-info';
import { needsTakeaways, type LiteratureResponse } from '../literature';
import { LiteratureApi, literatureError } from '../literature-api.service';
import { LiteratureActions } from './literature.actions';

const anyPending = (data: LiteratureResponse) =>
  data.ingredients.some((i) => i.takeaways.status === 'pending');

export const openResearch = createEffect(
  (actions$ = inject(Actions), api = inject(LiteratureApi)) =>
    actions$.pipe(
      ofType(LiteratureActions.openResearch),
      mergeMap(({ rxcui }) =>
        api.get(rxcui).pipe(
          map((data) => LiteratureActions.loadSuccess({ rxcui, data })),
          catchError((e: unknown) =>
            of(LiteratureActions.loadFailure({ rxcui, error: literatureError(e) })),
          ),
        ),
      ),
    ),
  { functional: true },
);

export const refresh = createEffect(
  (actions$ = inject(Actions), api = inject(LiteratureApi)) =>
    actions$.pipe(
      ofType(LiteratureActions.refresh),
      exhaustMap(({ rxcui }) =>
        api.refresh(rxcui).pipe(
          map((data) => LiteratureActions.refreshSuccess({ rxcui, data })),
          catchError((e: unknown) =>
            of(LiteratureActions.refreshFailure({ rxcui, error: literatureError(e) })),
          ),
        ),
      ),
    ),
  { functional: true },
);

export const startTakeaways = createEffect(
  (actions$ = inject(Actions), api = inject(LiteratureApi)) =>
    actions$.pipe(
      ofType(LiteratureActions.startTakeaways),
      exhaustMap(({ rxcui }) =>
        api.startTakeaways(rxcui).pipe(
          map((data) => LiteratureActions.startTakeawaysSuccess({ rxcui, data })),
          catchError((e: unknown) =>
            of(LiteratureActions.startTakeawaysFailure({ rxcui, error: literatureError(e) })),
          ),
        ),
      ),
    ),
  { functional: true },
);

/**
 * Starts takeaways when shown papers lack one (first visit, or a paper moved up
 * after a hide). Never after a failure: that waits for "Try again". Browser only.
 */
export const startMissingTakeaways = createEffect(
  (actions$ = inject(Actions), platformId = inject(PLATFORM_ID)) =>
    actions$.pipe(
      ofType(LiteratureActions.loadSuccess, LiteratureActions.refreshSuccess),
      filter(
        ({ data }) =>
          isPlatformBrowser(platformId) &&
          data.ingredients.some(
            (lit) => needsTakeaways(lit) && ['none', 'ready'].includes(lit.takeaways.status),
          ),
      ),
      map(({ rxcui }) => LiteratureActions.startTakeaways({ rxcui })),
    ),
  { functional: true },
);

/**
 * While takeaways are being written, re-reads the lists every 2 s until none are
 * pending, the page is left, or MAX_POLL_MS passes. One poller per drug.
 */
export const pollTakeaways = createEffect(
  (actions$ = inject(Actions), api = inject(LiteratureApi), platformId = inject(PLATFORM_ID)) =>
    actions$.pipe(
      ofType(
        LiteratureActions.loadSuccess,
        LiteratureActions.refreshSuccess,
        LiteratureActions.startTakeawaysSuccess,
      ),
      filter(({ data }) => anyPending(data) && isPlatformBrowser(platformId)),
      groupBy(({ rxcui }) => rxcui),
      mergeMap((perDrug$) =>
        perDrug$.pipe(
          switchMap(({ rxcui }) => {
            const leave$ = actions$.pipe(
              ofType(LiteratureActions.leaveResearch),
              filter((a) => a.rxcui === rxcui),
            );
            let settled = false;
            const polls$ = timer(POLL_INTERVAL_MS, POLL_INTERVAL_MS).pipe(
              take(Math.floor(MAX_POLL_MS / POLL_INTERVAL_MS)),
              exhaustMap(() => api.get(rxcui).pipe(catchError(() => EMPTY))),
              takeWhile((data) => anyPending(data), true),
              tap((data) => (settled = !anyPending(data))),
              map((data) => LiteratureActions.pollSuccess({ rxcui, data })),
            );
            const timedOut$ = defer(() =>
              settled ? EMPTY : of(LiteratureActions.pollTimeout({ rxcui })),
            );
            return concat(polls$, timedOut$).pipe(takeUntil(leave$));
          }),
        ),
      ),
    ),
  { functional: true },
);

/** Hide/unhide, then reload so the next candidate moves up; errors roll back. */
export const hidePaper = createEffect(
  (actions$ = inject(Actions), api = inject(LiteratureApi)) =>
    actions$.pipe(
      ofType(LiteratureActions.hidePaper, LiteratureActions.unhidePaper),
      concatMap((action) => {
        const hide = action.type === LiteratureActions.hidePaper.type;
        const call$ = hide
          ? api.hide(action.ingredient, action.pmid)
          : api.unhide(action.ingredient, action.pmid);
        return call$.pipe(
          concatMap(() => api.get(action.rxcui)),
          map((data) => LiteratureActions.loadSuccess({ rxcui: action.rxcui, data })),
          catchError((e: unknown) =>
            of(LiteratureActions.hideFailure({ rxcui: action.rxcui, error: literatureError(e) })),
          ),
        );
      }),
    ),
  { functional: true },
);
