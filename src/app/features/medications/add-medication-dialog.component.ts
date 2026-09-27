import { ChangeDetectionStrategy, Component, inject, model, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { Actions, ofType } from '@ngrx/effects';
import { Store } from '@ngrx/store';
import { AutoCompleteModule } from 'primeng/autocomplete';
import { ButtonModule } from 'primeng/button';
import { DialogModule } from 'primeng/dialog';
import { InputTextModule } from 'primeng/inputtext';
import { MessageModule } from 'primeng/message';
import { TextareaModule } from 'primeng/textarea';
import { catchError, of, Subject, switchMap, tap } from 'rxjs';

import { lookupErrorMessage, RxNormApi, sortProducts, type RxProduct } from './rxnorm-api.service';
import { MedicationsActions } from './store/medications.actions';
import { selectMedicationsError, selectMedicationsSaving } from './store/medications.reducer';

/** Drug name → product (strength and form) → optional start date and notes → Add. */
@Component({
  selector: 'app-add-medication-dialog',
  imports: [
    FormsModule,
    AutoCompleteModule,
    ButtonModule,
    DialogModule,
    InputTextModule,
    MessageModule,
    TextareaModule,
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
        <div class="flex flex-col gap-2">
          <label for="drug-search" class="text-sm font-medium">Drug name</label>
          <p-autocomplete
            inputId="drug-search"
            [ngModel]="query()"
            (ngModelChange)="query.set($event)"
            [suggestions]="suggestions()"
            (completeMethod)="search($event.query)"
            (onSelect)="selectDrug($event.value)"
            [delay]="300"
            [minQueryLength]="2"
            [forceSelection]="true"
            [showEmptyMessage]="true"
            emptyMessage="No matching drugs"
            placeholder="Start typing, e.g. lisinopril"
            appendTo="body"
            class="w-full"
            inputStyleClass="w-full"
          />
        </div>

        @if (lookupError(); as message) {
          <p-message severity="warn">{{ message }}</p-message>
        }

        @if (selectedDrug()) {
          <fieldset class="flex flex-col gap-2">
            <legend class="mb-2 text-sm font-medium">Strength and form</legend>
            @if (loadingProducts()) {
              <p class="text-sm text-surface-600 dark:text-surface-300">Loading products…</p>
            } @else if (!products().length && !lookupError()) {
              <p class="text-sm text-surface-600 dark:text-surface-300">
                No prescribable products found for this drug.
              </p>
            }
            <div class="flex max-h-64 flex-col gap-1 overflow-y-auto">
              @for (product of products(); track product.rxcui) {
                <label
                  data-testid="product-option"
                  class="flex cursor-pointer items-start gap-2 rounded px-2 py-1.5 hover:bg-surface-100 dark:hover:bg-surface-800"
                >
                  <input
                    type="radio"
                    name="product"
                    class="mt-1"
                    [value]="product.rxcui"
                    [checked]="selectedRxcui() === product.rxcui"
                    (change)="selectedRxcui.set(product.rxcui)"
                  />
                  {{ product.name }}
                </label>
              }
            </div>
          </fieldset>
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
  private readonly rxnorm = inject(RxNormApi);

  readonly visible = model(false);

  readonly query = signal('');
  readonly suggestions = signal<string[]>([]);
  readonly selectedDrug = signal<string | null>(null);
  readonly products = signal<RxProduct[]>([]);
  readonly loadingProducts = signal(false);
  readonly selectedRxcui = signal<string | null>(null);
  readonly startedOn = signal<string | null>(null);
  readonly notes = signal('');
  readonly lookupError = signal<string | null>(null);

  readonly saving = this.store.selectSignal(selectMedicationsSaving);
  readonly saveError = this.store.selectSignal(selectMedicationsError);

  private readonly searches = new Subject<string>();
  private readonly drugChoices = new Subject<string>();

  constructor() {
    // switchMap drops stale responses when the user keeps typing or changes drug.
    this.searches
      .pipe(
        switchMap((q) =>
          this.rxnorm.search(q).pipe(
            catchError((error: unknown) => {
              this.lookupError.set(lookupErrorMessage(error));
              return of([]);
            }),
          ),
        ),
        takeUntilDestroyed(),
      )
      .subscribe((names) => this.suggestions.set(names));

    this.drugChoices
      .pipe(
        tap(() => this.loadingProducts.set(true)),
        switchMap((name) =>
          this.rxnorm.products(name).pipe(
            catchError((error: unknown) => {
              this.lookupError.set(lookupErrorMessage(error));
              return of([]);
            }),
          ),
        ),
        takeUntilDestroyed(),
      )
      .subscribe((products) => {
        this.products.set(sortProducts(products));
        this.loadingProducts.set(false);
      });

    inject(Actions)
      .pipe(ofType(MedicationsActions.addSuccess), takeUntilDestroyed())
      .subscribe(() => this.visible.set(false));
  }

  search(query: string): void {
    this.lookupError.set(null);
    this.searches.next(query);
  }

  selectDrug(name: string): void {
    this.lookupError.set(null);
    this.selectedDrug.set(name);
    this.selectedRxcui.set(null);
    this.products.set([]);
    this.drugChoices.next(name);
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
    this.query.set('');
    this.suggestions.set([]);
    this.selectedDrug.set(null);
    this.products.set([]);
    this.selectedRxcui.set(null);
    this.startedOn.set(null);
    this.notes.set('');
    this.lookupError.set(null);
    this.store.dispatch(MedicationsActions.clearError());
  }
}
