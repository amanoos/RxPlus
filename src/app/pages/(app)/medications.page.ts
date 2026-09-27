import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouteMeta } from '@analogjs/router';

export const routeMeta: RouteMeta = { title: 'Medications · RxPlus' };

@Component({
  selector: 'app-medications-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h1 class="text-2xl font-semibold">Medications</h1>
    <p class="mt-2 text-surface-600 dark:text-surface-300">
      Add and manage your prescriptions. Coming in the medications module.
    </p>
  `,
})
export default class MedicationsPage {}
