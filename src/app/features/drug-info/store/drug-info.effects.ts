import { isPlatformBrowser } from '@angular/common';
import { inject, PLATFORM_ID } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import {
  catchError,
  concat,
  defer,
  EMPTY,
  exhaustMap,
  filter,
  groupBy,
  map,
  merge,
  mergeMap,
  of,
  switchMap,
  take,
  takeUntil,
  takeWhile,
  tap,
  timer,
} from 'rxjs';

import { MAX_POLL_MS, POLL_INTERVAL_MS, type DrugSummary } from '../drug-info';
import { DrugInfoApi, drugInfoError } from '../drug-info-api.service';
import { DrugInfoActions } from './drug-info.actions';

export const openDrug = createEffect(
  (actions$ = inject(Actions), api = inject(DrugInfoApi)) =>
    actions$.pipe(
      ofType(DrugInfoActions.openDrug),
      mergeMap(({ rxcui }) =>
        merge(
          api.facts(rxcui).pipe(
            map((facts) => DrugInfoActions.loadFactsSuccess({ rxcui, facts })),
            catchError((e: unknown) =>
              of(DrugInfoActions.loadFactsFailure({ rxcui, error: drugInfoError(e) })),
            ),
          ),
          api.reportedReactions(rxcui).pipe(
            map((reactions) => DrugInfoActions.loadReactionsSuccess({ rxcui, reactions })),
            catchError((e: unknown) =>
              of(DrugInfoActions.loadReactionsFailure({ rxcui, error: drugInfoError(e) })),
            ),
          ),
          api.summary(rxcui).pipe(
            map((summary) => DrugInfoActions.loadSummarySuccess({ rxcui, summary })),
            catchError((e: unknown) =>
              of(DrugInfoActions.loadSummaryFailure({ rxcui, error: drugInfoError(e) })),
            ),
          ),
        ),
      ),
    ),
  { functional: true },
);

export const startSummary = createEffect(
  (actions$ = inject(Actions), api = inject(DrugInfoApi)) =>
    actions$.pipe(
      ofType(DrugInfoActions.startSummary),
      exhaustMap(({ rxcui }) =>
        api.startSummary(rxcui).pipe(
          map((summary) => DrugInfoActions.startSummarySuccess({ rxcui, summary })),
          catchError((e: unknown) =>
            of(DrugInfoActions.startSummaryFailure({ rxcui, error: drugInfoError(e) })),
          ),
        ),
      ),
    ),
  { functional: true },
);

/**
 * While a summary is pending, re-reads it every 2 s until it settles, the page
 * is left, or MAX_POLL_MS passes. One poller per drug; a new pending result restarts it.
 * Browser only: during SSR the page renders the pending state and the browser polls.
 */
export const pollSummary = createEffect(
  (actions$ = inject(Actions), api = inject(DrugInfoApi), platformId = inject(PLATFORM_ID)) =>
    actions$.pipe(
      ofType(DrugInfoActions.loadSummarySuccess, DrugInfoActions.startSummarySuccess),
      filter(({ summary }) => summary?.status === 'pending' && isPlatformBrowser(platformId)),
      groupBy(({ rxcui }) => rxcui),
      mergeMap((perDrug$) =>
        perDrug$.pipe(
          switchMap(({ rxcui }) => {
            const leave$ = actions$.pipe(
              ofType(DrugInfoActions.leaveDrug),
              filter((a) => a.rxcui === rxcui),
            );
            let settled = false;
            const polls$ = timer(POLL_INTERVAL_MS, POLL_INTERVAL_MS).pipe(
              take(Math.floor(MAX_POLL_MS / POLL_INTERVAL_MS)),
              // A failed poll (e.g. a brief network blip) just waits for the next tick.
              exhaustMap(() => api.summary(rxcui).pipe(catchError(() => EMPTY))),
              takeWhile((s: DrugSummary | null) => s?.status === 'pending', true),
              tap((s) => (settled = s?.status !== 'pending')),
              map((summary) => DrugInfoActions.pollSummarySuccess({ rxcui, summary })),
            );
            const timedOut$ = defer(() =>
              settled ? EMPTY : of(DrugInfoActions.pollSummaryTimeout({ rxcui })),
            );
            return concat(polls$, timedOut$).pipe(takeUntil(leave$));
          }),
        ),
      ),
    ),
  { functional: true },
);
