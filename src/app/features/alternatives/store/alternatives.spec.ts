import { HttpErrorResponse, provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { PLATFORM_ID } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideMockActions } from '@ngrx/effects/testing';
import { Action } from '@ngrx/store';
import { provideMockStore, MockStore } from '@ngrx/store/testing';
import { firstValueFrom, of, Subject, throwError, type Observable } from 'rxjs';

import { AuthActions } from '../../../core/auth/auth.actions';
import { medicationFixture } from '../../medications/medication.fixture';
import { MedicationsActions } from '../../medications/store/medications.actions';
import {
  ALTERNATIVES_MAX_POLL_MS,
  ALTERNATIVES_POLL_MS,
  type AlternativesResponse,
} from '../alternatives';
import { AlternativesApi, alternativesError } from '../alternatives-api.service';
import { alternativesFixture, ingredientAlternativesFixture } from '../alternatives.fixture';
import { AlternativesActions } from './alternatives.actions';
import * as effects from './alternatives.effects';
import {
  alternativesFeature,
  initialAlternativesState,
  selectAlternatives,
  type AlternativesState,
} from './alternatives.reducer';

const { reducer } = alternativesFeature;
const rxcui = '314076';
const HTN = { id: 'D006973', name: 'Hypertension' };
const ready = alternativesFixture();
const building = alternativesFixture({
  ingredients: [
    ingredientAlternativesFixture({
      conditionList: { status: 'pending', builtAt: null, skipped: null, error: null },
    }),
  ],
});

describe('AlternativesApi', () => {
  it('calls the list, refresh and hide endpoints, with a visit condition when given', async () => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    const api = TestBed.inject(AlternativesApi);
    const http = TestBed.inject(HttpTestingController);

    const plain = firstValueFrom(api.get(rxcui));
    http.expectOne('/api/drugs/314076/alternatives').flush(ready);
    await plain;
    const visit = firstValueFrom(api.get(rxcui, 'D006973'));
    http.expectOne('/api/drugs/314076/alternatives?condition=D006973').flush(ready);
    await visit;

    const refresh = firstValueFrom(api.refresh(rxcui));
    const r = http.expectOne('/api/drugs/314076/alternatives/refresh');
    expect(r.request.method).toBe('POST');
    r.flush(building);
    await refresh;

    const hide = firstValueFrom(api.hide('29046', '3827'));
    const h = http.expectOne('/api/alternatives/29046/hidden/3827');
    expect(h.request.method).toBe('POST');
    h.flush(null, { status: 204, statusText: 'No Content' });
    await hide;
    const unhide = firstValueFrom(api.unhide('29046', '3827'));
    const u = http.expectOne('/api/alternatives/29046/hidden/3827');
    expect(u.request.method).toBe('DELETE');
    u.flush(null, { status: 204, statusText: 'No Content' });
    await unhide;
    http.verify();
  });

  it('shows the server’s message for expected failures', () => {
    expect(
      alternativesError(
        new HttpErrorResponse({
          status: 400,
          error: { statusMessage: 'That condition isn’t a known use of this drug.' },
        }),
      ),
    ).toBe('That condition isn’t a known use of this drug.');
    expect(alternativesError(new Error('x'))).toBe('Something went wrong. Please try again.');
  });
});

