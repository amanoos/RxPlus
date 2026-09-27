import { HttpErrorResponse } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { catchError, EMPTY, exhaustMap, map, of, tap } from 'rxjs';

import { AuthApi } from './auth-api.service';
import { AuthActions } from './auth.actions';

function loginErrorMessage(error: unknown): string {
  const status = error instanceof HttpErrorResponse ? error.status : 0;
  if (status === 401) return 'Incorrect password.';
  if (status === 429) return 'Too many attempts. Try again in 15 minutes.';
  return 'Sign-in failed. Please try again.';
}

export const login = createEffect(
  (actions$ = inject(Actions), api = inject(AuthApi)) =>
    actions$.pipe(
      ofType(AuthActions.login),
      exhaustMap(({ password, redirectTo }) =>
        api.login(password).pipe(
          map(() => AuthActions.loginSuccess({ redirectTo })),
          catchError((error: unknown) =>
            of(AuthActions.loginFailure({ error: loginErrorMessage(error) })),
          ),
        ),
      ),
    ),
  { functional: true },
);

export const navigateAfterLogin = createEffect(
  (actions$ = inject(Actions), router = inject(Router)) =>
    actions$.pipe(
      ofType(AuthActions.loginSuccess),
      tap(({ redirectTo }) => router.navigateByUrl(redirectTo)),
    ),
  { functional: true, dispatch: false },
);

export const logout = createEffect(
  (actions$ = inject(Actions), api = inject(AuthApi)) =>
    actions$.pipe(
      ofType(AuthActions.logout),
      exhaustMap(() =>
        api.logout().pipe(
          map(() => AuthActions.logoutSuccess()),
          // The session is still valid if logout failed: stay put rather than pretend.
          catchError(() => EMPTY),
        ),
      ),
    ),
  { functional: true },
);

export const navigateAfterLogout = createEffect(
  (actions$ = inject(Actions), router = inject(Router)) =>
    actions$.pipe(
      ofType(AuthActions.logoutSuccess),
      tap(() => router.navigateByUrl('/login')),
    ),
  { functional: true, dispatch: false },
);
