import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { MockStore, provideMockStore } from '@ngrx/store/testing';
import { providePrimeNG } from 'primeng/config';

import { AuthActions } from '../auth/auth.actions';
import { initialDigestState } from '../../features/digest/store/digest.reducer';
import { initialAuthState } from '../auth/auth.reducer';
import { AppShellComponent, NAV_ITEMS } from './app-shell.component';

describe('AppShellComponent', () => {
  const setup = async (unread: number | null = null) => {
    await TestBed.configureTestingModule({
      imports: [AppShellComponent],
      providers: [
        providePrimeNG(),
        provideRouter([]),
        provideMockStore({
          initialState: { auth: initialAuthState, digest: { ...initialDigestState, unread } },
        }),
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(AppShellComponent);
    const store = TestBed.inject(MockStore);
    vi.spyOn(store, 'dispatch');
    await fixture.whenStable();
    return { fixture, store, el: fixture.nativeElement as HTMLElement };
  };

  it('links to every section from the main navigation', async () => {
    const { el } = await setup();
    const nav = el.querySelector('nav[aria-label="Main"]');
    const links = [...(nav?.querySelectorAll('a') ?? [])].map((a) => [
      a.textContent?.trim(),
      a.getAttribute('href'),
    ]);
    expect(links).toEqual(NAV_ITEMS.map((item) => [item.label, item.path]));
    expect(NAV_ITEMS.map((item) => item.path)).toEqual([
      '/',
      '/medications',
      '/interactions',
      '/digest',
    ]);
  });

  it('shows the unread count on What’s new, and no badge when there is nothing new', async () => {
    const { el } = await setup(7);
    const link = el.querySelector('nav[aria-label="Main"] a[href="/digest"]');
    expect(link?.textContent?.replace(/\s+/g, ' ').trim()).toBe('What’s new 7 unread');
    TestBed.resetTestingModule();
    const none = await setup(0);
    expect(none.el.querySelector('[data-testid="unread-badge"]')).toBeNull();
  });

  it('logs out through the store', async () => {
    const { el, store } = await setup();
    el.querySelector<HTMLButtonElement>('[data-testid="logout"] button')?.click();
    expect(store.dispatch).toHaveBeenCalledWith(AuthActions.logout());
  });

  it('opens the navigation drawer from the menu button', async () => {
    const { el, fixture } = await setup();
    const menuButton = el.querySelector<HTMLButtonElement>('button[aria-label="Open navigation"]');
    expect(menuButton?.getAttribute('aria-expanded')).toBe('false');
    menuButton?.click();
    await fixture.whenStable();
    expect(fixture.componentInstance.drawerOpen()).toBe(true);
    expect(menuButton?.getAttribute('aria-expanded')).toBe('true');
  });

  it('projects page content into the main landmark', async () => {
    const { el } = await setup();
    expect(el.querySelector('main#content')).not.toBeNull();
    expect(el.querySelector('a[href="#content"]')?.textContent).toContain('Skip to content');
  });
});
