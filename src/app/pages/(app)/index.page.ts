import { ChangeDetectionStrategy, Component, computed, inject, OnInit } from '@angular/core';
import { RouterLink } from '@angular/router';
import { RouteMeta } from '@analogjs/router';
import { Store } from '@ngrx/store';

import { interactionsFeature } from '../../features/interactions/store/interactions.reducer';
import { MedicationsActions } from '../../features/medications/store/medications.actions';
import { selectActiveMedications } from '../../features/medications/store/medications.reducer';

export const routeMeta: RouteMeta = { title: 'Dashboard · RxPlus' };

@Component({
  selector: 'app-dashboard-page',
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h1 class="text-2xl font-semibold">Dashboard</h1>

    <ul class="mt-6 flex flex-col gap-3">
      <li data-testid="medications-summary">
        <a routerLink="/medications" class="underline">{{ medicationsLine() }}</a>
      </li>
      @if (interactionsLine(); as line) {
        <li data-testid="interactions-summary" [class.font-semibold]="majorCount() > 0">
          <a routerLink="/interactions" class="underline">{{ line }}</a>
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
