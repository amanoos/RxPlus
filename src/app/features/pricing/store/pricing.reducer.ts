import { createFeature, createReducer, createSelector, on } from '@ngrx/store';

import { AuthActions } from '../../../core/auth/auth.actions';
import type { CostsResponse, PricesResponse } from '../pricing';
import { PricingActions } from './pricing.actions';

export interface Loadable<T> {
  status: 'loading' | 'loaded' | 'error';
  data: T | null;
  error: string | null;
}

export interface PricingState {
  /** By product RXCUI. */
  prices: Record<string, Loadable<PricesResponse>>;
  costs: Loadable<CostsResponse> | null;
}

export const initialPricingState: PricingState = { prices: {}, costs: null };

/** Keeps shown data while reloading; an error without data shows the error. */
const loading = <T>(entry: Loadable<T> | null | undefined): Loadable<T> => ({
  status: entry?.data ? entry.status : 'loading',
  data: entry?.data ?? null,
  error: null,
});
const failed = <T>(entry: Loadable<T> | null | undefined, error: string): Loadable<T> => ({
  status: entry?.data ? 'loaded' : 'error',
  data: entry?.data ?? null,
  error,
});

export const pricingFeature = createFeature({
  name: 'pricing',
  reducer: createReducer(
    initialPricingState,
    on(PricingActions.loadPrices, (s, { rxcui }) => ({
      ...s,
      prices: { ...s.prices, [rxcui]: loading(s.prices[rxcui]) },
    })),
    on(PricingActions.pricesLoaded, (s, { rxcui, data }) => ({
      ...s,
      prices: { ...s.prices, [rxcui]: { status: 'loaded' as const, data, error: null } },
    })),
    on(PricingActions.pricesFailure, (s, { rxcui, error }) => ({
      ...s,
      prices: { ...s.prices, [rxcui]: failed(s.prices[rxcui], error) },
    })),
    on(PricingActions.loadCosts, (s) => ({ ...s, costs: loading(s.costs) })),
    on(PricingActions.costsLoaded, (s, { data }) => ({
      ...s,
      costs: { status: 'loaded' as const, data, error: null },
    })),
    on(PricingActions.costsFailure, (s, { error }) => ({ ...s, costs: failed(s.costs, error) })),
    on(AuthActions.logoutSuccess, () => initialPricingState),
  ),
});

export const selectPrices = (rxcui: string) =>
  createSelector(pricingFeature.selectPrices, (prices) => prices[rxcui] ?? null);
