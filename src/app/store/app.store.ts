import { EnvironmentProviders } from '@angular/core';
import { provideEffects } from '@ngrx/effects';
import { provideStore } from '@ngrx/store';
import { provideStoreDevtools } from '@ngrx/store-devtools';

import * as authEffects from '../core/auth/auth.effects';
import * as alternativesEffects from '../features/alternatives/store/alternatives.effects';
import { alternativesFeature } from '../features/alternatives/store/alternatives.reducer';
import { authFeature } from '../core/auth/auth.reducer';
import * as digestEffects from '../features/digest/store/digest.effects';
import { digestFeature } from '../features/digest/store/digest.reducer';
import * as drugInfoEffects from '../features/drug-info/store/drug-info.effects';
import { drugInfoFeature } from '../features/drug-info/store/drug-info.reducer';
import * as interactionsEffects from '../features/interactions/store/interactions.effects';
import { interactionsFeature } from '../features/interactions/store/interactions.reducer';
import * as literatureEffects from '../features/literature/store/literature.effects';
import { literatureFeature } from '../features/literature/store/literature.reducer';
import * as medicationsEffects from '../features/medications/store/medications.effects';
import { medicationsFeature } from '../features/medications/store/medications.reducer';
import * as pricingEffects from '../features/pricing/store/pricing.effects';
import { pricingFeature } from '../features/pricing/store/pricing.reducer';

export function provideAppStore(): EnvironmentProviders[] {
  return [
    provideStore({
      [authFeature.name]: authFeature.reducer,
      [medicationsFeature.name]: medicationsFeature.reducer,
      [interactionsFeature.name]: interactionsFeature.reducer,
      [drugInfoFeature.name]: drugInfoFeature.reducer,
      [literatureFeature.name]: literatureFeature.reducer,
      [alternativesFeature.name]: alternativesFeature.reducer,
      [digestFeature.name]: digestFeature.reducer,
      [pricingFeature.name]: pricingFeature.reducer,
    }),
    provideEffects(
      authEffects,
      medicationsEffects,
      interactionsEffects,
      drugInfoEffects,
      literatureEffects,
      alternativesEffects,
      digestEffects,
      pricingEffects,
    ),
    // import.meta.env.DEV is a build-time constant, so production bundles drop devtools entirely.
    ...(import.meta.env.DEV ? [provideStoreDevtools({ maxAge: 50, name: 'RxPlus' })] : []),
  ];
}
