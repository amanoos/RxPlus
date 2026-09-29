import { authFeature } from './auth.reducer';

export const {
  selectStatus: selectAuthStatus,
  selectUser: selectAuthUser,
  selectPending: selectAuthPending,
  selectError: selectAuthError,
  selectIsAuthenticated,
} = authFeature;
