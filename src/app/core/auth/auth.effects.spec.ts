import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { provideMockActions } from '@ngrx/effects/testing';
import { Action } from '@ngrx/store';
import { firstValueFrom, of, Subject, throwError } from 'rxjs';

import { AuthApi } from './auth-api.service';
import { AuthActions } from './auth.actions';
import * as effects from './auth.effects';

describe('auth effects', () => {
  let actions$: Subject<Action>;
  const api = { login: vi.fn(), logout: vi.fn(), currentUser: vi.fn() };
  const alice = { id: 'u1', username: 'alice' };
  const router = { navigateByUrl: vi.fn().mockResolvedValue(true) };

  beforeEach(() => {
    actions$ = new Subject<Action>();
    vi.clearAllMocks();
    TestBed.configureTestingModule({
      providers: [
        provideMockActions(() => actions$),
        { provide: AuthApi, useValue: api },
        { provide: Router, useValue: router },
      ],
    });
  });

  const run = <T>(effect: () => T) => TestBed.runInInjectionContext(effect);
  const httpError = (status: number) => throwError(() => new HttpErrorResponse({ status }));

  it('logs in and reports success with the signed-in user', async () => {
    api.login.mockReturnValue(of(null));
    api.currentUser.mockReturnValue(of(alice));
    const result = firstValueFrom(run(() => effects.login()));
    actions$.next(AuthActions.login({ username: 'alice', password: 'pw', redirectTo: '/digest' }));
    expect(await result).toEqual(AuthActions.loginSuccess({ user: alice, redirectTo: '/digest' }));
    expect(api.login).toHaveBeenCalledWith('alice', 'pw');
  });

  it('fails when the new session has no user', async () => {
    api.login.mockReturnValue(of(null));
    api.currentUser.mockReturnValue(of(null));
    const result = firstValueFrom(run(() => effects.login()));
    actions$.next(AuthActions.login({ username: 'alice', password: 'pw', redirectTo: '/' }));
    expect(await result).toEqual(
      AuthActions.loginFailure({ error: 'Sign-in failed. Please try again.' }),
    );
  });

  it.each([
    [401, 'Invalid username or password.'],
    [429, 'Too many attempts. Try again in 15 minutes.'],
    [500, 'Sign-in failed. Please try again.'],
    [0, 'Sign-in failed. Please try again.'],
  ])('maps HTTP %i to a user-facing message', async (status, error) => {
    api.login.mockReturnValue(httpError(status));
    const result = firstValueFrom(run(() => effects.login()));
    actions$.next(AuthActions.login({ username: 'alice', password: 'pw', redirectTo: '/' }));
    expect(await result).toEqual(AuthActions.loginFailure({ error }));
  });

  it('navigates to the redirect target after login', async () => {
    const done = firstValueFrom(run(() => effects.navigateAfterLogin()));
    actions$.next(AuthActions.loginSuccess({ user: alice, redirectTo: '/digest' }));
    await done;
    expect(router.navigateByUrl).toHaveBeenCalledWith('/digest');
  });

  it('logs out and navigates to /login', async () => {
    api.logout.mockReturnValue(of(null));
    const result = firstValueFrom(run(() => effects.logout()));
    actions$.next(AuthActions.logout());
    expect(await result).toEqual(AuthActions.logoutSuccess());

    const done = firstValueFrom(run(() => effects.navigateAfterLogout()));
    actions$.next(AuthActions.logoutSuccess());
    await done;
    expect(router.navigateByUrl).toHaveBeenCalledWith('/login');
  });
});
