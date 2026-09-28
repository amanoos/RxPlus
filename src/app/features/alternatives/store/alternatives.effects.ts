import { isPlatformBrowser } from '@angular/common';
import { inject, PLATFORM_ID } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { Store } from '@ngrx/store';
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
  withLatestFrom,
} from 'rxjs';

import { MedicationsActions } from '../../medications/store/medications.actions';
import { ALTERNATIVES_MAX_POLL_MS, ALTERNATIVES_POLL_MS, anyBuilding } from '../alternatives';
import { AlternativesApi, alternativesError } from '../alternatives-api.service';
import { AlternativesActions } from './alternatives.actions';
import { alternativesFeature } from './alternatives.reducer';

const entitiesOf = (store: Store) => store.select(alternativesFeature.selectEntities);

export const open = createEffect(
  (actions$ = inject(Actions)) =>
    actions$.pipe(
      ofType(AlternativesActions.open),
      map(({ rxcui }) => AlternativesActions.reload({ rxcui })),
    ),
  { functional: true },
);

/** Loads with the visit's condition, if one was chosen for a product not on the list. */
export const reload = createEffect(
  (actions$ = inject(Actions), api = inject(AlternativesApi), store = inject(Store)) =>
    actions$.pipe(
      ofType(AlternativesActions.reload),
      withLatestFrom(entitiesOf(store)),
      mergeMap(([{ rxcui }, entities]) =>
        api.get(rxcui, entities[rxcui]?.visitCondition?.id).pipe(
          map((data) => AlternativesActions.loadSuccess({ rxcui, data })),
          catchError((e: unknown) =>
            of(AlternativesActions.loadFailure({ rxcui, error: alternativesError(e) })),
          ),
        ),
      ),
    ),
  { functional: true },
);

/**
 * A choice for a saved medication is stored on it (the medications store stays
 * in sync); a choice for this visit only just reloads with it.
 */
export const chooseCondition = createEffect(
  (actions$ = inject(Actions)) =>
    actions$.pipe(
      ofType(AlternativesActions.chooseCondition, AlternativesActions.clearCondition),
      map((action) => {
        if (!action.medicationId) return AlternativesActions.reload({ rxcui: action.rxcui });
        const takenFor =
          action.type === AlternativesActions.chooseCondition.type
            ? { id: action.condition.id, name: action.condition.name }
            : null;
        return MedicationsActions.update({ id: action.medicationId, changes: { takenFor } });
      }),
    ),
  { functional: true },
);

/** After a medication changes, reload the alternatives shown for it. */
export const reloadAfterMedicationUpdate = createEffect(
  (actions$ = inject(Actions), store = inject(Store)) =>
    actions$.pipe(
      ofType(MedicationsActions.updateSuccess, MedicationsActions.updateFailure),
      withLatestFrom(store.select(alternativesFeature.selectEntities)),
      mergeMap(([action, entities]) =>
        Object.values(entities)
          .filter((e) => e?.choosing)
          .filter(
            (e) =>
              action.type === MedicationsActions.updateFailure.type ||
              e?.data?.medicationId === action.medication.id,
          )
          .map((e) => AlternativesActions.reload({ rxcui: e!.rxcui })),
      ),
    ),
  { functional: true },
);

export const refresh = createEffect(
  (actions$ = inject(Actions), api = inject(AlternativesApi), store = inject(Store)) =>
    actions$.pipe(
      ofType(AlternativesActions.refresh),
      withLatestFrom(entitiesOf(store)),
      exhaustMap(([{ rxcui }, entities]) =>
        api.refresh(rxcui, entities[rxcui]?.visitCondition?.id).pipe(
          map((data) => AlternativesActions.loadSuccess({ rxcui, data })),
          catchError((e: unknown) =>
            of(AlternativesActions.loadFailure({ rxcui, error: alternativesError(e) })),
          ),
        ),
      ),
    ),
  { functional: true },
);

/** While a list is building, re-reads every 2 s until it's done, the page is left, or 5 minutes pass. */
export const pollBuilds = createEffect(
  (
    actions$ = inject(Actions),
    api = inject(AlternativesApi),
    store = inject(Store),
    platformId = inject(PLATFORM_ID),
  ) =>
    actions$.pipe(
      ofType(AlternativesActions.loadSuccess),
      filter(({ data }) => anyBuilding(data) && isPlatformBrowser(platformId)),
      groupBy(({ rxcui }) => rxcui),
      mergeMap((perDrug$) =>
        perDrug$.pipe(
          switchMap(({ rxcui }) => {
            const leave$ = actions$.pipe(
              ofType(AlternativesActions.leave),
              filter((a) => a.rxcui === rxcui),
            );
            let settled = false;
            const polls$ = timer(ALTERNATIVES_POLL_MS, ALTERNATIVES_POLL_MS).pipe(
              take(Math.floor(ALTERNATIVES_MAX_POLL_MS / ALTERNATIVES_POLL_MS)),
              withLatestFrom(entitiesOf(store)),
              exhaustMap(([, entities]) =>
                api.get(rxcui, entities[rxcui]?.visitCondition?.id).pipe(catchError(() => EMPTY)),
              ),
              takeWhile((data) => anyBuilding(data), true),
              tap((data) => (settled = !anyBuilding(data))),
              map((data) => AlternativesActions.pollSuccess({ rxcui, data })),
            );
            const timedOut$ = defer(() =>
              settled ? EMPTY : of(AlternativesActions.pollTimeout({ rxcui })),
            );
            return concat(polls$, timedOut$).pipe(takeUntil(leave$));
          }),
        ),
      ),
    ),
  { functional: true },
);

/** Hide/unhide, then reload; errors roll back. */
export const hide = createEffect(
  (actions$ = inject(Actions), api = inject(AlternativesApi)) =>
    actions$.pipe(
      ofType(AlternativesActions.hide, AlternativesActions.unhide),
      concatMap((action) => {
        const call$ =
          action.type === AlternativesActions.hide.type
            ? api.hide(action.ingredient, action.target)
            : api.unhide(action.ingredient, action.target);
        return call$.pipe(
          map(() => AlternativesActions.reload({ rxcui: action.rxcui })),
          catchError((e: unknown) =>
            of(
              AlternativesActions.hideFailure({ rxcui: action.rxcui, error: alternativesError(e) }),
            ),
          ),
        );
      }),
    ),
  { functional: true },
);
