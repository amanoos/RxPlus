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
import { ConfirmationService } from 'primeng/api';
import { ButtonModule } from 'primeng/button';
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { MessageModule } from 'primeng/message';

import { AddMedicationDialogComponent } from '../../features/medications/add-medication-dialog.component';
import {
  EditMedicationDialogComponent,
  type EditMode,
} from '../../features/medications/edit-medication-dialog.component';
import type { Medication } from '../../features/medications/medication';
import { MedicationCardComponent } from '../../features/medications/medication-card.component';
import { MedicationsActions } from '../../features/medications/store/medications.actions';
import {
  selectActiveMedications,
  selectMedicationsError,
  selectMedicationsLoaded,
  selectMedicationsSaving,
  selectStoppedMedications,
} from '../../features/medications/store/medications.reducer';

export const routeMeta: RouteMeta = { title: 'Medications · RxPlus' };

@Component({
  selector: 'app-medications-page',
  imports: [
    ButtonModule,
    ConfirmDialogModule,
    MessageModule,
    MedicationCardComponent,
    AddMedicationDialogComponent,
    EditMedicationDialogComponent,
  ],
  providers: [ConfirmationService],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="flex flex-wrap items-center justify-between gap-3">
      <h1 class="text-2xl font-semibold">Medications</h1>
      @if (!isEmpty()) {
        <p-button label="Add medication" (onClick)="addOpen.set(true)" />
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
        <p-button label="Add medication" (onClick)="addOpen.set(true)" />
      </section>
    }

    @if (active().length) {
      <section class="mt-6" aria-labelledby="active-heading">
        <h2 id="active-heading" class="sr-only">Currently taking</h2>
        <ul data-testid="active-list" class="grid gap-4 sm:grid-cols-2">
          @for (med of active(); track med.id) {
            <li>
              <app-medication-card [medication]="med">
                <div class="flex flex-wrap gap-1">
                  <p-button
                    label="Edit"
                    [ariaLabel]="'Edit ' + med.name"
                    severity="secondary"
                    [text]="true"
                    size="small"
                    (onClick)="edit(med, 'edit')"
                  />
                  <p-button
                    label="Stop taking"
                    [ariaLabel]="'Stop taking ' + med.name"
                    severity="secondary"
                    [text]="true"
                    size="small"
                    (onClick)="edit(med, 'stop')"
                  />
                  <p-button
                    label="Delete"
                    [ariaLabel]="'Delete ' + med.name"
                    severity="danger"
                    [text]="true"
                    size="small"
                    [disabled]="saving()"
                    (onClick)="confirmDelete(med)"
                  />
                </div>
              </app-medication-card>
            </li>
          }
        </ul>
      </section>
    }

    @if (stopped().length) {
      <details data-testid="stopped" class="mt-8">
        <summary class="cursor-pointer text-lg font-semibold">
          Stopped ({{ stopped().length }})
        </summary>
        <ul class="mt-4 grid gap-4 sm:grid-cols-2">
          @for (med of stopped(); track med.id) {
            <li>
              <app-medication-card [medication]="med">
                <div class="flex flex-wrap gap-1">
                  <p-button
                    label="Restart"
                    [ariaLabel]="'Restart ' + med.name"
                    severity="secondary"
                    [text]="true"
                    size="small"
                    [disabled]="saving()"
                    (onClick)="restart(med)"
                  />
                  <p-button
                    label="Delete"
                    [ariaLabel]="'Delete ' + med.name"
                    severity="danger"
                    [text]="true"
                    size="small"
                    [disabled]="saving()"
                    (onClick)="confirmDelete(med)"
                  />
                </div>
              </app-medication-card>
            </li>
          }
        </ul>
      </details>
    }

    <app-add-medication-dialog [(visible)]="addOpen" />
    <app-edit-medication-dialog
      [medication]="editing()?.medication ?? null"
      [mode]="editing()?.mode ?? 'edit'"
      [visible]="!!editing()"
      (visibleChange)="$event || editing.set(null)"
    />
    <p-confirmdialog />
  `,
})
export default class MedicationsPage implements OnInit {
  private readonly store = inject(Store);
  private readonly confirmation = inject(ConfirmationService);

  readonly active = this.store.selectSignal(selectActiveMedications);
  readonly stopped = this.store.selectSignal(selectStoppedMedications);
  readonly loaded = this.store.selectSignal(selectMedicationsLoaded);
  readonly saving = this.store.selectSignal(selectMedicationsSaving);
  readonly error = this.store.selectSignal(selectMedicationsError);
  readonly addOpen = signal(false);
  readonly editing = signal<{ medication: Medication; mode: EditMode } | null>(null);
  readonly isEmpty = computed(
    () => this.loaded() && !this.active().length && !this.stopped().length,
  );

  ngOnInit(): void {
    this.store.dispatch(MedicationsActions.load());
  }

  edit(medication: Medication, mode: EditMode): void {
    this.editing.set({ medication, mode });
  }

  restart(medication: Medication): void {
    this.store.dispatch(
      MedicationsActions.update({ id: medication.id, changes: { stoppedOn: null } }),
    );
  }

  confirmDelete(medication: Medication): void {
    this.confirmation.confirm({
      header: 'Delete medication?',
      message: `Permanently delete ${medication.name}? To keep it in your history, use “Stop taking” instead.`,
      acceptLabel: 'Delete',
      rejectLabel: 'Cancel',
      acceptButtonProps: { severity: 'danger' },
      rejectButtonProps: { severity: 'secondary', text: true },
      defaultFocus: 'reject',
      accept: () => this.store.dispatch(MedicationsActions.remove({ id: medication.id })),
    });
  }
}
