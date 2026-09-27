import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { Store } from '@ngrx/store';
import { map, of, switchMap, take, tap } from 'rxjs';

import { AuthApi } from './auth-api.service';
import { AuthActions } from './auth.actions';
import { selectAuthStatus } from './auth.selectors';

/**
 * Guards the authenticated `(app)` layout, on the server (SSR, with the request
 * cookie forwarded by forwardCookieInterceptor) and in the browser.
 */
export const authGuard: CanActivateFn = (_route, state) => {
  const store = inject(Store);
  const api = inject(AuthApi);
  const router = inject(Router);
  const toLogin = () =>
    state.url === '/'
      ? router.createUrlTree(['/login'])
      : router.createUrlTree(['/login'], { queryParams: { next: state.url } });

  return store.select(selectAuthStatus).pipe(
    take(1),
    switchMap((status) =>
      status === 'authenticated'
        ? of(true)
        : api.isAuthenticated().pipe(
            tap((authenticated) => store.dispatch(AuthActions.sessionChecked({ authenticated }))),
            map((authenticated) => authenticated || toLogin()),
          ),
    ),
  );
};
