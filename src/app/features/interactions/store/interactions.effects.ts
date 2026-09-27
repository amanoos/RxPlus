import { inject } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { Store } from '@ngrx/store';
import { catchError, filter, map, mergeMap, of, switchMap, withLatestFrom } from 'rxjs';

import { MedicationsActions } from '../../medications/store/medications.actions';
import { InteractionsApi, toFailure } from '../interactions-api.service';
import { InteractionsActions } from './interactions.actions';
import { interactionsFeature } from './interactions.reducer';

/** The current-medications report follows every change to the medication list. */
export const refreshCurrent = createEffect(
  (actions$ = inject(Actions)) =>
    actions$.pipe(
      ofType(
        MedicationsActions.loadSuccess,
        MedicationsActions.addSuccess,
        MedicationsActions.updateSuccess,
        MedicationsActions.removeSuccess,
      ),
      map(() => InteractionsActions.loadCurrent()),
    ),
  { functional: true },
);

export const loadCurrent = createEffect(
  (actions$ = inject(Actions), api = inject(InteractionsApi)) =>
    actions$.pipe(
      ofType(InteractionsActions.loadCurrent),
      switchMap(() =>
        api.current().pipe(
          map((report) => InteractionsActions.loadCurrentSuccess({ report })),
          catchError((e: unknown) => of(InteractionsActions.loadCurrentFailure(toFailure(e)))),
        ),
      ),
    ),
  { functional: true },
);

export const checkCandidate = createEffect(
  (actions$ = inject(Actions), api = inject(InteractionsApi)) =>
    actions$.pipe(
      ofType(InteractionsActions.checkCandidate),
      switchMap(({ rxcui }) =>
        api.check(rxcui).pipe(
          map((report) => InteractionsActions.checkCandidateSuccess({ rxcui, report })),
          catchError((e: unknown) =>
            of(InteractionsActions.checkCandidateFailure({ rxcui, ...toFailure(e) })),
          ),
        ),
      ),
    ),
  { functional: true },
);

/** Evidence is fetched once per pair; later requests reuse the loaded entry. */
export const loadEvidence = createEffect(
  (actions$ = inject(Actions), api = inject(InteractionsApi), store = inject(Store)) =>
    actions$.pipe(
      ofType(InteractionsActions.loadEvidence),
      withLatestFrom(store.select(interactionsFeature.selectEvidence)),
      filter(([{ key }, evidence]) => evidence[key]?.status !== 'loaded'),
      mergeMap(([{ key, query }]) =>
        api.evidence(query).pipe(
          map((items) => InteractionsActions.loadEvidenceSuccess({ key, items })),
          catchError((e: unknown) =>
            of(InteractionsActions.loadEvidenceFailure({ key, error: toFailure(e).error })),
          ),
        ),
      ),
    ),
  { functional: true },
);
