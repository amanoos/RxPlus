import { HttpErrorResponse } from '@angular/common/http';
import { PLATFORM_ID } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideMockActions } from '@ngrx/effects/testing';
import { Action } from '@ngrx/store';
import { of, Subject, throwError, type Observable } from 'rxjs';

import { AuthActions } from '../../../core/auth/auth.actions';
import { MAX_POLL_MS, POLL_INTERVAL_MS, type DrugSummary } from '../drug-info';
import { DrugInfoApi } from '../drug-info-api.service';
import { factsFixture, summaryFixture } from '../drug-info.fixture';
import { DrugInfoActions } from './drug-info.actions';
import * as effects from './drug-info.effects';
import { drugInfoFeature, initialDrugInfoState, selectDrugInfo } from './drug-info.reducer';

const { reducer } = drugInfoFeature;
const rxcui = '314076';
const pending = summaryFixture({ status: 'pending', sections: null, completedAt: null });
const ready = summaryFixture();

describe('drugInfo reducer and selectors', () => {
  const opened = reducer(initialDrugInfoState, DrugInfoActions.openDrug({ rxcui }));
  const entry = (s: typeof opened) => selectDrugInfo(rxcui)({ drugInfo: s });

  it('creates a loading entry per drug and fills it in', () => {
    expect(entry(opened)).toMatchObject({
      facts: { status: 'loading' },
      reactions: { status: 'loading' },
      summary: { status: 'loading' },
    });
    let s = reducer(opened, DrugInfoActions.loadFactsSuccess({ rxcui, facts: factsFixture() }));
    s = reducer(s, DrugInfoActions.loadReactionsFailure({ rxcui, error: 'FAERS down' }));
    s = reducer(s, DrugInfoActions.loadSummarySuccess({ rxcui, summary: null }));
    expect(entry(s)).toMatchObject({
      facts: { status: 'loaded', data: { name: 'lisinopril 10 MG Oral Tablet' } },
      reactions: { status: 'error', error: 'FAERS down' },
      summary: { status: 'none', data: null },
    });
    expect(selectDrugInfo('1')({ drugInfo: s })).toBeNull();
  });

  it('keeps loaded data visible while reopening', () => {
    let s = reducer(opened, DrugInfoActions.loadFactsSuccess({ rxcui, facts: factsFixture() }));
    s = reducer(s, DrugInfoActions.openDrug({ rxcui }));
    expect(entry(s)?.facts).toMatchObject({ status: 'loading', data: { rxcui } });
  });

  it('tracks starting, pending, ready and timed-out summaries', () => {
    let s = reducer(opened, DrugInfoActions.startSummary({ rxcui }));
    expect(entry(s)?.summary.starting).toBe(true);
    s = reducer(s, DrugInfoActions.startSummarySuccess({ rxcui, summary: pending }));
    expect(entry(s)?.summary).toMatchObject({ status: 'pending', starting: false });
    s = reducer(s, DrugInfoActions.pollSummaryTimeout({ rxcui }));
    expect(entry(s)?.summary.timedOut).toBe(true);
    s = reducer(s, DrugInfoActions.pollSummarySuccess({ rxcui, summary: ready }));
    expect(entry(s)?.summary).toMatchObject({ status: 'ready', data: ready });
  });

  it('shows why a summary could not start, keeping any stored one', () => {
    let s = reducer(opened, DrugInfoActions.loadSummarySuccess({ rxcui, summary: ready }));
    s = reducer(s, DrugInfoActions.startSummary({ rxcui }));
    s = reducer(s, DrugInfoActions.startSummaryFailure({ rxcui, error: 'AI summary unavailable' }));
    expect(entry(s)?.summary).toMatchObject({
      status: 'ready',
      data: ready,
      starting: false,
      error: 'AI summary unavailable',
    });
  });

  it('ignores responses for drugs no longer in the store and resets on logout', () => {
    const late = reducer(
      initialDrugInfoState,
      DrugInfoActions.loadFactsSuccess({ rxcui, facts: factsFixture() }),
    );
    expect(late).toEqual(initialDrugInfoState);
    expect(reducer(opened, AuthActions.logoutSuccess())).toEqual(initialDrugInfoState);
  });
});

