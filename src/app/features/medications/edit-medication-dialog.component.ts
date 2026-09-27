import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  model,
  signal,
  untracked,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Actions, ofType } from '@ngrx/effects';
import { Store } from '@ngrx/store';
import { ButtonModule } from 'primeng/button';
import { DialogModule } from 'primeng/dialog';
import { InputTextModule } from 'primeng/inputtext';
import { MessageModule } from 'primeng/message';
import { TextareaModule } from 'primeng/textarea';

import { localToday } from '../../shared/dates';
import type { Medication, MedicationChanges } from './medication';
import { MedicationsActions } from './store/medications.actions';
import { selectMedicationsError, selectMedicationsSaving } from './store/medications.reducer';

export type EditMode = 'edit' | 'stop';

/** Edit notes and start date, or stop taking a medication (with a stop date). */
@Component({
  selector: 'app-edit-medication-dialog',
  imports: [ButtonModule, DialogModule, InputTextModule, MessageModule, TextareaModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <p-dialog
      [(visible)]="visible"
      [header]="mode() === 'stop' ? 'Stop taking' : 'Edit medication'"
      [modal]="true"
      [style]="{ width: '30rem' }"
      [breakpoints]="{ '640px': '95vw' }"
      (onHide)="store.dispatch(clearError())"
    >
      @if (medication(); as med) {
        <div class="flex flex-col gap-5">
          <p class="font-medium">{{ med.name }}</p>

          @if (mode() === 'stop') {
            <div class="flex flex-col gap-2">
              <label for="stopped-on" class="text-sm font-medium">Stopped on</label>
              <input
                pInputText
                id="stopped-on"
                type="date"
                class="w-full"
                [min]="med.startedOn ?? ''"
                [value]="stoppedOn() ?? ''"
                (input)="stoppedOn.set($any($event.target).value || null)"
              />
            </div>
          } @else {
            <div class="flex flex-col gap-2">
              <label for="edit-started-on" class="text-sm font-medium">Started on</label>
              <input
                pInputText
                id="edit-started-on"
                type="date"
                class="w-full"
                [value]="startedOn() ?? ''"
                (input)="startedOn.set($any($event.target).value || null)"
              />
            </div>
            <div class="flex flex-col gap-2">
              <label for="edit-notes" class="text-sm font-medium">Notes</label>
              <textarea
                pTextarea
                id="edit-notes"
                rows="3"
                maxlength="1000"
                class="w-full"
                [value]="notes()"
                (input)="notes.set($any($event.target).value)"
              ></textarea>
            </div>
          }

          @if (invalid(); as message) {
            <p-message severity="warn">{{ message }}</p-message>
          }
          @if (saveError(); as message) {
            <p-message severity="error">{{ message }}</p-message>
          }
        </div>
      }

      <ng-template #footer>
        <p-button
          label="Cancel"
          severity="secondary"
          [text]="true"
          (onClick)="visible.set(false)"
        />
        <p-button
          [label]="mode() === 'stop' ? 'Stop taking' : 'Save'"
          [loading]="saving()"
          [disabled]="!!invalid() || saving()"
          (onClick)="save()"
        />
      </ng-template>
    </p-dialog>
  `,
})
export class EditMedicationDialogComponent {
  protected readonly store = inject(Store);
  protected readonly clearError = MedicationsActions.clearError;

  readonly medication = input<Medication | null>(null);
  readonly mode = input<EditMode>('edit');
  readonly visible = model(false);

  readonly notes = signal('');
  readonly startedOn = signal<string | null>(null);
  readonly stoppedOn = signal<string | null>(null);

  readonly saving = this.store.selectSignal(selectMedicationsSaving);
  readonly saveError = this.store.selectSignal(selectMedicationsError);

  readonly invalid = computed(() => {
    const started = this.mode() === 'stop' ? this.medication()?.startedOn : this.startedOn();
    const stopped = this.mode() === 'stop' ? this.stoppedOn() : this.medication()?.stoppedOn;
    if (this.mode() === 'stop' && !stopped) return 'Choose the date you stopped.';
    if (started && stopped && stopped < started) {
      return 'The stop date can’t be before the start date.';
    }
    return null;
  });

  constructor() {
    // Load the form from the medication each time the dialog opens.
    effect(() => {
      const med = this.medication();
      if (!this.visible() || !med) return;
      untracked(() => {
        this.notes.set(med.notes ?? '');
        this.startedOn.set(med.startedOn);
        this.stoppedOn.set(localToday());
      });
    });

    inject(Actions)
      .pipe(ofType(MedicationsActions.updateSuccess), takeUntilDestroyed())
      .subscribe(() => this.visible.set(false));
  }

  save(): void {
    const med = this.medication();
    if (!med || this.invalid() || this.saving()) return;
    const changes: MedicationChanges =
      this.mode() === 'stop'
        ? { stoppedOn: this.stoppedOn() }
        : { notes: this.notes().trim() || null, startedOn: this.startedOn() };
    this.store.dispatch(MedicationsActions.update({ id: med.id, changes }));
  }
}
