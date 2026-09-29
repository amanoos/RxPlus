import { createFeature, createReducer, createSelector, on } from '@ngrx/store';

import type { AuthUser } from './auth-api.service';
import { AuthActions } from './auth.actions';

export type AuthStatus = 'unknown' | 'authenticated' | 'anonymous';

export interface AuthState {
  status: AuthStatus;
  /** Who is signed in; null when nobody is (or not yet known). */
  user: AuthUser | null;
  pending: boolean;
  error: string | null;
}

export const initialAuthState: AuthState = {
  status: 'unknown',
  user: null,
  pending: false,
  error: null,
};

export const authFeature = createFeature({
  name: 'auth',
  reducer: createReducer(
    initialAuthState,
    on(AuthActions.login, (state) => ({ ...state, pending: true, error: null })),
    on(AuthActions.loginSuccess, (_, { user }) => ({
      status: 'authenticated' as const,
      user,
      pending: false,
      error: null,
    })),
    on(AuthActions.loginFailure, (_, { error }) => ({
      status: 'anonymous' as const,
      user: null,
      pending: false,
      error,
    })),
    on(AuthActions.logoutSuccess, () => ({ ...initialAuthState, status: 'anonymous' as const })),
    on(AuthActions.sessionChecked, (state, { user }) => ({
      ...state,
      status: user ? ('authenticated' as const) : ('anonymous' as const),
      user,
    })),
  ),
  extraSelectors: ({ selectStatus }) => ({
    selectIsAuthenticated: createSelector(selectStatus, (status) => status === 'authenticated'),
  }),
});
