import { AuthActions } from './auth.actions';
import { authFeature, initialAuthState } from './auth.reducer';

const { reducer } = authFeature;

describe('auth reducer', () => {
  it('starts with an unknown session', () => {
    expect(reducer(undefined, { type: '@@init' })).toEqual(initialAuthState);
    expect(initialAuthState).toEqual({ status: 'unknown', pending: false, error: null });
  });

  it('marks a login as pending and clears the previous error', () => {
    const state = reducer(
      { ...initialAuthState, error: 'old' },
      AuthActions.login({ password: 'x', redirectTo: '/' }),
    );
    expect(state).toEqual({ status: 'unknown', pending: true, error: null });
  });

  it('becomes authenticated on success', () => {
    const state = reducer(
      { ...initialAuthState, pending: true },
      AuthActions.loginSuccess({ redirectTo: '/' }),
    );
    expect(state).toEqual({ status: 'authenticated', pending: false, error: null });
  });

  it('becomes anonymous with an error on failure', () => {
    const state = reducer(
      { ...initialAuthState, pending: true },
      AuthActions.loginFailure({ error: 'Incorrect password.' }),
    );
    expect(state).toEqual({ status: 'anonymous', pending: false, error: 'Incorrect password.' });
  });

  it('becomes anonymous after logout', () => {
    const state = reducer(
      { ...initialAuthState, status: 'authenticated' },
      AuthActions.logoutSuccess(),
    );
    expect(state.status).toBe('anonymous');
  });

  it('records the result of a session check', () => {
    expect(
      reducer(initialAuthState, AuthActions.sessionChecked({ authenticated: true })).status,
    ).toBe('authenticated');
    expect(
      reducer(initialAuthState, AuthActions.sessionChecked({ authenticated: false })).status,
    ).toBe('anonymous');
  });

  it('exposes selectors', () => {
    const state = { auth: { status: 'authenticated' as const, pending: false, error: 'e' } };
    expect(authFeature.selectStatus(state)).toBe('authenticated');
    expect(authFeature.selectError(state)).toBe('e');
    expect(authFeature.selectIsAuthenticated(state)).toBe(true);
  });
});
