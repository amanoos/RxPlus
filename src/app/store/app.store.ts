import { EnvironmentProviders } from '@angular/core';
import { provideEffects } from '@ngrx/effects';
import { provideStore } from '@ngrx/store';
import { provideStoreDevtools } from '@ngrx/store-devtools';

import * as authEffects from '../core/auth/auth.effects';
import { authFeature } from '../core/auth/auth.reducer';

export function provideAppStore(): EnvironmentProviders[] {
  return [
    provideStore({ [authFeature.name]: authFeature.reducer }),
    provideEffects(authEffects),
    // import.meta.env.DEV is a build-time constant, so production bundles drop devtools entirely.
    ...(import.meta.env.DEV ? [provideStoreDevtools({ maxAge: 50, name: 'RxPlus' })] : []),
  ];
}
