import { createFeature, createReducer, createSelector, on } from '@ngrx/store';

import { AuthActions } from '../../../core/auth/auth.actions';
import type { DigestsResponse } from '../digest';
import { DigestActions } from './digest.actions';

export interface DigestState {
  status: 'idle' | 'loading' | 'loaded' | 'error';
  data: DigestsResponse | null;
  error: string | null;
  /** "Run now" was pressed and the server hasn't answered yet. */
  starting: boolean;
  /** Polling stopped after 30 minutes with the run still going. */
  timedOut: boolean;
  /** Unread items, for the navigation badge (null until known). */
  unread: number | null;
}

export const initialDigestState: DigestState = {
  status: 'idle',
  data: null,
  error: null,
  starting: false,
  timedOut: false,
  unread: null,
};

export const digestFeature = createFeature({
  name: 'digest',
  reducer: createReducer(
    initialDigestState,
    on(DigestActions.open, (state) => ({
      ...state,
      status: state.data ? state.status : ('loading' as const),
      timedOut: false,
    })),
    on(DigestActions.loadSuccess, DigestActions.pollSuccess, (state, { data }) => ({
      ...state,
      status: 'loaded' as const,
      data,
      error: null,
    })),
    on(DigestActions.loadFailure, (state, { error }) => ({
      ...state,
      status: state.data ? state.status : ('error' as const),
      error,
      starting: false,
    })),
    on(DigestActions.run, (state) => ({ ...state, starting: true, error: null, timedOut: false })),
    on(DigestActions.runStarted, (state, { running }) => ({
      ...state,
      starting: false,
      data: state.data ? { ...state.data, running } : state.data,
    })),
    on(DigestActions.runFailure, (state, { error }) => ({ ...state, starting: false, error })),
    on(DigestActions.pollTimeout, (state) => ({ ...state, timedOut: true })),
    on(DigestActions.unreadLoaded, (state, { count }) => ({ ...state, unread: count })),
    on(AuthActions.logoutSuccess, () => initialDigestState),
  ),
  extraSelectors: ({ selectData }) => ({
    selectRunning: createSelector(selectData, (data) => data?.running ?? null),
  }),
});
