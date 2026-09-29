import { AuthActions } from './auth.actions';
import { authFeature, initialAuthState } from './auth.reducer';

const { reducer } = authFeature;
const alice = { id: 'u1', username: 'alice' };

describe('auth reducer', () => {
  it('starts with an unknown session', () => {
    expect(reducer(undefined, { type: '@@init' })).toEqual(initialAuthState);
    expect(initialAuthState).toEqual({
      status: 'unknown',
      user: null,
      pending: false,
      error: null,
    });
  });

  it('marks a login as pending and clears the previous error', () => {
    const state = reducer(
      { ...initialAuthState, error: 'old' },
      AuthActions.login({ username: 'alice', password: 'x', redirectTo: '/' }),
    );
    expect(state).toEqual({ status: 'unknown', user: null, pending: true, error: null });
  });

  it('becomes authenticated as the user on success', () => {
    const state = reducer(
      { ...initialAuthState, pending: true },
      AuthActions.loginSuccess({ user: alice, redirectTo: '/' }),
    );
    expect(state).toEqual({ status: 'authenticated', user: alice, pending: false, error: null });
  });

  it('becomes anonymous with an error on failure', () => {
    const state = reducer(
      { ...initialAuthState, pending: true },
      AuthActions.loginFailure({ error: 'Invalid username or password.' }),
    );
    expect(state).toEqual({
      status: 'anonymous',
      user: null,
      pending: false,
      error: 'Invalid username or password.',
    });
  });

  it('becomes anonymous and forgets the user after logout', () => {
    const state = reducer(
      { ...initialAuthState, status: 'authenticated', user: alice },
      AuthActions.logoutSuccess(),
    );
    expect(state.status).toBe('anonymous');
    expect(state.user).toBeNull();
  });

  it('records the result of a session check', () => {
    expect(reducer(initialAuthState, AuthActions.sessionChecked({ user: alice }))).toMatchObject({
      status: 'authenticated',
      user: alice,
    });
    expect(reducer(initialAuthState, AuthActions.sessionChecked({ user: null }))).toMatchObject({
      status: 'anonymous',
      user: null,
    });
  });

  it('exposes selectors', () => {
    const state = {
      auth: { status: 'authenticated' as const, user: alice, pending: false, error: 'e' },
    };
    expect(authFeature.selectStatus(state)).toBe('authenticated');
    expect(authFeature.selectUser(state)).toEqual(alice);
    expect(authFeature.selectError(state)).toBe('e');
    expect(authFeature.selectIsAuthenticated(state)).toBe(true);
  });
});
