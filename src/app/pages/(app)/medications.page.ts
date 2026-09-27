import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  OnInit,
  signal,
} from '@angular/core';
import { RouteMeta } from '@analogjs/router';
import { Store } from '@ngrx/store';
import { ButtonModule } from 'primeng/button';
import { MessageModule } from 'primeng/message';

import { AddMedicationDialogComponent } from '../../features/medications/add-medication-dialog.component';
import { MedicationCardComponent } from '../../features/medications/medication-card.component';
import { MedicationsActions } from '../../features/medications/store/medications.actions';
import {
  selectActiveMedications,
  selectMedicationsError,
  selectMedicationsLoaded,
  selectStoppedMedications,
} from '../../features/medications/store/medications.reducer';

export const routeMeta: RouteMeta = { title: 'Medications · RxPlus' };

@Component({
  selector: 'app-medications-page',
  imports: [ButtonModule, MessageModule, MedicationCardComponent, AddMedicationDialogComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="flex flex-wrap items-center justify-between gap-3">
      <h1 class="text-2xl font-semibold">Medications</h1>
      @if (!isEmpty()) {
        <p-button label="Add medication" (onClick)="openAdd()" />
      }
    </div>

    @if (error(); as error) {
      <p-message severity="error" styleClass="mt-4">{{ error }}</p-message>
    }

    @if (isEmpty()) {
      <section
        class="mt-8 flex flex-col items-center gap-3 rounded-lg border border-dashed border-surface-300 p-8 text-center dark:border-surface-700"
      >
        <h2 class="text-lg font-semibold">No medications yet</h2>
        <p class="text-surface-600 dark:text-surface-300">
          Add the prescriptions you take to check interactions and follow new research.
        </p>
        <p-button label="Add medication" (onClick)="openAdd()" />
      </section>
    }

    @if (active().length) {
      <section class="mt-6" aria-labelledby="active-heading">
        <h2 id="active-heading" class="sr-only">Currently taking</h2>
        <ul data-testid="active-list" class="grid gap-4 sm:grid-cols-2">
          @for (med of active(); track med.id) {
            <li><app-medication-card [medication]="med" /></li>
          }
        </ul>
      </section>
    }

    @if (stopped().length) {
      <details data-testid="stopped" class="mt-8">
        <summary class="cursor-pointer text-lg font-semibold">
          Stopped ({{ stopped().length }})
        </summary>
        <ul class="mt-4 grid gap-4 opacity-80 sm:grid-cols-2">
          @for (med of stopped(); track med.id) {
            <li><app-medication-card [medication]="med" /></li>
          }
        </ul>
      </details>
    }

    <app-add-medication-dialog [(visible)]="addOpen" />
  `,
})
export default class MedicationsPage implements OnInit {
  private readonly store = inject(Store);

  readonly active = this.store.selectSignal(selectActiveMedications);
  readonly stopped = this.store.selectSignal(selectStoppedMedications);
  readonly loaded = this.store.selectSignal(selectMedicationsLoaded);
  readonly error = this.store.selectSignal(selectMedicationsError);
  readonly addOpen = signal(false);
  readonly isEmpty = computed(
    () => this.loaded() && !this.active().length && !this.stopped().length,
  );

  ngOnInit(): void {
    this.store.dispatch(MedicationsActions.load());
  }

  openAdd(): void {
    this.addOpen.set(true);
  }
}
