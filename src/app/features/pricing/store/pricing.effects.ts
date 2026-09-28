import { inject } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { Store } from '@ngrx/store';
import { catchError, map, mergeMap, of, switchMap, withLatestFrom } from 'rxjs';

import { MedicationsActions } from '../../medications/store/medications.actions';
import { PricingApi, pricingError } from '../pricing-api.service';
import { PricingActions } from './pricing.actions';
import { pricingFeature } from './pricing.reducer';

export const loadPrices = createEffect(
  (actions$ = inject(Actions), api = inject(PricingApi)) =>
    actions$.pipe(
      ofType(PricingActions.loadPrices),
      mergeMap(({ rxcui }) =>
        api.prices(rxcui).pipe(
          map((data) => PricingActions.pricesLoaded({ rxcui, data })),
          catchError((e: unknown) =>
            of(PricingActions.pricesFailure({ rxcui, error: pricingError(e) })),
          ),
        ),
      ),
    ),
  { functional: true },
);

export const loadCosts = createEffect(
  (actions$ = inject(Actions), api = inject(PricingApi)) =>
    actions$.pipe(
      ofType(PricingActions.loadCosts),
      switchMap(() =>
        api.costs().pipe(
          map((data) => PricingActions.costsLoaded({ data })),
          catchError((e: unknown) => of(PricingActions.costsFailure({ error: pricingError(e) }))),
        ),
      ),
    ),
  { functional: true },
);

/** After a medication's units or copay change, re-read what shows them. */
export const reloadAfterMedicationUpdate = createEffect(
  (actions$ = inject(Actions), store = inject(Store)) =>
    actions$.pipe(
      ofType(MedicationsActions.updateSuccess),
      withLatestFrom(store.select(pricingFeature.selectPricingState)),
      mergeMap(([{ medication }, state]) => [
        ...(state.prices[medication.rxcui]
          ? [PricingActions.loadPrices({ rxcui: medication.rxcui })]
          : []),
        ...(state.costs ? [PricingActions.loadCosts()] : []),
      ]),
    ),
  { functional: true },
);
