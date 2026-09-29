import { TestBed } from '@angular/core/testing';
import { provideRouter, Router, RouterStateSnapshot, UrlTree } from '@angular/router';
import { MockStore, provideMockStore } from '@ngrx/store/testing';
import { firstValueFrom, isObservable, Observable, of } from 'rxjs';

import { AuthApi } from './auth-api.service';
import { AuthActions } from './auth.actions';
import { authGuard } from './auth.guard';
import { initialAuthState } from './auth.reducer';

describe('authGuard', () => {
  const api = { currentUser: vi.fn() };
  const alice = { id: 'u1', username: 'alice' };
  let store: MockStore;

  const runGuard = async (url: string) => {
    const result = TestBed.runInInjectionContext(() =>
      authGuard({} as never, { url } as RouterStateSnapshot),
    );
    return isObservable(result) ? firstValueFrom(result as Observable<unknown>) : result;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideMockStore({ initialState: { auth: initialAuthState } }),
        { provide: AuthApi, useValue: api },
      ],
    });
    store = TestBed.inject(MockStore);
    vi.spyOn(store, 'dispatch');
  });

  it('allows navigation without a request when the store is already authenticated', async () => {
    store.setState({ auth: { ...initialAuthState, status: 'authenticated' } });
    expect(await runGuard('/digest')).toBe(true);
    expect(api.currentUser).not.toHaveBeenCalled();
  });

  it('checks the session and allows a signed-in user', async () => {
    api.currentUser.mockReturnValue(of(alice));
    expect(await runGuard('/digest')).toBe(true);
    expect(store.dispatch).toHaveBeenCalledWith(AuthActions.sessionChecked({ user: alice }));
  });

  it('redirects a signed-out user to /login with the original URL', async () => {
    api.currentUser.mockReturnValue(of(null));
    const result = await runGuard('/medications?tab=all');
    const router = TestBed.inject(Router);
    expect(result).toBeInstanceOf(UrlTree);
    expect(router.serializeUrl(result as UrlTree)).toBe('/login?next=%2Fmedications%3Ftab%3Dall');
    expect(store.dispatch).toHaveBeenCalledWith(AuthActions.sessionChecked({ user: null }));
  });

  it('omits next for the home page', async () => {
    api.currentUser.mockReturnValue(of(null));
    const result = await runGuard('/');
    expect(TestBed.inject(Router).serializeUrl(result as UrlTree)).toBe('/login');
  });
});