describe('drugInfo effects', () => {
  let actions$: Subject<Action>;
  const api = {
    facts: vi.fn(),
    reportedReactions: vi.fn(),
    summary: vi.fn<(rxcui: string) => Observable<DrugSummary | null>>(),
    startSummary: vi.fn(),
  };

  const setup = (platform = 'browser') => {
    actions$ = new Subject<Action>();
    vi.resetAllMocks();
    TestBed.configureTestingModule({
      providers: [
        provideMockActions(() => actions$),
        { provide: DrugInfoApi, useValue: api },
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

  it('loads facts, reactions and the summary when a drug opens', () => {
    setup();
    api.facts.mockReturnValue(of(factsFixture()));
    api.reportedReactions.mockReturnValue(
      throwError(
        () => new HttpErrorResponse({ status: 503, error: { statusMessage: 'FAERS down' } }),
      ),
    );
    api.summary.mockReturnValue(of(null));
    const out = collect(effects.openDrug);
    actions$.next(DrugInfoActions.openDrug({ rxcui }));
    expect(out).toEqual([
      DrugInfoActions.loadFactsSuccess({ rxcui, facts: factsFixture() }),
      DrugInfoActions.loadReactionsFailure({ rxcui, error: 'FAERS down' }),
      DrugInfoActions.loadSummarySuccess({ rxcui, summary: null }),
    ]);
  });

  it('starts a summary and reports failures with the server’s reason', () => {
    setup();
    api.startSummary.mockReturnValueOnce(of(pending));
    api.startSummary.mockReturnValueOnce(
      throwError(
        () =>
          new HttpErrorResponse({
            status: 503,
            error: { statusMessage: 'AI summary unavailable: Ollama is unreachable.' },
          }),
      ),
    );
    const out = collect(effects.startSummary);
    actions$.next(DrugInfoActions.startSummary({ rxcui }));
    actions$.next(DrugInfoActions.startSummary({ rxcui }));
    expect(out).toEqual([
      DrugInfoActions.startSummarySuccess({ rxcui, summary: pending }),
      DrugInfoActions.startSummaryFailure({
        rxcui,
        error: 'AI summary unavailable: Ollama is unreachable.',
      }),
    ]);
  });

  it('polls every 2 s while pending and stops when the summary settles', async () => {
    vi.useFakeTimers();
    setup();
    api.summary
      .mockReturnValueOnce(of(pending))
      .mockReturnValueOnce(throwError(() => new Error('blip')))
      .mockReturnValueOnce(of(ready));
    const out = collect(effects.pollSummary);
    actions$.next(DrugInfoActions.startSummarySuccess({ rxcui, summary: pending }));

    await vi.advanceTimersByTimeAsync(2_000);
    expect(out).toEqual([DrugInfoActions.pollSummarySuccess({ rxcui, summary: pending })]);
    await vi.advanceTimersByTimeAsync(4_000);
    expect(out).toEqual([
      DrugInfoActions.pollSummarySuccess({ rxcui, summary: pending }),
      DrugInfoActions.pollSummarySuccess({ rxcui, summary: ready }),
    ]);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(api.summary).toHaveBeenCalledTimes(3);
  });

  it('gives up after the maximum wait and says so', async () => {
    vi.useFakeTimers();
    setup();
    api.summary.mockReturnValue(of(pending));
    const out = collect(effects.pollSummary);
    actions$.next(DrugInfoActions.loadSummarySuccess({ rxcui, summary: pending }));
    await vi.advanceTimersByTimeAsync(MAX_POLL_MS + 10_000);
    expect(api.summary).toHaveBeenCalledTimes(MAX_POLL_MS / POLL_INTERVAL_MS);
    expect(out.at(-1)).toEqual(DrugInfoActions.pollSummaryTimeout({ rxcui }));
  });

  it('stops polling when the page is left', async () => {
    vi.useFakeTimers();
    setup();
    api.summary.mockReturnValue(of(pending));
    const out = collect(effects.pollSummary);
    actions$.next(DrugInfoActions.loadSummarySuccess({ rxcui, summary: pending }));
    await vi.advanceTimersByTimeAsync(2_000);
    actions$.next(DrugInfoActions.leaveDrug({ rxcui }));
    await vi.advanceTimersByTimeAsync(60_000);
    expect(api.summary).toHaveBeenCalledTimes(1);
    expect(out).toHaveLength(1);
  });

  it('does not poll for ready summaries or during server rendering', async () => {
    vi.useFakeTimers();
    setup('server');
    const out = collect(effects.pollSummary);
    actions$.next(DrugInfoActions.loadSummarySuccess({ rxcui, summary: pending }));
    actions$.next(DrugInfoActions.loadSummarySuccess({ rxcui, summary: ready }));
    await vi.advanceTimersByTimeAsync(10_000);
    expect(api.summary).not.toHaveBeenCalled();
    expect(out).toEqual([]);
  });
});
