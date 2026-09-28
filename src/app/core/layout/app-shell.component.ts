import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { Store } from '@ngrx/store';
import { ButtonModule } from 'primeng/button';
import { DrawerModule } from 'primeng/drawer';

import { digestFeature } from '../../features/digest/store/digest.reducer';
import { AuthActions } from '../auth/auth.actions';

export const NAV_ITEMS = [
  { label: 'Dashboard', path: '/' },
  { label: 'Medications', path: '/medications' },
  { label: 'Interactions', path: '/interactions' },
  { label: 'What’s new', path: '/digest' },
] as const;

/** Layout for signed-in pages: top bar, navigation (drawer below 768px), and content. */
@Component({
  selector: 'app-shell',
  imports: [RouterLink, RouterLinkActive, ButtonModule, DrawerModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <a
      href="#content"
      class="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-2 focus:z-50 focus:rounded focus:bg-surface-0 focus:px-3 focus:py-2 dark:focus:bg-surface-900"
    >
      Skip to content
    </a>

    <header
      class="sticky top-0 z-10 border-b border-surface-200 bg-surface-0/90 backdrop-blur dark:border-surface-800 dark:bg-surface-950/90"
    >
      <div class="mx-auto flex h-14 max-w-5xl items-center gap-4 px-4">
        <button
          type="button"
          class="relative -ml-2 rounded p-2 hover:bg-surface-100 md:hidden dark:hover:bg-surface-800"
          [attr.aria-label]="
            unread() ? 'Open navigation, ' + unread() + ' unread' : 'Open navigation'
          "
          aria-controls="mobile-nav"
          [attr.aria-expanded]="drawerOpen()"
          (click)="drawerOpen.set(true)"
        >
          <svg viewBox="0 0 24 24" class="h-5 w-5" aria-hidden="true">
            <path d="M4 6h16M4 12h16M4 18h16" stroke="currentColor" stroke-width="2" fill="none" />
          </svg>
          @if (unread()) {
            <!-- Below 768px the navigation is in the drawer: show that there is news. -->
            <span
              class="absolute top-1 right-1 h-2.5 w-2.5 rounded-full bg-primary-600 dark:bg-primary-400"
              data-testid="menu-unread-dot"
            ></span>
          }
        </button>

        <a routerLink="/" class="text-lg font-semibold">RxPlus</a>

        <nav aria-label="Main" class="hidden gap-1 md:flex">
          @for (item of navItems; track item.path) {
            <a
              [routerLink]="item.path"
              routerLinkActive="bg-primary-50 text-primary-700 dark:bg-primary-950 dark:text-primary-300"
              [routerLinkActiveOptions]="{ exact: item.path === '/' }"
              ariaCurrentWhenActive="page"
              class="rounded px-3 py-2 text-sm font-medium hover:bg-surface-100 dark:hover:bg-surface-800"
            >
              {{ item.label }}
              @if (item.path === '/digest' && unread()) {
                <span
                  class="ml-1 rounded-full bg-primary-600 px-1.5 py-0.5 text-xs font-semibold text-white dark:bg-primary-400 dark:text-surface-950"
                  data-testid="unread-badge"
                  >{{ unread() }}<span class="sr-only"> unread</span></span
                >
              }
            </a>
          }
        </nav>

        <p-button
          data-testid="logout"
          label="Log out"
          severity="secondary"
          [text]="true"
          size="small"
          class="ml-auto"
          (onClick)="logout()"
        />
      </div>
    </header>

    <p-drawer [(visible)]="drawerOpen" header="RxPlus" position="left" styleClass="w-72">
      <nav id="mobile-nav" aria-label="Mobile">
        <ul class="flex flex-col gap-1">
          @for (item of navItems; track item.path) {
            <li>
              <a
                [routerLink]="item.path"
                routerLinkActive="bg-primary-50 text-primary-700 dark:bg-primary-950 dark:text-primary-300"
                [routerLinkActiveOptions]="{ exact: item.path === '/' }"
                ariaCurrentWhenActive="page"
                class="block rounded px-3 py-2 font-medium hover:bg-surface-100 dark:hover:bg-surface-800"
                (click)="drawerOpen.set(false)"
              >
                {{ item.label }}
                @if (item.path === '/digest' && unread()) {
                  <span
                    class="ml-1 rounded-full bg-primary-600 px-1.5 py-0.5 text-xs font-semibold text-white dark:bg-primary-400 dark:text-surface-950"
                    data-testid="unread-badge"
                    >{{ unread() }}<span class="sr-only"> unread</span></span
                  >
                }
              </a>
            </li>
          }
        </ul>
      </nav>
    </p-drawer>

    <main id="content" tabindex="-1" class="mx-auto max-w-5xl px-4 py-6 focus:outline-none">
      <ng-content />
    </main>
  `,
})
export class AppShellComponent {
  private readonly store = inject(Store);
  protected readonly navItems = NAV_ITEMS;
  /** Unread digest items, for the What's new badge. */
  protected readonly unread = this.store.selectSignal(digestFeature.selectUnread);
  readonly drawerOpen = signal(false);

  logout(): void {
    this.store.dispatch(AuthActions.logout());
  }
}
