import { ChangeDetectionStrategy, Component, inject, input, model, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { AutoCompleteModule } from 'primeng/autocomplete';
import { MessageModule } from 'primeng/message';
import { catchError, of, Subject, switchMap, tap } from 'rxjs';

import { AppReady } from '../../core/app-ready';
import { lookupErrorMessage, RxNormApi, sortProducts, type RxProduct } from './rxnorm-api.service';

/** Drug name search → product (strength and form) choice. Emits the product RXCUI. */
@Component({
  selector: 'app-product-picker',
  imports: [FormsModule, AutoCompleteModule, MessageModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="flex flex-col gap-5">
      <!-- Disabled until the app has loaded: the search box is re-created then, losing text. -->
      <fieldset class="flex flex-col gap-2" [disabled]="!appReady()">
        <label [for]="inputId()" class="text-sm font-medium">Drug name</label>
        <p-autocomplete
          [inputId]="inputId()"
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
      </fieldset>

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
                  class="mt-1"
                  [name]="radioName()"
                  [value]="product.rxcui"
                  [checked]="rxcui() === product.rxcui"
                  (change)="rxcui.set(product.rxcui)"
                />
                {{ product.name }}
              </label>
            }
          </div>
        </fieldset>
      }
    </div>
  `,
})
export class ProductPickerComponent {
  private readonly rxnorm = inject(RxNormApi);
  protected readonly appReady = inject(AppReady).isReady;

  /** Unique per page when several pickers are shown. */
  readonly inputId = input('drug-search');
  readonly radioName = input('product');
  /** The chosen SCD/SBD product. */
  readonly rxcui = model<string | null>(null);

  readonly query = signal('');
  readonly suggestions = signal<string[]>([]);
  readonly selectedDrug = signal<string | null>(null);
  readonly products = signal<RxProduct[]>([]);
  readonly loadingProducts = signal(false);
  readonly lookupError = signal<string | null>(null);

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
  }

  search(query: string): void {
    this.lookupError.set(null);
    this.searches.next(query);
  }

  selectDrug(name: string): void {
    this.lookupError.set(null);
    this.selectedDrug.set(name);
    this.rxcui.set(null);
    this.products.set([]);
    this.drugChoices.next(name);
  }

  reset(): void {
    this.query.set('');
    this.suggestions.set([]);
    this.selectedDrug.set(null);
    this.products.set([]);
    this.rxcui.set(null);
    this.lookupError.set(null);
  }
}
