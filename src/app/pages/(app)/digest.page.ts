import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouteMeta } from '@analogjs/router';

export const routeMeta: RouteMeta = { title: 'Digest · RxPlus' };

@Component({
  selector: 'app-digest-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h1 class="text-2xl font-semibold">Digest</h1>
    <p class="mt-2 text-surface-600 dark:text-surface-300">
      New studies and alternatives for your medications, updated weekly. Coming in the digest
      module.
    </p>
  `,
})
export default class DigestPage {}
