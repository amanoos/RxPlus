import { DOCUMENT, isPlatformBrowser } from '@angular/common';
import { afterNextRender, inject, Injectable, PLATFORM_ID, signal } from '@angular/core';

/**
 * Whether the browser app has taken over the server-rendered page. Until then,
 * text typed into an input is lost: the form never sees it (login) or the input
 * is re-created (PrimeNG autocomplete). Inputs people type into right after a
 * page loads stay disabled until this is true. Always false on the server.
 */
@Injectable({ providedIn: 'root' })
export class AppReady {
  private readonly ready = signal(false);
  readonly isReady = this.ready.asReadonly();

  constructor() {
    // Checked explicitly: during prerendering the render hooks ran too, which
    // shipped the login page with its fields already enabled.
    if (!isPlatformBrowser(inject(PLATFORM_ID))) return;
    const html = inject(DOCUMENT).documentElement;
    afterNextRender(() => {
      this.ready.set(true);
      // The e2e tests wait for this attribute before typing.
      html.setAttribute('data-hydrated', '');
    });
  }
}
