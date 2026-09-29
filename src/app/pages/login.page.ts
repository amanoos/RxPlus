import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { RouteMeta } from '@analogjs/router';
import { Store } from '@ngrx/store';
import { ButtonModule } from 'primeng/button';
import { MessageModule } from 'primeng/message';
import { InputTextModule } from 'primeng/inputtext';

import { AuthActions } from '../core/auth/auth.actions';
import { selectAuthError, selectAuthPending } from '../core/auth/auth.selectors';
import { AppReady } from '../core/app-ready';
import { safeNext } from '../core/auth/safe-next';
import { ThemeToggleComponent } from '../core/layout/theme-toggle.component';

export const routeMeta: RouteMeta = { title: 'Sign in · RxPlus' };

// Public and prerendered at build time (see prerender.routes in vite.config.ts).
@Component({
  selector: 'app-login-page',
  imports: [
    ReactiveFormsModule,
    ButtonModule,
    InputTextModule,
    MessageModule,
    ThemeToggleComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main
      class="relative flex min-h-screen items-center justify-center bg-linear-135 from-primary-100 to-[#ffe0ea] p-4 dark:from-surface-950 dark:to-surface-900"
    >
      <div class="absolute top-4 right-4"><app-theme-toggle /></div>
      <form
        [formGroup]="form"
        (ngSubmit)="submit()"
        class="rx-card flex w-full max-w-sm flex-col gap-4 p-8"
        aria-labelledby="login-title"
      >
        <div class="flex items-center gap-3">
          <span class="rx-icon-tile text-sm font-bold" aria-hidden="true">Rx</span>
          <h1 id="login-title" class="rx-gradient-text text-3xl font-extrabold tracking-tight">
            RxPlus
          </h1>
        </div>
        <p class="-mt-1 text-sm text-surface-600 dark:text-surface-300">
          Sign in to your medication watchlist.
        </p>
        <!-- Disabled until the app has loaded: text typed before then would be lost. -->
        <fieldset
          class="flex flex-col gap-4"
          [disabled]="!appReady()"
          [attr.aria-busy]="!appReady()"
          data-testid="login-fields"
        >
          <label for="username" class="text-sm font-medium">Username</label>
          <input
            pInputText
            id="username"
            type="text"
            formControlName="username"
            autocomplete="username"
            autocapitalize="none"
            spellcheck="false"
            class="w-full"
          />
          <label for="password" class="text-sm font-medium">Password</label>
          <input
            pInputText
            id="password"
            type="password"
            formControlName="password"
            autocomplete="current-password"
            class="w-full"
          />
          @if (error(); as error) {
            <p-message severity="error">{{ error }}</p-message>
          }
          <p-button
            type="submit"
            label="Sign in"
            [loading]="pending()"
            [disabled]="form.invalid || pending()"
            styleClass="w-full"
          />
        </fieldset>
      </form>
    </main>
  `,
})
export default class LoginPage {
  private readonly store = inject(Store);
  private readonly route = inject(ActivatedRoute);

  readonly appReady = inject(AppReady).isReady;
  readonly error = this.store.selectSignal(selectAuthError);
  readonly pending = this.store.selectSignal(selectAuthPending);
  readonly form = inject(NonNullableFormBuilder).group({
    username: ['', Validators.required],
    password: ['', Validators.required],
  });

  submit(): void {
    if (this.form.invalid) return;
    const redirectTo = safeNext(this.route.snapshot.queryParamMap.get('next'));
    const { username, password } = this.form.getRawValue();
    this.store.dispatch(AuthActions.login({ username, password, redirectTo }));
  }
}
