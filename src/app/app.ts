import { DOCUMENT } from '@angular/common';
import { afterNextRender, Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet],
  template: `<router-outlet />`,
})
export class App {
  constructor() {
    // Marks the page once the browser app has taken over the server-rendered one.
    // Text typed into an input before this can be lost (a PrimeNG autocomplete is
    // re-created on hydration), so the e2e tests wait for it before typing.
    const html = inject(DOCUMENT).documentElement;
    afterNextRender(() => html.setAttribute('data-hydrated', ''));
  }
}
