import { HttpErrorResponse, provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { PLATFORM_ID } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideMockActions } from '@ngrx/effects/testing';
import { Action } from '@ngrx/store';
import { firstValueFrom, of, Subject, throwError, type Observable } from 'rxjs';

import { AuthActions } from '../../../core/auth/auth.actions';
import { MAX_POLL_MS, POLL_INTERVAL_MS } from '../../drug-info/drug-info';
import type { LiteratureResponse } from '../literature';
import { LiteratureApi, literatureError } from '../literature-api.service';
import { ingredientFixture, literatureFixture, paperFixture } from '../literature.fixture';
import { LiteratureActions } from './literature.actions';
import * as effects from './literature.effects';
import { initialLiteratureState, literatureFeature, selectLiterature } from './literature.reducer';

const { reducer } = literatureFeature;
const rxcui = '314076';
const ready = literatureFixture();
const pending = literatureFixture(ingredientFixture({}, { status: 'pending' }));
const missing = literatureFixture(
  ingredientFixture({ papers: [paperFixture({ takeaway: null })] }, { status: 'none' }),
);

describe('LiteratureApi', () => {
  it('calls the list, refresh, takeaways and hide endpoints', async () => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    const api = TestBed.inject(LiteratureApi);
    const http = TestBed.inject(HttpTestingController);

    const get = firstValueFrom(api.get(rxcui));
    http.expectOne('/api/drugs/314076/literature').flush(ready);
    expect(await get).toEqual(ready);

    const refresh = firstValueFrom(api.refresh(rxcui));
    const r = http.expectOne('/api/drugs/314076/literature/refresh');
    expect(r.request.method).toBe('POST');
    r.flush(ready);
    await refresh;

    const start = firstValueFrom(api.startTakeaways(rxcui));
    http.expectOne('/api/drugs/314076/literature/takeaways').flush(pending);
    expect(await start).toEqual(pending);

    const hide = firstValueFrom(api.hide('29046', '123'));
    const h = http.expectOne('/api/literature/29046/papers/123/hide');
    expect(h.request.method).toBe('POST');
    h.flush(null, { status: 204, statusText: 'No Content' });
    await hide;

    const unhide = firstValueFrom(api.unhide('29046', '123'));
    const u = http.expectOne('/api/literature/29046/papers/123/hide');
    expect(u.request.method).toBe('DELETE');
    u.flush(null, { status: 204, statusText: 'No Content' });
    await unhide;
    http.verify();
  });

  it('shows the server’s message for expected failures', () => {
    const error = (status: number, statusMessage?: string) =>
      new HttpErrorResponse({ status, error: statusMessage ? { statusMessage } : null });
    expect(literatureError(error(503, 'PubMed is unavailable right now. Try again later.'))).toBe(
      'PubMed is unavailable right now. Try again later.',
    );
    expect(literatureError(error(500, 'stack'))).toBe('Something went wrong. Please try again.');
  });
});

