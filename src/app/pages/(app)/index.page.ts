import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouteMeta } from '@analogjs/router';

export const routeMeta: RouteMeta = { title: 'Dashboard · RxPlus' };

@Component({
  selector: 'app-dashboard-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h1 class="text-2xl font-semibold">Dashboard</h1>
    <p class="mt-2 text-surface-600 dark:text-surface-300">
      Your medications and what changed this week will appear here.
    </p>
  `,
})
export default class DashboardPage {}
