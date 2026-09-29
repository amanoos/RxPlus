import { ChangeDetectionStrategy, Component, computed, inject, OnInit } from '@angular/core';
import { RouterLink } from '@angular/router';
import { RouteMeta } from '@analogjs/router';
import { Store } from '@ngrx/store';

import { interactionsFeature } from '../../features/interactions/store/interactions.reducer';
import { MedicationsActions } from '../../features/medications/store/medications.actions';
import { selectActiveMedications } from '../../features/medications/store/medications.reducer';
import { IconComponent } from '../../shared/ui/icon.component';

export const routeMeta: RouteMeta = { title: 'Dashboard · RxPlus' };

@Component({
  selector: 'app-dashboard-page',
  imports: [IconComponent, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h1 class="text-3xl font-bold tracking-tight">Dashboard</h1>

    <ul class="mt-6 grid gap-4 sm:grid-cols-2">
      <li data-testid="medications-summary">
        <a routerLink="/medications" [class]="cardLink">
          <span class="rx-icon-tile"><app-icon name="capsule" /></span>
          <span class="flex min-w-0 flex-col">
            <span
              class="text-xs font-semibold tracking-wide text-surface-500 uppercase dark:text-surface-300"
            >
              Medications
            </span>
            <span class="font-semibold">{{ medicationsLine() }}</span>
          </span>
          <app-icon name="arrow-right" class="ml-auto text-primary-600 dark:text-primary-400" />
        </a>
      </li>
      @if (interactionsLine(); as line) {
        <li data-testid="interactions-summary" [class.font-semibold]="majorCount() > 0">
          <a routerLink="/interactions" [class]="cardLink">
            <span class="rx-icon-tile"><app-icon name="interactions" /></span>
            <span class="flex min-w-0 flex-col">
              <span
                class="text-xs font-semibold tracking-wide text-surface-500 uppercase dark:text-surface-300"
              >
                Interactions
              </span>
              <span>{{ line }}</span>
            </span>
            <app-icon name="arrow-right" class="ml-auto text-primary-600 dark:text-primary-400" />
          </a>
        </li>
      }
    </ul>
  `,
})
export default class DashboardPage implements OnInit {
  private readonly store = inject(Store);
  private readonly active = this.store.selectSignal(selectActiveMedications);
  private readonly current = this.store.selectSignal(interactionsFeature.selectCurrent);
  private readonly currentStatus = this.store.selectSignal(interactionsFeature.selectCurrentStatus);
  readonly majorCount = this.store.selectSignal(interactionsFeature.selectCurrentMajorCount);

  /** A whole-card link: the card lifts its border on hover and shows the focus ring. */
  protected readonly cardLink =
    'rx-card flex items-center gap-4 p-5 transition-colors hover:border-primary-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600';

  readonly medicationsLine = computed(() => {
    const n = this.active().length;
    return n === 0
      ? 'Add your first medication'
      : `You’re taking ${n} medication${n === 1 ? '' : 's'}`;
  });

  readonly interactionsLine = computed(() => {
    if (this.currentStatus() !== 'loaded' || this.active().length < 2) return null;
    const total = this.current()?.results.length ?? 0;
    const major = this.majorCount();
    if (major) {
      return `${major} Major interaction${major === 1 ? '' : 's'} between your current medications`;
    }
    if (total) {
      return `${total} interaction${total === 1 ? '' : 's'} between your current medications (none Major)`;
    }
    return 'No interactions found between your current medications';
  });

  ngOnInit(): void {
    // Loading medications also refreshes the current-interactions report (effect).
    this.store.dispatch(MedicationsActions.load());
  }
}
