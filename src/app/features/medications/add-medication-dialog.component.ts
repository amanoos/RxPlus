import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  model,
  signal,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { Actions, ofType } from '@ngrx/effects';
import { Store } from '@ngrx/store';
import { ButtonModule } from 'primeng/button';
import { DialogModule } from 'primeng/dialog';
import { InputTextModule } from 'primeng/inputtext';
import { MessageModule } from 'primeng/message';
import { TextareaModule } from 'primeng/textarea';

import { InteractionsActions } from '../interactions/store/interactions.actions';
import { interactionsFeature } from '../interactions/store/interactions.reducer';
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
    RouterLink,
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

        @if (interactionWarning(); as warning) {
          <p-message
            [severity]="warning.major ? 'error' : 'warn'"
            data-testid="interaction-warning"
          >
            <div class="flex flex-col gap-1">
              @for (line of warning.lines; track line) {
                <span>{{ line }}</span>
              }
              <a routerLink="/interactions" class="text-sm underline"
                >See details on the Interactions page</a
              >
            </div>
          </p-message>
        }

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

  private readonly candidateRxcui = this.store.selectSignal(
    interactionsFeature.selectCandidateRxcui,
  );
  private readonly candidate = this.store.selectSignal(interactionsFeature.selectCandidate);
  private readonly candidateStatus = this.store.selectSignal(
    interactionsFeature.selectCandidateStatus,
  );

  /** Interactions of the picked product with current medications (shown before Add). */
  readonly interactionWarning = computed(() => {
    const report = this.candidate();
    if (
      this.candidateStatus() !== 'loaded' ||
      !report ||
      this.candidateRxcui() !== this.selectedRxcui()
    ) {
      return null;
    }
    const lines = report.results.map((r) =>
      r.level === 'Unknown'
        ? `Interacts with ${r.b.ingredient} (listed, severity not rated)`
        : `Interacts with ${r.b.ingredient} (${r.level})`,
    );
    const uncovered = [...new Set(report.notCovered.map((n) => n.ingredient))];
    if (uncovered.length) {
      lines.push(`Not in the interaction dataset: ${uncovered.join(', ')}. Ask your pharmacist.`);
    }
    return lines.length
      ? { lines: [...new Set(lines)], major: report.results.some((r) => r.level === 'Major') }
      : null;
  });

  readonly saving = this.store.selectSignal(selectMedicationsSaving);
  readonly saveError = this.store.selectSignal(selectMedicationsError);

  constructor() {
    // Check the picked product against current medications right away.
    effect(() => {
      const rxcui = this.selectedRxcui();
      if (rxcui && this.visible())
        this.store.dispatch(InteractionsActions.checkCandidate({ rxcui }));
    });
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
    this.store.dispatch(InteractionsActions.clearCandidate());
  }
}