describe('literature reducer', () => {
  const opened = reducer(initialLiteratureState, LiteratureActions.openResearch({ rxcui }));
  const entry = (s: typeof opened) => selectLiterature(rxcui)({ literature: s });

  it('loads, and keeps stored lists visible when a later load or refresh fails', () => {
    expect(entry(opened)).toMatchObject({ status: 'loading', data: null });
    let s = reducer(opened, LiteratureActions.loadSuccess({ rxcui, data: ready }));
    expect(entry(s)).toMatchObject({ status: 'loaded', data: ready });
    s = reducer(s, LiteratureActions.refresh({ rxcui }));
    expect(entry(s)?.refreshing).toBe(true);
    s = reducer(s, LiteratureActions.refreshFailure({ rxcui, error: 'PubMed down' }));
    expect(entry(s)).toMatchObject({
      status: 'loaded',
      data: ready,
      refreshing: false,
      error: 'PubMed down',
    });

    const failed = reducer(opened, LiteratureActions.loadFailure({ rxcui, error: 'PubMed down' }));
    expect(entry(failed)).toMatchObject({ status: 'error', error: 'PubMed down' });
  });

  it('tracks takeaway starts, failures and timeouts', () => {
    let s = reducer(opened, LiteratureActions.startTakeaways({ rxcui }));
    expect(entry(s)?.starting).toBe(true);
    s = reducer(
      s,
      LiteratureActions.startTakeawaysFailure({ rxcui, error: 'AI takeaways unavailable: x' }),
    );
    expect(entry(s)).toMatchObject({ starting: false, startError: 'AI takeaways unavailable: x' });
    s = reducer(s, LiteratureActions.startTakeawaysSuccess({ rxcui, data: pending }));
    expect(entry(s)).toMatchObject({ starting: false, data: pending });
    s = reducer(s, LiteratureActions.pollTimeout({ rxcui }));
    expect(entry(s)?.timedOut).toBe(true);
  });

  it('hides and unhides at once, and rolls back on failure', () => {
    let s = reducer(opened, LiteratureActions.loadSuccess({ rxcui, data: ready }));
    s = reducer(s, LiteratureActions.hidePaper({ rxcui, ingredient: '29046', pmid: '37417783' }));
    let lit = entry(s)!.data!.ingredients[0];
    expect(lit.papers.map((p) => p.pmid)).toEqual(['10587334']);
    expect(lit.hidden.map((p) => p.pmid)).toEqual(['37417783']);

    s = reducer(s, LiteratureActions.hideFailure({ rxcui, error: 'Paper not found.' }));
    lit = entry(s)!.data!.ingredients[0];
    expect(lit.papers.map((p) => p.pmid)).toEqual(['37417783', '10587334']);
    expect(entry(s)).toMatchObject({ hideError: 'Paper not found.', beforeHide: null });

    s = reducer(s, LiteratureActions.hidePaper({ rxcui, ingredient: '29046', pmid: '37417783' }));
    s = reducer(s, LiteratureActions.unhidePaper({ rxcui, ingredient: '29046', pmid: '37417783' }));
    expect(entry(s)!.data!.ingredients[0].hidden).toEqual([]);
  });

  it('ignores late responses and resets on logout', () => {
    const late = reducer(
      initialLiteratureState,
      LiteratureActions.loadSuccess({ rxcui, data: ready }),
    );
    expect(late).toEqual(initialLiteratureState);
    expect(reducer(opened, AuthActions.logoutSuccess())).toEqual(initialLiteratureState);
  });
});

