import { createFeature, createReducer, createSelector, on } from '@ngrx/store';

import { AuthActions } from './auth.actions';

export type AuthStatus = 'unknown' | 'authenticated' | 'anonymous';

export interface AuthState {
  status: AuthStatus;
  pending: boolean;
  error: string | null;
}

export const initialAuthState: AuthState = { status: 'unknown', pending: false, error: null };

export const authFeature = createFeature({
  name: 'auth',
  reducer: createReducer(
    initialAuthState,
    on(AuthActions.login, (state) => ({ ...state, pending: true, error: null })),
    on(AuthActions.loginSuccess, () => ({
      status: 'authenticated' as const,
      pending: false,
      error: null,
    })),
    on(AuthActions.loginFailure, (_, { error }) => ({
      status: 'anonymous' as const,
      pending: false,
      error,
    })),
    on(AuthActions.logoutSuccess, () => ({ ...initialAuthState, status: 'anonymous' as const })),
    on(AuthActions.sessionChecked, (state, { authenticated }) => ({
      ...state,
      status: authenticated ? ('authenticated' as const) : ('anonymous' as const),
    })),
  ),
  extraSelectors: ({ selectStatus }) => ({
    selectIsAuthenticated: createSelector(selectStatus, (status) => status === 'authenticated'),
  }),
});
