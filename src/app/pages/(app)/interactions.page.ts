import { ChangeDetectionStrategy, Component, computed, inject, OnInit } from '@angular/core';
import { RouteMeta } from '@analogjs/router';
import { Store } from '@ngrx/store';
import { MessageModule } from 'primeng/message';

import type { InteractionReport } from '../../features/interactions/interaction';
import { InteractionListComponent } from '../../features/interactions/interaction-list.component';
import { InteractionsActions } from '../../features/interactions/store/interactions.actions';
import { interactionsFeature } from '../../features/interactions/store/interactions.reducer';
import { ProductPickerComponent } from '../../features/medications/product-picker.component';
import { MedicationsActions } from '../../features/medications/store/medications.actions';
import { selectActiveMedications } from '../../features/medications/store/medications.reducer';

export const routeMeta: RouteMeta = { title: 'Interactions · RxPlus' };

@Component({
  selector: 'app-interactions-page',
  imports: [MessageModule, InteractionListComponent, ProductPickerComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h1 class="text-2xl font-semibold">Interactions</h1>

    @if (noData()) {
      <p-message severity="warn" styleClass="mt-4" data-testid="no-data">
        Interaction data hasn’t been imported yet. Run <code>npm run ddi:import</code> (or, in
        Docker, <code>docker compose run --rm app node dist/ddi-import.cjs</code>) and reload.
      </p-message>
    } @else {
      <section class="mt-6" aria-labelledby="check-heading">
        <h2 id="check-heading" class="text-lg font-semibold">Check a new prescription</h2>
        <p class="mb-4 text-sm text-surface-600 dark:text-surface-300">
          Pick the drug and strength you were prescribed to compare it with what you take now.
        </p>
        <div class="max-w-xl">
          <app-product-picker
            inputId="check-drug"
            radioName="check-product"
            (rxcuiChange)="check($event)"
          />
        </div>

        @switch (candidateStatus()) {
          @case ('loading') {
            <p class="mt-4 text-sm">Checking…</p>
          }
          @case ('error') {
            <p-message severity="error" styleClass="mt-4">{{ candidateError() }}</p-message>
          }
          @case ('loaded') {
            <div class="mt-4" data-testid="candidate-results">
              @if (!activeCount()) {
                <p class="text-sm">You have no current medications to compare it with.</p>
              } @else if (candidate()?.results?.length) {
                <app-interaction-list [results]="candidate()!.results" />
              } @else if (!candidate()?.notCovered?.length) {
                <p class="text-sm">
                  No interactions found in DDInter between this product and your current
                  medications.
                </p>
              }
              @if (notCoveredText(candidate()); as text) {
                <p-message severity="warn" styleClass="mt-3" data-testid="not-covered">{{
                  text
                }}</p-message>
              }
            </div>
          }
        }
      </section>

      <section class="mt-10" aria-labelledby="current-heading">
        <h2 id="current-heading" class="mb-4 text-lg font-semibold">
          Between your current medications
        </h2>
        @switch (currentStatus()) {
          @case ('error') {
            <p-message severity="error">{{ currentError() }}</p-message>
          }
          @case ('loaded') {
            <div data-testid="current-results">
              @if (activeCount() < 2) {
                <p class="text-sm">Add at least two medications to compare them.</p>
              } @else if (current()?.results?.length) {
                <app-interaction-list [results]="current()!.results" />
              } @else if (!current()?.notCovered?.length) {
                <p class="text-sm">
                  No interactions found in DDInter between your current medications.
                </p>
              }
              @if (notCoveredText(current()); as text) {
                <p-message severity="warn" styleClass="mt-3" data-testid="not-covered">{{
                  text
                }}</p-message>
              }
            </div>
          }
          @default {
            <p class="text-sm">Loading…</p>
          }
        }
      </section>

      <footer
        class="mt-10 border-t border-surface-200 pt-4 text-xs text-surface-600 dark:border-surface-800 dark:text-surface-300"
      >
        <p>
          Severity from
          <a
            class="underline"
            href="https://ddinter2.scbdd.com"
            target="_blank"
            rel="noopener noreferrer"
          >
            DDInter 2.0</a
          >
          {{ sourceNote() }} Label text from the FDA via openFDA and DailyMed.
        </p>
        <p class="mt-1">Not medical advice. Always confirm with your pharmacist or prescriber.</p>
      </footer>
    }
  `,
})
export default class InteractionsPage implements OnInit {
  private readonly store = inject(Store);

  readonly current = this.store.selectSignal(interactionsFeature.selectCurrent);
  readonly currentStatus = this.store.selectSignal(interactionsFeature.selectCurrentStatus);
  readonly currentError = this.store.selectSignal(interactionsFeature.selectCurrentError);
  readonly candidate = this.store.selectSignal(interactionsFeature.selectCandidate);
  readonly candidateStatus = this.store.selectSignal(interactionsFeature.selectCandidateStatus);
  readonly candidateError = this.store.selectSignal(interactionsFeature.selectCandidateError);
  readonly noData = this.store.selectSignal(interactionsFeature.selectNoData);
  private readonly active = this.store.selectSignal(selectActiveMedications);
  readonly activeCount = computed(() => this.active().length);
  /** "(CC BY-NC-SA 4.0), imported Sep 27, 2026." */
  readonly sourceNote = computed(() => {
    const importedAt = this.current()?.source.importedAt ?? this.candidate()?.source.importedAt;
    const date = importedAt
      ? new Date(importedAt).toLocaleDateString('en-US', {
          month: 'short',
          day: 'numeric',
          year: 'numeric',
        })
      : null;
    return `(CC BY-NC-SA 4.0)${date ? `, imported ${date}` : ''}.`;
  });

  ngOnInit(): void {
    // Loading medications also refreshes the current-interactions report (effect).
    this.store.dispatch(MedicationsActions.load());
    this.store.dispatch(InteractionsActions.clearCandidate());
  }

  check(rxcui: string | null): void {
    this.store.dispatch(
      rxcui ? InteractionsActions.checkCandidate({ rxcui }) : InteractionsActions.clearCandidate(),
    );
  }

  /** Warning for ingredients missing from DDInter, or null when everything is covered. */
  notCoveredText(report: InteractionReport | null): string | null {
    const names = [...new Set(report?.notCovered.map((n) => n.ingredient) ?? [])];
    if (!names.length) return null;
    const list =
      names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names.at(-1)}` : names[0];
    const verb = names.length > 1 ? 'aren’t' : 'isn’t';
    return `${list} ${verb} in the interaction dataset, so interactions can’t be ruled out. Ask your pharmacist.`;
  }
}
