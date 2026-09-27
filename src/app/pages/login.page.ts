import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { Store } from '@ngrx/store';
import { ButtonModule } from 'primeng/button';
import { MessageModule } from 'primeng/message';
import { PasswordModule } from 'primeng/password';

import { AuthActions } from '../core/auth/auth.actions';
import { selectAuthError, selectAuthPending } from '../core/auth/auth.selectors';
import { safeNext } from '../core/auth/safe-next';

// Public and prerendered at build time (see prerender.routes in vite.config.ts).
@Component({
  selector: 'app-login-page',
  imports: [ReactiveFormsModule, ButtonModule, PasswordModule, MessageModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main class="flex min-h-screen items-center justify-center p-4">
      <form
        [formGroup]="form"
        (ngSubmit)="submit()"
        class="flex w-full max-w-sm flex-col gap-4"
        aria-labelledby="login-title"
      >
        <h1 id="login-title" class="text-2xl font-semibold">RxPlus</h1>
        <label for="password" class="text-sm font-medium">Password</label>
        <p-password
          formControlName="password"
          inputId="password"
          [feedback]="false"
          [toggleMask]="true"
          autocomplete="current-password"
          class="w-full"
          inputStyleClass="w-full"
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
      </form>
    </main>
  `,
})
export default class LoginPage {
  private readonly store = inject(Store);
  private readonly route = inject(ActivatedRoute);

  readonly error = this.store.selectSignal(selectAuthError);
  readonly pending = this.store.selectSignal(selectAuthPending);
  readonly form = inject(NonNullableFormBuilder).group({
    password: ['', Validators.required],
  });

  submit(): void {
    if (this.form.invalid) return;
    const redirectTo = safeNext(this.route.snapshot.queryParamMap.get('next'));
    this.store.dispatch(
      AuthActions.login({ password: this.form.getRawValue().password, redirectTo }),
    );
  }
}
