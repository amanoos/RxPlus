import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { ApplicationConfig, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideClientHydration, withEventReplay } from '@angular/platform-browser';
import { provideFileRouter, requestContextInterceptor } from '@analogjs/router';
import { providePrimeNG } from 'primeng/config';

import { forwardCookieInterceptor } from './core/auth/forward-cookie.interceptor';
import { provideAppStore } from './store/app.store';
import { RxPlusPreset } from './theme/rxplus-preset';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideFileRouter(),
    provideHttpClient(withInterceptors([forwardCookieInterceptor, requestContextInterceptor])),
    provideClientHydration(withEventReplay()),
    provideAppStore(),
    providePrimeNG({
      license: import.meta.env.VITE_PRIMEUI_LICENSE,
      theme: {
        preset: RxPlusPreset,
        options: {
          // Set on <html> by index.html's script and the theme toggle (core/theme.ts).
          darkModeSelector: '.app-dark',
          cssLayer: { name: 'primeng', order: 'theme, base, primeng' },
        },
      },
    }),
  ],
};
