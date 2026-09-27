import {
  ChangeDetectionStrategy,
  Component,
  inject,
  model,
  signal,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Actions, ofType } from '@ngrx/effects';
import { Store } from '@ngrx/store';
import { ButtonModule } from 'primeng/button';
import { DialogModule } from 'primeng/dialog';
import { InputTextModule } from 'primeng/inputtext';
import { MessageModule } from 'primeng/message';
import { TextareaModule } from 'primeng/textarea';

import { ProductPickerComponent } from './product-picker.component';
import { MedicationsActions } from './store/medications.actions';
import { selectMedicationsError, selectMedicationsSaving } from './store/medications.reducer';

/** Drug name → product (strength and form) → optional start date and notes → Add. */
@Component({
  selector: 'app-add-medication-dialog',
  imports: [
    ButtonModule,
    DialogModule,
    InputTextModule,
    MessageModule,
    TextareaModule,
    ProductPickerComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <p-dialog
      [(visible)]="visible"
      header="Add medication"
      [modal]="true"
      [style]="{ width: '34rem' }"
      [breakpoints]="{ '640px': '95vw' }"
      (onHide)="reset()"
    >
      <div class="flex flex-col gap-5">
        <app-product-picker [(rxcui)]="selectedRxcui" />

        <div class="flex flex-col gap-2">
          <label for="started-on" class="text-sm font-medium">Started on (optional)</label>
          <input
            pInputText
            id="started-on"
            type="date"
            class="w-full"
            [value]="startedOn() ?? ''"
            (input)="startedOn.set($any($event.target).value || null)"
          />
        </div>

        <div class="flex flex-col gap-2">
          <label for="notes" class="text-sm font-medium">Notes (optional)</label>
          <textarea
            pTextarea
            id="notes"
            rows="3"
            maxlength="1000"
            class="w-full"
            [value]="notes()"
            (input)="notes.set($any($event.target).value)"
          ></textarea>
        </div>

        @if (saveError(); as message) {
          <p-message severity="error">{{ message }}</p-message>
        }
      </div>

      <ng-template #footer>
        <p-button
          label="Cancel"
          severity="secondary"
          [text]="true"
          (onClick)="visible.set(false)"
        />
        <p-button
          label="Add"
          [loading]="saving()"
          [disabled]="!selectedRxcui() || saving()"
          (onClick)="save()"
        />
      </ng-template>
    </p-dialog>
  `,
})
export class AddMedicationDialogComponent {
  private readonly store = inject(Store);
  private readonly picker = viewChild(ProductPickerComponent);

  readonly visible = model(false);

  readonly selectedRxcui = signal<string | null>(null);
  readonly startedOn = signal<string | null>(null);
  readonly notes = signal('');

  readonly saving = this.store.selectSignal(selectMedicationsSaving);
  readonly saveError = this.store.selectSignal(selectMedicationsError);

  constructor() {
    inject(Actions)
      .pipe(ofType(MedicationsActions.addSuccess), takeUntilDestroyed())
      .subscribe(() => this.visible.set(false));
  }

  save(): void {
    const rxcui = this.selectedRxcui();
    if (!rxcui || this.saving()) return;
    const notes = this.notes().trim();
    this.store.dispatch(
      MedicationsActions.add({
        rxcui,
        startedOn: this.startedOn(),
        notes: notes || null,
      }),
    );
  }

  /** Clears the form whenever the dialog closes. */
  reset(): void {
    this.picker()?.reset();
    this.selectedRxcui.set(null);
    this.startedOn.set(null);
    this.notes.set('');
    this.store.dispatch(MedicationsActions.clearError());
  }
}
