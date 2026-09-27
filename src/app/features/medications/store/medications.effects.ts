import { HttpErrorResponse } from '@angular/common/http';
import { inject } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { catchError, concatMap, map, mergeMap, of, switchMap } from 'rxjs';

import { MedicationsApi } from '../medications-api.service';
import { MedicationsActions } from './medications.actions';

const FALLBACK = 'Something went wrong. Please try again.';

/** User-facing message for a failed medications request. */
function errorMessage(error: unknown): string {
  if (!(error instanceof HttpErrorResponse)) return FALLBACK;
  const serverMessage = (error.error as { statusMessage?: string } | null)?.statusMessage;
  switch (error.status) {
    case 409:
      return serverMessage ?? 'This medication is already on your active list.';
    case 422:
      return 'That product can’t be added.';
    case 503:
      return serverMessage ?? 'Drug lookup is unavailable right now.';
    case 404:
      return 'That medication no longer exists.';
    case 400:
      return serverMessage ?? 'Please check the details and try again.';
    default:
      return FALLBACK;
  }
}

export const load = createEffect(
  (actions$ = inject(Actions), api = inject(MedicationsApi)) =>
    actions$.pipe(
      ofType(MedicationsActions.load),
      switchMap(() =>
        api.list().pipe(
          map((medications) => MedicationsActions.loadSuccess({ medications })),
          catchError((e: unknown) =>
            of(MedicationsActions.loadFailure({ error: errorMessage(e) })),
          ),
        ),
      ),
    ),
  { functional: true },
);

export const add = createEffect(
  (actions$ = inject(Actions), api = inject(MedicationsApi)) =>
    actions$.pipe(
      ofType(MedicationsActions.add),
      concatMap(({ rxcui, notes, startedOn }) =>
        api.add({ rxcui, notes, startedOn }).pipe(
          map((medication) => MedicationsActions.addSuccess({ medication })),
          catchError((e: unknown) => of(MedicationsActions.addFailure({ error: errorMessage(e) }))),
        ),
      ),
    ),
  { functional: true },
);

export const update = createEffect(
  (actions$ = inject(Actions), api = inject(MedicationsApi)) =>
    actions$.pipe(
      ofType(MedicationsActions.update),
      concatMap(({ id, changes }) =>
        api.update(id, changes).pipe(
          map((medication) => MedicationsActions.updateSuccess({ medication })),
          catchError((e: unknown) =>
            of(MedicationsActions.updateFailure({ error: errorMessage(e) })),
          ),
        ),
      ),
    ),
  { functional: true },
);

export const remove = createEffect(
  (actions$ = inject(Actions), api = inject(MedicationsApi)) =>
    actions$.pipe(
      ofType(MedicationsActions.remove),
      mergeMap(({ id }) =>
        api.remove(id).pipe(
          map(() => MedicationsActions.removeSuccess({ id })),
          catchError((e: unknown) =>
            of(MedicationsActions.removeFailure({ error: errorMessage(e) })),
          ),
        ),
      ),
    ),
  { functional: true },
);
