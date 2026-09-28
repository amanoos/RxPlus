import { ChangeDetectionStrategy, Component, computed, DestroyRef, inject } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute } from '@angular/router';
import { RouteMeta } from '@analogjs/router';
import { distinctUntilChanged, map } from 'rxjs';
import { Store } from '@ngrx/store';
import { MessageModule } from 'primeng/message';
import { TagModule } from 'primeng/tag';

import { ReportedReactionsComponent } from '../../../features/drug-info/reported-reactions.component';
import { DrugInfoActions } from '../../../features/drug-info/store/drug-info.actions';
import { SummaryPanelComponent } from '../../../features/drug-info/summary-panel.component';
import { AlternativesSectionComponent } from '../../../features/alternatives/alternatives-section.component';
import { ResearchSectionComponent } from '../../../features/literature/research-section.component';
import { drugInfoFeature } from '../../../features/drug-info/store/drug-info.reducer';

export const routeMeta: RouteMeta = { title: 'Drug information · RxPlus' };

@Component({
  selector: 'app-drug-page',
  imports: [
    MessageModule,
    TagModule,
    ReportedReactionsComponent,
    SummaryPanelComponent,
    ResearchSectionComponent,
    AlternativesSectionComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @let f = facts();
    @if (entry()?.facts?.status === 'error' && !f) {
      <p-message severity="error" data-testid="facts-error">{{ entry()?.facts?.error }}</p-message>
    } @else if (!f) {
      <p class="text-sm">Loading…</p>
    } @else {
      <header>
        <h1 class="text-2xl font-semibold" data-testid="drug-name">{{ f.name }}</h1>
        <p class="mt-1 text-sm text-surface-600 dark:text-surface-300">
          {{ details() }}
        </p>
        @if (f.epcClasses.length || f.atcClasses.length) {
          <ul class="mt-3 flex flex-wrap gap-2" aria-label="Drug class">
            @for (c of classes(); track c) {
              <li><p-tag [value]="c" severity="secondary" /></li>
            }
          </ul>
        }
      </header>

      @if (f.unavailable.length) {
        <p-message severity="warn" styleClass="mt-4" data-testid="unavailable">
          Some details are unavailable right now ({{ f.unavailable.join(', ') }}). Reload later to
          try again.
        </p-message>
      }

      <div class="mt-6 grid gap-6 md:grid-cols-2">
        <section aria-labelledby="uses-heading">
          <h2 id="uses-heading" class="text-lg font-semibold">Used for</h2>
          @if (f.mayTreat.length) {
            <ul class="mt-2 flex flex-wrap gap-2" data-testid="uses">
              @for (u of f.mayTreat; track u) {
                <li
                  class="rounded-full bg-primary-50 px-3 py-1 text-sm text-primary-800 dark:bg-primary-950 dark:text-primary-200"
                >
                  {{ u }}
                </li>
              }
            </ul>
          } @else {
            <p class="mt-2 text-sm">Not listed.</p>
          }
          @if (f.mayPrevent.length) {
            <p class="mt-3 text-sm">
              <span class="font-medium">May help prevent:</span> {{ f.mayPrevent.join(', ') }}
            </p>
          }
        </section>

        <section aria-labelledby="avoid-heading">
          <h2 id="avoid-heading" class="text-lg font-semibold">Avoid if you have</h2>
          @if (f.avoidWith.length) {
            <ul class="mt-2 list-disc pl-5 text-sm" data-testid="avoid">
              @for (a of f.avoidWith; track a) {
                <li>{{ a }}</li>
              }
            </ul>
          } @else {
            <p class="mt-2 text-sm">Not listed.</p>
          }
        </section>
      </div>

      @if (entry(); as e) {
        <div class="mt-8 rounded-lg border border-surface-200 p-4 dark:border-surface-800">
          <app-summary-panel [rxcui]="rxcui()" [state]="e.summary" />
        </div>
      }

      <div class="mt-8">
        <app-research-section [rxcui]="rxcui()" />
      </div>

      <div class="mt-8">
        <app-alternatives-section [rxcui]="rxcui()" [drugName]="drugName()" />
      </div>

      <div class="mt-8">
        <app-reported-reactions
          [reactions]="entry()?.reactions?.data ?? null"
          [status]="entry()?.reactions?.status ?? 'loading'"
          [error]="entry()?.reactions?.error ?? null"
        />
      </div>

      <section class="mt-8" aria-labelledby="links-heading">
        <h2 id="links-heading" class="text-lg font-semibold">Read more</h2>
        <ul class="mt-2 flex flex-col gap-1 text-sm" data-testid="links">
          @if (f.label) {
            <li>
              <a
                class="underline"
                [href]="f.label.dailyMedUrl"
                target="_blank"
                rel="noopener noreferrer"
                >FDA label on DailyMed</a
              >
              @if (f.label.effectiveDate) {
                <span class="text-surface-600 dark:text-surface-300">
                  (dated {{ f.label.effectiveDate }})</span
                >
              }
            </li>
          }
          @for (m of f.medlinePlus; track m.url) {
            <li>
              <a class="underline" [href]="m.url" target="_blank" rel="noopener noreferrer"
                >MedlinePlus: {{ m.title }}</a
              >
            </li>
          }
        </ul>
      </section>

      <footer
        class="mt-10 border-t border-surface-200 pt-4 text-xs text-surface-600 dark:border-surface-800 dark:text-surface-300"
      >
        <p>
          Drug class and uses from RxClass (FDA and MED-RT). Summary from the FDA label via openFDA.
          Reports from FDA FAERS via openFDA.
        </p>
        <p class="mt-1">Not medical advice. Always confirm with your pharmacist or prescriber.</p>
      </footer>
    }
  `,
})
export default class DrugPage {
  private readonly store = inject(Store);
  private readonly rxcui$ = inject(ActivatedRoute).paramMap.pipe(
    map((params) => params.get('rxcui') ?? ''),
    distinctUntilChanged(),
  );

  /** Route parameter; the component is reused when navigating between drugs. */
  readonly rxcui = toSignal(this.rxcui$, { initialValue: '' });

  private readonly entities = this.store.selectSignal(drugInfoFeature.selectEntities);
  readonly entry = computed(() => this.entities()[this.rxcui()] ?? null);
  readonly facts = computed(() => this.entry()?.facts.data ?? null);
  readonly classes = computed(() => {
    const f = this.facts();
    return f ? [...new Set([...f.epcClasses, ...f.atcClasses])] : [];
  });
  /** "lisinopril" or "lisinopril and hydrochlorothiazide", for questions about the drug. */
  readonly drugName = computed(() => {
    const names = this.facts()?.ingredients.map((i) => i.name) ?? [];
    return names.length ? names.join(' and ') : 'it';
  });
  /** "10 MG · Oral Tablet · Zestril" */
  readonly details = computed(() => {
    const f = this.facts();
    return f ? [f.strength, f.doseForm, f.brandName].filter(Boolean).join(' · ') : '';
  });

  constructor() {
    // Open each drug as the route changes; leaving one (or the page) stops its polling.
    let current: string | null = null;
    this.rxcui$.pipe(takeUntilDestroyed()).subscribe((rxcui) => {
      if (current) this.store.dispatch(DrugInfoActions.leaveDrug({ rxcui: current }));
      current = rxcui;
      this.store.dispatch(DrugInfoActions.openDrug({ rxcui }));
    });
    inject(DestroyRef).onDestroy(() => {
      if (current) this.store.dispatch(DrugInfoActions.leaveDrug({ rxcui: current }));
    });
  }
}