describe('alternatives reducer', () => {
  const opened = reducer(initialAlternativesState, AlternativesActions.open({ rxcui }));
  const entry = (s: AlternativesState) => selectAlternatives(rxcui)({ alternatives: s });

  it('loads and keeps data visible when a later load fails', () => {
    expect(entry(opened)).toMatchObject({ status: 'loading', data: null });
    let s = reducer(opened, AlternativesActions.loadSuccess({ rxcui, data: ready }));
    expect(entry(s)).toMatchObject({ status: 'loaded', data: ready });
    s = reducer(s, AlternativesActions.refresh({ rxcui }));
    expect(entry(s)?.refreshing).toBe(true);
    s = reducer(s, AlternativesActions.loadFailure({ rxcui, error: 'RxNav down' }));
    expect(entry(s)).toMatchObject({
      status: 'loaded',
      data: ready,
      refreshing: false,
      error: 'RxNav down',
    });
  });

  it('keeps a visit-only condition in the entry, and marks saved choices as in progress', () => {
    let s = reducer(
      opened,
      AlternativesActions.chooseCondition({ rxcui, condition: HTN, medicationId: null }),
    );
    expect(entry(s)).toMatchObject({ visitCondition: HTN, choosing: true });
    s = reducer(s, AlternativesActions.clearCondition({ rxcui, medicationId: null }));
    expect(entry(s)?.visitCondition).toBeNull();

    s = reducer(
      opened,
      AlternativesActions.chooseCondition({ rxcui, condition: HTN, medicationId: 'm1' }),
    );
    expect(entry(s)).toMatchObject({ visitCondition: null, choosing: true });
    s = reducer(s, AlternativesActions.loadSuccess({ rxcui, data: ready }));
    expect(entry(s)?.choosing).toBe(false);
  });

  it('hides at once from every group, and rolls back on failure', () => {
    let s = reducer(opened, AlternativesActions.loadSuccess({ rxcui, data: ready }));
    s = reducer(s, AlternativesActions.hide({ rxcui, ingredient: '29046', target: '2679059' }));
    const groups = entry(s)!.data!.ingredients[0].groups;
    expect(groups.newForCondition).toEqual([]);
    expect(groups.otherClasses.map((c) => c.className)).toEqual(['Angiotensin 2 Receptor Blocker']);
    expect(groups.hidden.map((d) => d.name)).toEqual(['aprocitentan']);

    s = reducer(s, AlternativesActions.hideFailure({ rxcui, error: 'Server down' }));
    expect(entry(s)!.data).toEqual(ready);
    expect(entry(s)!.hideError).toBe('Server down');
  });

  it('resets on logout', () => {
    expect(reducer(opened, AuthActions.logoutSuccess())).toEqual(initialAlternativesState);
  });
});

