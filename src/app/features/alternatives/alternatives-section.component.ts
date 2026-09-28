import { isPlatformBrowser } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  inject,
  input,
  PLATFORM_ID,
  signal,
  untracked,
} from '@angular/core';
import { Store } from '@ngrx/store';
import { ButtonModule } from 'primeng/button';
import { MessageModule } from 'primeng/message';

import { AlternativeListComponent } from './alternative-list.component';
import type { Condition, IngredientAlternatives } from './alternatives';
import { AlternativesActions } from './store/alternatives.actions';
import { alternativesFeature } from './store/alternatives.reducer';

/**
 * The drug page's Alternatives section: newly approved drugs for the condition
 * it's taken for, the same class, and other classes. Structured data only.
 */
@Component({
  selector: 'app-alternatives-section',
  imports: [AlternativeListComponent, ButtonModule, MessageModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section aria-labelledby="alternatives-heading" data-testid="alternatives">
      <h2 id="alternatives-heading" class="text-lg font-semibold">Alternatives</h2>
      <p class="mt-1 text-sm font-medium" data-testid="alternatives-note">
        Other drugs used for the same purpose. Not a recommendation: talk to your prescriber before
        changing anything.
      </p>

      @if (entry(); as e) {
        @if (e.data; as data) {
          <div class="mt-3 text-sm" data-testid="condition">
            @if (data.condition && !changing()) {
              <span
                >For <strong>{{ data.condition.name }}</strong
                >&ngsp;<span class="text-surface-600 dark:text-surface-300">{{
                  data.conditionSource === 'medication'
                    ? '(saved for this medication)'
                    : '(this visit only)'
                }}</span></span
              >
              @if (data.uses.length > 1) {
                <button
                  type="button"
                  class="ml-2 underline"
                  data-testid="change-condition"
                  (click)="changing.set(true)"
                >
                  Change
                </button>
              }
            } @else if (data.uses.length) {
              <p>What do you take {{ drugName() }} for?</p>
              <div class="mt-2 flex flex-wrap gap-2" data-testid="condition-choices">
                @for (use of data.uses; track use.id) {
                  <p-button
                    [label]="use.name"
                    size="small"
                    [outlined]="use.id !== data.condition?.id"
                    [loading]="e.choosing"
                    (onClick)="choose(use)"
                  />
                }
              </div>
            } @else {
              <p class="text-surface-600 dark:text-surface-300">
                No known uses are listed for this drug, so only the same class is shown.
              </p>
            }
          </div>

          @if (e.error) {
            <p-message severity="warn" styleClass="mt-3" data-testid="alternatives-refresh-error">{{
              e.error
            }}</p-message>
          }
          @if (e.hideError) {
            <p-message severity="warn" styleClass="mt-3">{{ e.hideError }}</p-message>
          }

          @for (lit of data.ingredients; track lit.rxcui) {
            <div class="mt-4" data-testid="alternatives-ingredient">
              @if (data.ingredients.length > 1) {
                <h3 class="font-medium capitalize">{{ lit.name }}</h3>
              }
              @if (building(lit)) {
                <p class="mt-1 text-sm" role="status" data-testid="alternatives-building">
                  Finding alternatives… this can take a minute the first time.
                </p>
                @if (e.timedOut) {
                  <p-message severity="warn" styleClass="mt-2">
                    This is taking longer than expected. Reload the page later.
                  </p-message>
                }
              }
              @if (failed(lit); as message) {
                <p-message severity="warn" styleClass="mt-2" data-testid="alternatives-failed">
                  Alternatives couldn’t be found: {{ message }}
                </p-message>
                <p-button
                  styleClass="mt-2"
                  label="Try again"
                  size="small"
                  severity="secondary"
                  [loading]="e.refreshing"
                  (onClick)="refresh()"
                />
              }
              @if (skipped(lit); as n) {
                <p
                  class="mt-1 text-xs text-surface-600 dark:text-surface-300"
                  data-testid="skipped"
                >
                  {{ n }} {{ n === 1 ? 'drug' : 'drugs' }} couldn’t be checked right now and
                  {{ n === 1 ? 'isn’t' : 'aren’t' }} listed.
                </p>
              }

              @if (lit.groups.newForCondition.length) {
                <h4 class="mt-4 text-sm font-semibold">New for {{ data.condition?.name }}</h4>
                <div class="mt-2" data-testid="group-new">
                  <app-alternative-list
                    [drugs]="lit.groups.newForCondition"
                    action="hide"
                    (act)="hide(lit.rxcui, $event)"
                  />
                </div>
              }

              @if (lit.drugClass) {
                <h4 class="mt-4 text-sm font-semibold">Same class ({{ lit.drugClass.name }})</h4>
                <div class="mt-2" data-testid="group-same-class">
                  @if (lit.groups.sameClass.length) {
                    <app-alternative-list
                      [drugs]="lit.groups.sameClass"
                      action="hide"
                      (act)="hide(lit.rxcui, $event)"
                    />
                  } @else if (lit.classList?.status === 'ready') {
                    <p class="text-sm">No other drugs in this class.</p>
                  }
                </div>
              }

              @if (data.condition && lit.groups.otherClasses.length) {
                <h4 class="mt-4 text-sm font-semibold">
                  Other classes for {{ data.condition.name }}
                </h4>
                <div class="mt-2 flex flex-col gap-1" data-testid="group-other-classes">
                  @for (cls of lit.groups.otherClasses; track cls.className) {
                    <details
                      class="rounded border border-surface-200 px-3 py-2 dark:border-surface-800"
                    >
                      <summary class="cursor-pointer text-sm" data-testid="other-class">
                        {{ cls.className }} ({{ cls.drugs.length }})
                      </summary>
                      <div class="mt-2">
                        <app-alternative-list
                          [drugs]="cls.drugs"
                          action="hide"
                          (act)="hide(lit.rxcui, $event)"
                        />
                      </div>
                    </details>
                  }
                </div>
              }

              @if (lit.groups.hidden.length) {
                <button
                  type="button"
                  class="mt-3 text-xs underline"
                  [attr.aria-expanded]="showingHidden().has(lit.rxcui)"
                  data-testid="toggle-hidden-alternatives"
                  (click)="toggleHidden(lit.rxcui)"
                >
                  {{
                    showingHidden().has(lit.rxcui)
                      ? 'Hide the hidden drugs'
                      : 'Show hidden (' + lit.groups.hidden.length + ')'
                  }}
                </button>
                @if (showingHidden().has(lit.rxcui)) {
                  <div class="mt-2 opacity-80" data-testid="hidden-alternatives">
                    <app-alternative-list
                      [drugs]="lit.groups.hidden"
                      action="unhide"
                      (act)="unhide(lit.rxcui, $event)"
                    />
                  </div>
                }
              }
            </div>
          }

          <footer
            class="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-surface-200 pt-3 text-xs text-surface-600 dark:border-surface-800 dark:text-surface-300"
          >
            <p data-testid="alternatives-footer">{{ footer() }}</p>
            <p-button
              label="Check for new approvals"
              size="small"
              severity="secondary"
              [text]="true"
              [loading]="e.refreshing"
              data-testid="refresh-alternatives"
              (onClick)="refresh()"
            />
          </footer>
        } @else if (e.status === 'error') {
          <p-message severity="warn" styleClass="mt-3" data-testid="alternatives-error">{{
            e.error
          }}</p-message>
        } @else {
          <p class="mt-3 text-sm">Loading alternatives…</p>
        }
      } @else {
        <p class="mt-3 text-sm">Loading alternatives…</p>
      }
    </section>
  `,
})
export class AlternativesSectionComponent {
  private readonly store = inject(Store);

  /** Product RXCUI of the drug page. */
  readonly rxcui = input.required<string>();
  /** How to call the drug in the question ("What do you take … for?"). */
  readonly drugName = input('it');

  private readonly entities = this.store.selectSignal(alternativesFeature.selectEntities);
  readonly entry = computed(() => this.entities()[this.rxcui()] ?? null);
  readonly changing = signal(false);
  readonly showingHidden = signal(new Set<string>());

  /** "From RxClass (FDA and MED-RT) and Drugs@FDA, updated Sep 27, 2026." */
  readonly footer = computed(() => {
    const dates = (this.entry()?.data?.ingredients ?? [])
      .flatMap((i) => [i.classList?.builtAt, i.conditionList?.builtAt])
      .filter((d): d is string => !!d)
      .sort();
    const latest = dates.at(-1);
    const updated = latest
      ? `, updated ${new Date(latest).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`
      : '';
    return `From RxClass (FDA and MED-RT) and Drugs@FDA${updated}.`;
  });

  constructor() {
    const browser = isPlatformBrowser(inject(PLATFORM_ID));
    let opened: string | null = null;
    effect(() => {
      const rxcui = this.rxcui();
      if (!browser) return;
      untracked(() => {
        if (opened) this.store.dispatch(AlternativesActions.leave({ rxcui: opened }));
        opened = rxcui;
        this.changing.set(false);
        this.store.dispatch(AlternativesActions.open({ rxcui }));
      });
    });
    inject(DestroyRef).onDestroy(() => {
      if (opened) this.store.dispatch(AlternativesActions.leave({ rxcui: opened }));
    });
  }

  building(lit: IngredientAlternatives): boolean {
    return lit.classList?.status === 'pending' || lit.conditionList?.status === 'pending';
  }

  failed(lit: IngredientAlternatives): string | null {
    const list = [lit.classList, lit.conditionList].find((l) => l?.status === 'failed');
    return list ? (list.error ?? 'unknown error') : null;
  }

  skipped(lit: IngredientAlternatives): number {
    return (lit.classList?.skipped ?? 0) + (lit.conditionList?.skipped ?? 0);
  }

  choose(condition: Condition): void {
    this.changing.set(false);
    this.store.dispatch(
      AlternativesActions.chooseCondition({
        rxcui: this.rxcui(),
        condition,
        medicationId: this.entry()?.data?.medicationId ?? null,
      }),
    );
  }

  refresh(): void {
    this.store.dispatch(AlternativesActions.refresh({ rxcui: this.rxcui() }));
  }

  hide(ingredient: string, target: string): void {
    this.store.dispatch(AlternativesActions.hide({ rxcui: this.rxcui(), ingredient, target }));
  }

  unhide(ingredient: string, target: string): void {
    this.store.dispatch(AlternativesActions.unhide({ rxcui: this.rxcui(), ingredient, target }));
  }

  toggleHidden(ingredient: string): void {
    this.showingHidden.update((shown) => {
      const next = new Set(shown);
      if (!next.delete(ingredient)) next.add(ingredient);
      return next;
    });
  }
}
