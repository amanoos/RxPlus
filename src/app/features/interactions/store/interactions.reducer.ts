import { createFeature, createReducer, createSelector, on } from '@ngrx/store';

import { AuthActions } from '../../../core/auth/auth.actions';
import type { InteractionReport, LabelEvidence } from '../interaction';
import { InteractionsActions } from './interactions.actions';

export type LoadStatus = 'idle' | 'loading' | 'loaded' | 'error';

export interface EvidenceEntry {
  status: LoadStatus;
  items: LabelEvidence[];
  error: string | null;
}

export interface InteractionsState {
  current: InteractionReport | null;
  currentStatus: LoadStatus;
  currentError: string | null;
  candidateRxcui: string | null;
  candidate: InteractionReport | null;
  candidateStatus: LoadStatus;
  candidateError: string | null;
  /** True once the server reported that no DDInter import exists. */
  noData: boolean;
  evidence: Record<string, EvidenceEntry>;
}

export const initialInteractionsState: InteractionsState = {
  current: null,
  currentStatus: 'idle',
  currentError: null,
  candidateRxcui: null,
  candidate: null,
  candidateStatus: 'idle',
  candidateError: null,
  noData: false,
  evidence: {},
};

export const interactionsFeature = createFeature({
  name: 'interactions',
  reducer: createReducer(
    initialInteractionsState,
    on(InteractionsActions.loadCurrent, (s) => ({
      ...s,
      currentStatus: 'loading' as const,
      currentError: null,
    })),
    on(InteractionsActions.loadCurrentSuccess, (s, { report }) => ({
      ...s,
      current: report,
      currentStatus: 'loaded' as const,
      noData: false,
    })),
    on(InteractionsActions.loadCurrentFailure, (s, { error, noData }) => ({
      ...s,
      currentStatus: 'error' as const,
      currentError: error,
      noData,
    })),
    on(InteractionsActions.checkCandidate, (s, { rxcui }) => ({
      ...s,
      candidateRxcui: rxcui,
      candidate: null,
      candidateStatus: 'loading' as const,
      candidateError: null,
    })),
    on(InteractionsActions.checkCandidateSuccess, (s, { rxcui, report }) =>
      rxcui === s.candidateRxcui
        ? { ...s, candidate: report, candidateStatus: 'loaded' as const, noData: false }
        : s,
    ),
    on(InteractionsActions.checkCandidateFailure, (s, { rxcui, error, noData }) =>
      rxcui === s.candidateRxcui
        ? {
            ...s,
            candidateStatus: 'error' as const,
            candidateError: error,
            noData: s.noData || noData,
          }
        : s,
    ),
    on(InteractionsActions.clearCandidate, (s) => ({
      ...s,
      candidateRxcui: null,
      candidate: null,
      candidateStatus: 'idle' as const,
      candidateError: null,
    })),
    on(InteractionsActions.loadEvidence, (s, { key }) => ({
      ...s,
      evidence: { ...s.evidence, [key]: { status: 'loading' as const, items: [], error: null } },
    })),
    on(InteractionsActions.loadEvidenceSuccess, (s, { key, items }) => ({
      ...s,
      evidence: { ...s.evidence, [key]: { status: 'loaded' as const, items, error: null } },
    })),
    on(InteractionsActions.loadEvidenceFailure, (s, { key, error }) => ({
      ...s,
      evidence: { ...s.evidence, [key]: { status: 'error' as const, items: [], error } },
    })),
    on(AuthActions.logoutSuccess, () => initialInteractionsState),
  ),
  extraSelectors: ({ selectCurrent }) => ({
    selectCurrentMajorCount: createSelector(
      selectCurrent,
      (report) => report?.results.filter((r) => r.level === 'Major').length ?? 0,
    ),
  }),
});

export const selectEvidenceFor = (key: string) =>
  createSelector(interactionsFeature.selectEvidence, (evidence) => evidence[key] ?? null);
