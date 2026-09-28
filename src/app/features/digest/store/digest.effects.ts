import { isPlatformBrowser } from '@angular/common';
import { inject, PLATFORM_ID } from '@angular/core';
import { NavigationEnd, Router } from '@angular/router';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { Store } from '@ngrx/store';
import {
  catchError,
  concat,
  defer,
  EMPTY,
  exhaustMap,
  filter,
  forkJoin,
  map,
  mergeMap,
  of,
  switchMap,
  take,
  takeUntil,
  takeWhile,
  tap,
  timer,
  withLatestFrom,
} from 'rxjs';

import { authFeature } from '../../../core/auth/auth.reducer';
import { DIGEST_MAX_POLL_MS, DIGEST_POLL_MS } from '../digest';
import { DigestApi, digestError } from '../digest-api.service';
import { DigestActions } from './digest.actions';

export const open = createEffect(
  (actions$ = inject(Actions)) =>
    actions$.pipe(
      ofType(DigestActions.open),
      map(() => DigestActions.reload()),
    ),
  { functional: true },
);

export const reload = createEffect(
  (actions$ = inject(Actions), api = inject(DigestApi)) =>
    actions$.pipe(
      ofType(DigestActions.reload),
      switchMap(() =>
        api.list().pipe(
          map((data) => DigestActions.loadSuccess({ data })),
          catchError((e: unknown) => of(DigestActions.loadFailure({ error: digestError(e) }))),
        ),
      ),
    ),
  { functional: true },
);

/** "Run now": starts a run, then reloads to show it (also after a 409, to show the one running). */
export const run = createEffect(
  (actions$ = inject(Actions), api = inject(DigestApi)) =>
    actions$.pipe(
      ofType(DigestActions.run),
      exhaustMap(() =>
        api.run().pipe(
          map((running) => DigestActions.runStarted({ running })),
          catchError((e: unknown) => of(DigestActions.runFailure({ error: digestError(e) }))),
        ),
      ),
    ),
  { functional: true },
);

export const reloadAfterRun = createEffect(
  (actions$ = inject(Actions)) =>
    actions$.pipe(
      ofType(DigestActions.runStarted, DigestActions.runFailure),
      map(() => DigestActions.reload()),
    ),
  { functional: true },
);

/** While a run is going, re-reads every 5 s until it's done, the page is left, or 30 minutes pass. */
export const pollRun = createEffect(
  (actions$ = inject(Actions), api = inject(DigestApi), platformId = inject(PLATFORM_ID)) =>
    actions$.pipe(
      ofType(DigestActions.loadSuccess),
      filter(({ data }) => !!data.running && isPlatformBrowser(platformId)),
      switchMap(() => {
        let settled = false;
        const polls$ = timer(DIGEST_POLL_MS, DIGEST_POLL_MS).pipe(
          take(Math.floor(DIGEST_MAX_POLL_MS / DIGEST_POLL_MS)),
          exhaustMap(() => api.list().pipe(catchError(() => EMPTY))),
          takeWhile((data) => !!data.running, true),
          tap((data) => (settled = !data.running)),
          map((data) => DigestActions.pollSuccess({ data })),
        );
        const timedOut$ = defer(() => (settled ? EMPTY : of(DigestActions.pollTimeout())));
        return concat(polls$, timedOut$).pipe(
          takeUntil(actions$.pipe(ofType(DigestActions.leave))),
        );
      }),
    ),
  { functional: true },
);

/** Once the page shows digests with unread items (in the browser), mark them read. */
export const markShownRead = createEffect(
  (actions$ = inject(Actions), platformId = inject(PLATFORM_ID)) =>
    actions$.pipe(
      ofType(DigestActions.loadSuccess, DigestActions.pollSuccess),
      filter(() => isPlatformBrowser(platformId)),
      map(({ data }) => data.digests.filter((d) => d.unread > 0).map((d) => d.id)),
      filter((ids) => ids.length > 0),
      map((ids) => DigestActions.markRead({ ids })),
    ),
  { functional: true },
);

export const markRead = createEffect(
  (actions$ = inject(Actions), api = inject(DigestApi)) =>
    actions$.pipe(
      ofType(DigestActions.markRead),
      mergeMap(({ ids }) =>
        forkJoin(ids.map((id) => api.markRead(id))).pipe(
          map(() => DigestActions.refreshUnread()),
          catchError(() => of(DigestActions.refreshUnread())),
        ),
      ),
    ),
  { functional: true },
);

/** The badge refreshes on each navigation while signed in, and when a run finishes. */
export const refreshUnreadOnNavigation = createEffect(
  (router = inject(Router), store = inject(Store), platformId = inject(PLATFORM_ID)) =>
    router.events.pipe(
      filter((e) => e instanceof NavigationEnd && isPlatformBrowser(platformId)),
      withLatestFrom(store.select(authFeature.selectIsAuthenticated)),
      filter(([, authenticated]) => authenticated),
      map(() => DigestActions.refreshUnread()),
    ),
  { functional: true },
);

export const refreshUnreadAfterRun = createEffect(
  (actions$ = inject(Actions)) =>
    actions$.pipe(
      ofType(DigestActions.pollSuccess),
      filter(({ data }) => !data.running),
      map(() => DigestActions.refreshUnread()),
    ),
  { functional: true },
);

export const refreshUnread = createEffect(
  (actions$ = inject(Actions), api = inject(DigestApi)) =>
    actions$.pipe(
      ofType(DigestActions.refreshUnread),
      switchMap(() =>
        api.unreadCount().pipe(
          map((count) => DigestActions.unreadLoaded({ count })),
          catchError(() => EMPTY),
        ),
      ),
    ),
  { functional: true },
);
