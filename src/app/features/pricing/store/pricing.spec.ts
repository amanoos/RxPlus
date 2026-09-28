import { HttpErrorResponse, provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideMockActions } from '@ngrx/effects/testing';
import { Action } from '@ngrx/store';
import { provideMockStore } from '@ngrx/store/testing';
import { firstValueFrom, of, Subject, throwError, type Observable } from 'rxjs';

import { AuthActions } from '../../../core/auth/auth.actions';
import { medicationFixture } from '../../medications/medication.fixture';
import { MedicationsActions } from '../../medications/store/medications.actions';
import { dollars } from '../pricing';
import { PricingApi, pricingError } from '../pricing-api.service';
import { costsFixture, pricesFixture } from '../pricing.fixture';
import { PricingActions } from './pricing.actions';
import * as effects from './pricing.effects';
import {
  initialPricingState,
  pricingFeature,
  selectPrices,
  type PricingState,
} from './pricing.reducer';

const { reducer } = pricingFeature;
const rxcui = '314076';

describe('PricingApi', () => {
  it('calls the prices and costs endpoints', async () => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    const api = TestBed.inject(PricingApi);
    const http = TestBed.inject(HttpTestingController);
    const prices = firstValueFrom(api.prices(rxcui));
    http.expectOne('/api/drugs/314076/prices').flush(pricesFixture());
    expect((await prices).status).toBe('found');
    const costs = firstValueFrom(api.costs());
    http.expectOne('/api/costs').flush(costsFixture());
    expect((await costs).totals.cashCents).toBe(39);
    http.verify();
  });

  it('shows the server’s message when prices are unavailable', () => {
    const down = new HttpErrorResponse({
      status: 503,
      error: { statusMessage: 'Prices are unavailable right now.' },
    });
    expect(pricingError(down)).toBe('Prices are unavailable right now.');
    expect(pricingError(new HttpErrorResponse({ status: 500 }))).toBe(
      'Something went wrong. Please try again.',
    );
    expect(dollars(333)).toBe('$3.33');
  });
});

describe('pricing reducer', () => {
  it('loads prices per product, keeping them visible when a reload fails', () => {
    let s = reducer(initialPricingState, PricingActions.loadPrices({ rxcui }));
    expect(selectPrices(rxcui).projector(s.prices)).toEqual({
      status: 'loading',
      data: null,
      error: null,
    });
    s = reducer(s, PricingActions.pricesLoaded({ rxcui, data: pricesFixture() }));
    s = reducer(s, PricingActions.loadPrices({ rxcui }));
    s = reducer(s, PricingActions.pricesFailure({ rxcui, error: 'Down' }));
    expect(s.prices[rxcui]).toMatchObject({ status: 'loaded', error: 'Down' });
    expect(
      reducer(initialPricingState, PricingActions.pricesFailure({ rxcui: '1', error: 'Down' }))
        .prices['1'].status,
    ).toBe('error');
    expect(selectPrices('999').projector(s.prices)).toBeNull();
  });

  it('loads costs and resets on logout', () => {
    let s = reducer(initialPricingState, PricingActions.loadCosts());
    expect(s.costs?.status).toBe('loading');
    s = reducer(s, PricingActions.costsLoaded({ data: costsFixture() }));
    expect(s.costs?.status).toBe('loaded');
    s = reducer(s, PricingActions.costsFailure({ error: 'Down' }));
    expect(s.costs).toMatchObject({ status: 'loaded', error: 'Down' });
    expect(reducer(s, AuthActions.logoutSuccess())).toEqual(initialPricingState);
  });
});

describe('pricing effects', () => {
  let actions$: Subject<Action>;
  const api = {
    prices: vi.fn<(rxcui: string) => Observable<ReturnType<typeof pricesFixture>>>(),
    costs: vi.fn<() => Observable<ReturnType<typeof costsFixture>>>(),
  };
  const setup = (pricing: PricingState = initialPricingState) => {
    actions$ = new Subject<Action>();
    vi.resetAllMocks();
    TestBed.configureTestingModule({
      providers: [
        provideMockActions(() => actions$),
        provideMockStore({ initialState: { pricing } }),
        { provide: PricingApi, useValue: api },
      ],
    });
  };
  const collect = (effect: () => Observable<Action>) => {
    const out: Action[] = [];
    TestBed.runInInjectionContext(effect).subscribe((a) => out.push(a));
    return out;
  };

  it('loads prices and costs through the API, reporting failures', () => {
    setup();
    api.prices.mockReturnValueOnce(of(pricesFixture()));
    api.prices.mockReturnValueOnce(throwError(() => new HttpErrorResponse({ status: 500 })));
    api.costs.mockReturnValueOnce(of(costsFixture()));
    api.costs.mockReturnValueOnce(throwError(() => new HttpErrorResponse({ status: 500 })));
    const prices = collect(effects.loadPrices);
    const costs = collect(effects.loadCosts);
    actions$.next(PricingActions.loadPrices({ rxcui }));
    actions$.next(PricingActions.loadPrices({ rxcui: '1' }));
    actions$.next(PricingActions.loadCosts());
    actions$.next(PricingActions.loadCosts());
    const error = 'Something went wrong. Please try again.';
    expect(prices).toEqual([
      PricingActions.pricesLoaded({ rxcui, data: pricesFixture() }),
      PricingActions.pricesFailure({ rxcui: '1', error }),
    ]);
    expect(costs).toEqual([
      PricingActions.costsLoaded({ data: costsFixture() }),
      PricingActions.costsFailure({ error }),
    ]);
  });

  it('reloads what shows a medication after it is updated', () => {
    const shown = reducer(
      reducer(initialPricingState, PricingActions.loadPrices({ rxcui })),
      PricingActions.loadCosts(),
    );
    setup(shown);
    const out = collect(effects.reloadAfterMedicationUpdate);
    actions$.next(MedicationsActions.updateSuccess({ medication: medicationFixture() }));
    actions$.next(
      MedicationsActions.updateSuccess({ medication: medicationFixture({ rxcui: '617310' }) }),
    );
    expect(out).toEqual([
      PricingActions.loadPrices({ rxcui }),
      PricingActions.loadCosts(),
      PricingActions.loadCosts(),
    ]);
  });
});
