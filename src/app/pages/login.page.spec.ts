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

  const type = (el: HTMLElement, id: string, value: string) => {
    const input = el.querySelector<HTMLInputElement>(`input#${id}`);
    if (!input) throw new Error(`${id} input not found`);
    input.value = value;
    input.dispatchEvent(new Event('input'));
  };
  const submit = async (
    el: HTMLElement,
    fixture: { whenStable(): Promise<unknown> },
    password: string,
    username = 'alice',
  ) => {
    type(el, 'username', username);
    type(el, 'password', password);
    el.querySelector('form')?.dispatchEvent(new Event('submit'));
    await fixture.whenStable();
  };

  it('dispatches login with a sanitized redirect target', async () => {
    const { fixture, store, el } = await setup('/digest');
    await submit(el, fixture, 'my-password');
    expect(store.dispatch).toHaveBeenCalledWith(
      AuthActions.login({ username: 'alice', password: 'my-password', redirectTo: '/digest' }),
    );
  });

  it('ignores an off-site next parameter', async () => {
    const { fixture, store, el } = await setup('https://evil.example');
    await submit(el, fixture, 'my-password');
    expect(store.dispatch).toHaveBeenCalledWith(
      AuthActions.login({ username: 'alice', password: 'my-password', redirectTo: '/' }),
    );
  });

  it('does not submit without a username or a password', async () => {
    const { fixture, store, el } = await setup(null);
    await submit(el, fixture, '');
    await submit(el, fixture, 'my-password', '');
    expect(store.dispatch).not.toHaveBeenCalled();
  });

  it('asks for the username with sign-in autocomplete hints', async () => {
    const { el } = await setup(null);
    expect(el.querySelector('input#username')?.getAttribute('autocomplete')).toBe('username');
    expect(el.querySelector('input#password')?.getAttribute('autocomplete')).toBe(
      'current-password',
    );
  });

  it('shows the error from the store', async () => {
    const { el } = await setup(null, {
      ...initialAuthState,
      error: 'Invalid username or password.',
    });
    expect(el.textContent).toContain('Invalid username or password.');
  });
});
