import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouteMeta } from '@analogjs/router';

export const routeMeta: RouteMeta = { title: 'Interactions · RxPlus' };

@Component({
  selector: 'app-interactions-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h1 class="text-2xl font-semibold">Interactions</h1>
    <p class="mt-2 text-surface-600 dark:text-surface-300">
      Check a new prescription against your current list. Coming in the interactions module.
    </p>
  `,
})
export default class InteractionsPage {}
