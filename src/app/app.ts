import { Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';

import { AppReady } from './core/app-ready';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet],
  template: `<router-outlet />`,
})
export class App {
  constructor() {
    // Created here so readiness is tracked from the first render, whatever the page.
    inject(AppReady);
  }
}
