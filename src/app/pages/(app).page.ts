import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { RouteMeta } from '@analogjs/router';

import { authGuard } from '../core/auth/auth.guard';
import { AppShellComponent } from '../core/layout/app-shell.component';

// Pathless layout for every signed-in page; the guard runs during SSR and in the browser.
export const routeMeta: RouteMeta = {
  canActivate: [authGuard],
};

@Component({
  selector: 'app-authenticated-layout',
  imports: [RouterOutlet, AppShellComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<app-shell><router-outlet /></app-shell>`,
})
export default class AuthenticatedLayout {}
