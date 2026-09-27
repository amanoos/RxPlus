import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { provideMockActions } from '@ngrx/effects/testing';
import { Action } from '@ngrx/store';
import { provideMockStore } from '@ngrx/store/testing';
import { firstValueFrom, of, Subject, throwError, toArray, take } from 'rxjs';

import { AuthActions } from '../../../core/auth/auth.actions';
import { medicationFixture } from '../../medications/medication.fixture';
import { MedicationsActions } from '../../medications/store/medications.actions';
import { evidenceQuery, pairKey } from '../interaction';
import { reportFixture, resultFixture } from '../interaction.fixture';
import { InteractionsApi, toFailure } from '../interactions-api.service';
import { InteractionsActions } from './interactions.actions';
import * as effects from './interactions.effects';
import {
  initialInteractionsState,
  interactionsFeature,
  selectEvidenceFor,
} from './interactions.reducer';

const { reducer } = interactionsFeature;
const report = reportFixture();
const key = pairKey(resultFixture());

describe('interactions reducer and selectors', () => {
  it('tracks the current report and counts Major interactions', () => {
    let s = reducer(initialInteractionsState, InteractionsActions.loadCurrent());
    expect(s.currentStatus).toBe('loading');
    s = reducer(s, InteractionsActions.loadCurrentSuccess({ report }));
    expect(s).toMatchObject({ current: report, currentStatus: 'loaded', noData: false });
    expect(interactionsFeature.selectCurrentMajorCount({ interactions: s })).toBe(1);
  });

  it('records the no-data state', () => {
    const s = reducer(
      initialInteractionsState,
      InteractionsActions.loadCurrentFailure({ error: 'x', noData: true }),
    );
    expect(s).toMatchObject({ currentStatus: 'error', noData: true });
  });

  it('ignores a stale candidate response', () => {
    let s = reducer(initialInteractionsState, InteractionsActions.checkCandidate({ rxcui: '1' }));
    s = reducer(s, InteractionsActions.checkCandidate({ rxcui: '2' }));
    s = reducer(s, InteractionsActions.checkCandidateSuccess({ rxcui: '1', report }));
    expect(s).toMatchObject({ candidateRxcui: '2', candidate: null, candidateStatus: 'loading' });
    s = reducer(s, InteractionsActions.checkCandidateSuccess({ rxcui: '2', report }));
    expect(s.candidate).toEqual(report);
    s = reducer(s, InteractionsActions.clearCandidate());
    expect(s).toMatchObject({ candidateRxcui: null, candidate: null, candidateStatus: 'idle' });
  });

  it('stores evidence per pair and resets on logout', () => {
    let s = reducer(
      initialInteractionsState,
      InteractionsActions.loadEvidence({ key, query: evidenceQuery(resultFixture()) }),
    );
    expect(selectEvidenceFor(key)({ interactions: s })?.status).toBe('loading');
    s = reducer(s, InteractionsActions.loadEvidenceSuccess({ key, items: [] }));
    expect(selectEvidenceFor(key)({ interactions: s })?.status).toBe('loaded');
    expect(reducer(s, AuthActions.logoutSuccess())).toEqual(initialInteractionsState);
  });
});

describe('toFailure', () => {
  it('recognizes no-data, outages and unknown errors', () => {
    expect(
      toFailure(new HttpErrorResponse({ status: 409, error: { data: { code: 'no-data' } } })),
    ).toEqual({ error: 'Interaction data has not been imported yet.', noData: true });
    expect(
      toFailure(
        new HttpErrorResponse({
          status: 503,
          error: { statusMessage: 'FDA label text is unavailable right now.' },
        }),
      ).error,
    ).toBe('FDA label text is unavailable right now.');
    expect(toFailure(new Error('x')).noData).toBe(false);
  });
});

describe('interactions effects', () => {
  let actions$: Subject<Action>;
  const api = { current: vi.fn(), check: vi.fn(), evidence: vi.fn() };
  const run = <T>(effect: () => T) => TestBed.runInInjectionContext(effect);

  const setup = (evidence = {}) => {
    actions$ = new Subject<Action>();
    vi.resetAllMocks();
    TestBed.configureTestingModule({
      providers: [
        provideMockActions(() => actions$),
        provideMockStore({
          initialState: { interactions: { ...initialInteractionsState, evidence } },
        }),
        { provide: InteractionsApi, useValue: api },
      ],
    });
  };

  it('reloads the current report whenever medications change', async () => {
    setup();
    const out = firstValueFrom(run(() => effects.refreshCurrent()).pipe(take(4), toArray()));
    actions$.next(MedicationsActions.loadSuccess({ medications: [] }));
    actions$.next(MedicationsActions.addSuccess({ medication: medicationFixture() }));
    actions$.next(MedicationsActions.updateSuccess({ medication: medicationFixture() }));
    actions$.next(MedicationsActions.removeSuccess({ id: 'x' }));
    expect(await out).toEqual(Array(4).fill(InteractionsActions.loadCurrent()));
  });

  it('loads the current report and maps no-data', async () => {
    setup();
    api.current.mockReturnValueOnce(of(report));
    const ok = firstValueFrom(run(() => effects.loadCurrent()));
    actions$.next(InteractionsActions.loadCurrent());
    expect(await ok).toEqual(InteractionsActions.loadCurrentSuccess({ report }));

    api.current.mockReturnValueOnce(
      throwError(
        () => new HttpErrorResponse({ status: 409, error: { data: { code: 'no-data' } } }),
      ),
    );
    const failed = firstValueFrom(run(() => effects.loadCurrent()));
    actions$.next(InteractionsActions.loadCurrent());
    expect(await failed).toMatchObject({ noData: true });
  });

  it('checks a candidate', async () => {
    setup();
    api.check.mockReturnValue(of(report));
    const out = firstValueFrom(run(() => effects.checkCandidate()));
    actions$.next(InteractionsActions.checkCandidate({ rxcui: '313096' }));
    expect(await out).toEqual(
      InteractionsActions.checkCandidateSuccess({ rxcui: '313096', report }),
    );
    expect(api.check).toHaveBeenCalledWith('313096');
  });

  it('fetches evidence once per pair', async () => {
    const query = evidenceQuery(resultFixture());
    setup({ [key]: { status: 'loaded', items: [], error: null } });
    const skipped = run(() => effects.loadEvidence());
    const seen: Action[] = [];
    const sub = skipped.subscribe((a) => seen.push(a));
    actions$.next(InteractionsActions.loadEvidence({ key, query }));
    sub.unsubscribe();
    expect(seen).toEqual([]);
    expect(api.evidence).not.toHaveBeenCalled();
  });

  it('loads evidence for a new pair', async () => {
    const query = evidenceQuery(resultFixture());
    setup();
    api.evidence.mockReturnValue(of([{ label: 'x', sentences: ['s'] }]));
    const out = firstValueFrom(run(() => effects.loadEvidence()));
    actions$.next(InteractionsActions.loadEvidence({ key, query }));
    expect(await out).toEqual(
      InteractionsActions.loadEvidenceSuccess({ key, items: [{ label: 'x', sentences: ['s'] }] }),
    );
    expect(api.evidence).toHaveBeenCalledWith(query);
  });
});