describe('alternatives effects', () => {
  let actions$: Subject<Action>;
  const api = {
    get: vi.fn<(rxcui: string, condition?: string | null) => Observable<AlternativesResponse>>(),
    refresh: vi.fn(),
    hide: vi.fn(),
    unhide: vi.fn(),
  };
  const setup = (state: AlternativesState = initialAlternativesState, platform = 'browser') => {
    actions$ = new Subject<Action>();
    vi.resetAllMocks();
    TestBed.configureTestingModule({
      providers: [
        provideMockActions(() => actions$),
        provideMockStore({ initialState: { alternatives: state } }),
        { provide: AlternativesApi, useValue: api },
        { provide: PLATFORM_ID, useValue: platform },
      ],
    });
    return TestBed.inject(MockStore);
  };
  const collect = (effect: () => Observable<Action>) => {
    const out: Action[] = [];
    TestBed.runInInjectionContext(effect).subscribe((a) => out.push(a));
    return out;
  };
  const withEntry = (changes: Partial<NonNullable<AlternativesState['entities'][string]>>) => {
    let s = reducer(initialAlternativesState, AlternativesActions.open({ rxcui }));
    s = reducer(s, AlternativesActions.loadSuccess({ rxcui, data: ready }));
    return { ...s, entities: { [rxcui]: { ...s.entities[rxcui]!, ...changes } } };
  };
  afterEach(() => vi.useRealTimers());

  it('loads with the visit condition, if any', () => {
    setup(withEntry({ visitCondition: HTN }));
    api.get.mockReturnValue(of(ready));
    const out = collect(effects.reload);
    actions$.next(AlternativesActions.reload({ rxcui }));
    expect(api.get).toHaveBeenCalledWith(rxcui, 'D006973');
    expect(out).toEqual([AlternativesActions.loadSuccess({ rxcui, data: ready })]);
  });

  it('saves a choice on the medication, or reloads for a visit-only choice', () => {
    setup();
    const out = collect(effects.chooseCondition);
    actions$.next(
      AlternativesActions.chooseCondition({ rxcui, condition: HTN, medicationId: 'm1' }),
    );
    actions$.next(AlternativesActions.clearCondition({ rxcui, medicationId: 'm1' }));
    actions$.next(
      AlternativesActions.chooseCondition({ rxcui, condition: HTN, medicationId: null }),
    );
    expect(out).toEqual([
      MedicationsActions.update({ id: 'm1', changes: { takenFor: HTN } }),
      MedicationsActions.update({ id: 'm1', changes: { takenFor: null } }),
      AlternativesActions.reload({ rxcui }),
    ]);
  });

  it('reloads after the medication was updated', () => {
    setup(withEntry({ choosing: true }));
    const out = collect(effects.reloadAfterMedicationUpdate);
    actions$.next(
      MedicationsActions.updateSuccess({ medication: medicationFixture({ id: 'other' }) }),
    );
    actions$.next(
      MedicationsActions.updateSuccess({ medication: medicationFixture({ id: 'm1' }) }),
    );
    expect(out).toEqual([AlternativesActions.reload({ rxcui })]);
  });

  it('polls while a list is building and stops when done or on leave', async () => {
    vi.useFakeTimers();
    setup();
    api.get.mockReturnValueOnce(of(building)).mockReturnValueOnce(of(ready));
    const out = collect(effects.pollBuilds);
    actions$.next(AlternativesActions.loadSuccess({ rxcui, data: building }));
    await vi.advanceTimersByTimeAsync(ALTERNATIVES_POLL_MS * 2);
    expect(out).toEqual([
      AlternativesActions.pollSuccess({ rxcui, data: building }),
      AlternativesActions.pollSuccess({ rxcui, data: ready }),
    ]);

    api.get.mockReturnValue(of(building));
    actions$.next(AlternativesActions.loadSuccess({ rxcui, data: building }));
    await vi.advanceTimersByTimeAsync(ALTERNATIVES_POLL_MS);
    actions$.next(AlternativesActions.leave({ rxcui }));
    await vi.advanceTimersByTimeAsync(ALTERNATIVES_POLL_MS * 10);
    expect(api.get).toHaveBeenCalledTimes(3);
  });

  it('gives up after the maximum wait, and never polls during SSR', async () => {
    vi.useFakeTimers();
    setup();
    api.get.mockReturnValue(of(building));
    const out = collect(effects.pollBuilds);
    actions$.next(AlternativesActions.loadSuccess({ rxcui, data: building }));
    await vi.advanceTimersByTimeAsync(ALTERNATIVES_MAX_POLL_MS + ALTERNATIVES_POLL_MS);
    expect(out.at(-1)).toEqual(AlternativesActions.pollTimeout({ rxcui }));

    TestBed.resetTestingModule();
    setup(initialAlternativesState, 'server');
    const server = collect(effects.pollBuilds);
    actions$.next(AlternativesActions.loadSuccess({ rxcui, data: building }));
    await vi.advanceTimersByTimeAsync(ALTERNATIVES_POLL_MS * 3);
    expect(server).toEqual([]);
  });

  it('hides, then reloads; failures roll back', () => {
    setup();
    api.hide.mockReturnValueOnce(of(undefined));
    api.unhide.mockReturnValueOnce(throwError(() => new HttpErrorResponse({ status: 500 })));
    const out = collect(effects.hide);
    actions$.next(AlternativesActions.hide({ rxcui, ingredient: '29046', target: '3827' }));
    actions$.next(AlternativesActions.unhide({ rxcui, ingredient: '29046', target: '3827' }));
    expect(api.hide).toHaveBeenCalledWith('29046', '3827');
    expect(out).toEqual([
      AlternativesActions.reload({ rxcui }),
      AlternativesActions.hideFailure({ rxcui, error: 'Something went wrong. Please try again.' }),
    ]);
  });

  it('refreshes through the API', () => {
    setup();
    api.refresh.mockReturnValue(of(building));
    const out = collect(effects.refresh);
    actions$.next(AlternativesActions.refresh({ rxcui }));
    expect(out).toEqual([AlternativesActions.loadSuccess({ rxcui, data: building })]);
  });
});