describe('literature effects', () => {
  let actions$: Subject<Action>;
  const api = {
    get: vi.fn<(rxcui: string) => Observable<LiteratureResponse>>(),
    refresh: vi.fn(),
    startTakeaways: vi.fn(),
    hide: vi.fn(),
    unhide: vi.fn(),
  };
  const setup = (platform = 'browser') => {
    actions$ = new Subject<Action>();
    vi.resetAllMocks();
    TestBed.configureTestingModule({
      providers: [
        provideMockActions(() => actions$),
        { provide: LiteratureApi, useValue: api },
        { provide: PLATFORM_ID, useValue: platform },
      ],
    });
  };
  const collect = (effect: () => Observable<Action>) => {
    const out: Action[] = [];
    TestBed.runInInjectionContext(effect).subscribe((a) => out.push(a));
    return out;
  };
  afterEach(() => vi.useRealTimers());

  it('loads the lists when Research opens', () => {
    setup();
    api.get.mockReturnValueOnce(of(ready));
    api.get.mockReturnValueOnce(
      throwError(
        () => new HttpErrorResponse({ status: 503, error: { statusMessage: 'PubMed down' } }),
      ),
    );
    const out = collect(effects.openResearch);
    actions$.next(LiteratureActions.openResearch({ rxcui }));
    actions$.next(LiteratureActions.openResearch({ rxcui }));
    expect(out).toEqual([
      LiteratureActions.loadSuccess({ rxcui, data: ready }),
      LiteratureActions.loadFailure({ rxcui, error: 'PubMed down' }),
    ]);
  });

  it('starts takeaways when shown papers lack one, but not after a failure or during SSR', () => {
    setup();
    let out = collect(effects.startMissingTakeaways);
    actions$.next(LiteratureActions.loadSuccess({ rxcui, data: missing }));
    actions$.next(LiteratureActions.loadSuccess({ rxcui, data: ready }));
    const failed = literatureFixture(
      ingredientFixture({ papers: [paperFixture({ takeaway: null })] }, { status: 'failed' }),
    );
    actions$.next(LiteratureActions.loadSuccess({ rxcui, data: failed }));
    expect(out).toEqual([LiteratureActions.startTakeaways({ rxcui })]);

    TestBed.resetTestingModule();
    setup('server');
    out = collect(effects.startMissingTakeaways);
    actions$.next(LiteratureActions.loadSuccess({ rxcui, data: missing }));
    expect(out).toEqual([]);
  });

  it('polls every 2 s while takeaways are pending and stops when done or on leave', async () => {
    vi.useFakeTimers();
    setup();
    api.get.mockReturnValueOnce(of(pending)).mockReturnValueOnce(of(ready));
    const out = collect(effects.pollTakeaways);
    actions$.next(LiteratureActions.startTakeawaysSuccess({ rxcui, data: pending }));
    await vi.advanceTimersByTimeAsync(4_000);
    expect(out).toEqual([
      LiteratureActions.pollSuccess({ rxcui, data: pending }),
      LiteratureActions.pollSuccess({ rxcui, data: ready }),
    ]);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(api.get).toHaveBeenCalledTimes(2);

    api.get.mockReturnValue(of(pending));
    actions$.next(LiteratureActions.loadSuccess({ rxcui, data: pending }));
    await vi.advanceTimersByTimeAsync(2_000);
    actions$.next(LiteratureActions.leaveResearch({ rxcui }));
    await vi.advanceTimersByTimeAsync(20_000);
    expect(api.get).toHaveBeenCalledTimes(3);
  });

  it('gives up after the maximum wait', async () => {
    vi.useFakeTimers();
    setup();
    api.get.mockReturnValue(of(pending));
    const out = collect(effects.pollTakeaways);
    actions$.next(LiteratureActions.loadSuccess({ rxcui, data: pending }));
    await vi.advanceTimersByTimeAsync(MAX_POLL_MS + 10_000);
    expect(api.get).toHaveBeenCalledTimes(MAX_POLL_MS / POLL_INTERVAL_MS);
    expect(out.at(-1)).toEqual(LiteratureActions.pollTimeout({ rxcui }));
  });

  it('hides a paper, then reloads so the next one moves up; failures roll back', () => {
    setup();
    api.hide.mockReturnValueOnce(of(undefined));
    api.get.mockReturnValueOnce(of(ready));
    api.unhide.mockReturnValueOnce(
      throwError(
        () => new HttpErrorResponse({ status: 404, error: { statusMessage: 'Paper not found.' } }),
      ),
    );
    const out = collect(effects.hidePaper);
    actions$.next(LiteratureActions.hidePaper({ rxcui, ingredient: '29046', pmid: '1' }));
    actions$.next(LiteratureActions.unhidePaper({ rxcui, ingredient: '29046', pmid: '1' }));
    expect(api.hide).toHaveBeenCalledWith('29046', '1');
    expect(out).toEqual([
      LiteratureActions.loadSuccess({ rxcui, data: ready }),
      LiteratureActions.hideFailure({ rxcui, error: 'Paper not found.' }),
    ]);
  });

  it('refreshes and starts takeaways through the API', () => {
    setup();
    api.refresh.mockReturnValue(of(ready));
    api.startTakeaways.mockReturnValue(of(pending));
    const refreshed = collect(effects.refresh);
    const started = collect(effects.startTakeaways);
    actions$.next(LiteratureActions.refresh({ rxcui }));
    actions$.next(LiteratureActions.startTakeaways({ rxcui }));
    expect(refreshed).toEqual([LiteratureActions.refreshSuccess({ rxcui, data: ready })]);
    expect(started).toEqual([LiteratureActions.startTakeawaysSuccess({ rxcui, data: pending })]);
  });
});
