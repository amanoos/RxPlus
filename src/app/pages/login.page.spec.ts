import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap } from '@angular/router';
import { MockStore, provideMockStore } from '@ngrx/store/testing';
import { providePrimeNG } from 'primeng/config';

import { AuthActions } from '../core/auth/auth.actions';
import { AuthState, initialAuthState } from '../core/auth/auth.reducer';
import LoginPage from './login.page';

describe('LoginPage', () => {
  const setup = async (next: string | null, auth: AuthState = initialAuthState) => {
    await TestBed.configureTestingModule({
      imports: [LoginPage],
      providers: [
        providePrimeNG(),
        provideMockStore({ initialState: { auth } }),
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { queryParamMap: convertToParamMap(next ? { next } : {}) } },
        },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(LoginPage);
    const store = TestBed.inject(MockStore);
    vi.spyOn(store, 'dispatch');
    await fixture.whenStable();
    return { fixture, store, el: fixture.nativeElement as HTMLElement };
  };

  const submit = async (
    el: HTMLElement,
    fixture: { whenStable(): Promise<unknown> },
    password: string,
  ) => {
    const input = el.querySelector<HTMLInputElement>('input#password');
    if (!input) throw new Error('password input not found');
    input.value = password;
    input.dispatchEvent(new Event('input'));
    el.querySelector('form')?.dispatchEvent(new Event('submit'));
    await fixture.whenStable();
  };

  it('dispatches login with a sanitized redirect target', async () => {
    const { fixture, store, el } = await setup('/digest');
    await submit(el, fixture, 'my-password');
    expect(store.dispatch).toHaveBeenCalledWith(
      AuthActions.login({ password: 'my-password', redirectTo: '/digest' }),
    );
  });

  it('ignores an off-site next parameter', async () => {
    const { fixture, store, el } = await setup('https://evil.example');
    await submit(el, fixture, 'my-password');
    expect(store.dispatch).toHaveBeenCalledWith(
      AuthActions.login({ password: 'my-password', redirectTo: '/' }),
    );
  });

  it('does not submit an empty password', async () => {
    const { fixture, store, el } = await setup(null);
    await submit(el, fixture, '');
    expect(store.dispatch).not.toHaveBeenCalled();
  });

  it('shows the error from the store', async () => {
    const { el } = await setup(null, { ...initialAuthState, error: 'Incorrect password.' });
    expect(el.textContent).toContain('Incorrect password.');
  });
});
