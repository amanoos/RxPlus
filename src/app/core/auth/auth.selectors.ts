import { authFeature } from './auth.reducer';

export const {
  selectStatus: selectAuthStatus,
  selectPending: selectAuthPending,
  selectError: selectAuthError,
  selectIsAuthenticated,
} = authFeature;
