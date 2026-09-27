import { isPlatformBrowser } from '@angular/common';
import {
  afterNextRender,
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

import type { IngredientLiterature } from './literature';
import { PaperListComponent } from './paper-list.component';
import { LiteratureActions } from './store/literature.actions';
import { literatureFeature } from './store/literature.reducer';

/**
 * The drug page's Research section: papers and trials per ingredient. Loaded in
 * the browser only, so server rendering never waits on a first PubMed search.
 */
@Component({
  selector: 'app-research-section',
  imports: [ButtonModule, MessageModule, PaperListComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section aria-labelledby="research-heading" data-testid="research">
      <h2 id="research-heading" class="text-lg font-semibold">Research</h2>
      <p class="mt-1 text-sm text-surface-600 dark:text-surface-300">
        The strongest published evidence: systematic reviews and meta-analyses first, then
        randomized trials.
      </p>

      @let e = entry();
      @if (e?.startError) {
        <p-message severity="warn" styleClass="mt-3" data-testid="takeaways-start-error">{{
          e?.startError
        }}</p-message>
      }

      @if (!e || (e.status === 'loading' && !e.data)) {
        <p class="mt-3 text-sm">Finding research… this takes a few seconds the first time.</p>
      } @else if (e.status === 'error' && !e.data) {
        <p-message severity="warn" styleClass="mt-3" data-testid="research-error">{{
          e.error
        }}</p-message>
      } @else {
        @for (lit of e.data?.ingredients ?? []; track lit.rxcui) {
          <div class="mt-4" data-testid="research-ingredient">
            @if (multiple()) {
              <h3 class="font-medium capitalize">{{ lit.name }}</h3>
            }
            @switch (lit.takeaways.status) {
              @case ('pending') {
                <p class="mt-1 text-sm" role="status" data-testid="takeaways-pending">
                  Writing plain-language takeaways…
                  @if (elapsed(lit); as t) {
                    <span class="text-surface-600 dark:text-surface-300">{{ t }} elapsed</span>
                  }
                </p>
                @if (e.timedOut) {
                  <p-message severity="warn" styleClass="mt-2">
                    This is taking longer than expected. Reload the page later to see them.
                  </p-message>
                }
              }
              @case ('failed') {
                <p-message severity="warn" styleClass="mt-2" data-testid="takeaways-failed">
                  Takeaways couldn’t be written: {{ lit.takeaways.error }}
                </p-message>
                <p-button
                  styleClass="mt-2"
                  label="Try again"
                  size="small"
                  severity="secondary"
                  [loading]="e.starting"
                  data-testid="retry-takeaways"
                  (onClick)="startTakeaways()"
                />
              }
            }

            @if (lit.papers.length) {
              <div class="mt-3">
                <app-paper-list
                  [papers]="lit.papers"
                  [writing]="lit.takeaways.status === 'pending'"
                />
              </div>
            } @else {
              <p class="mt-2 text-sm">No reviews or randomized trials with abstracts were found.</p>
            }
          </div>
        }
      }
    </section>
  `,
})
export class ResearchSectionComponent {
  private readonly store = inject(Store);

  /** Product RXCUI of the drug page. */
  readonly rxcui = input.required<string>();

  private readonly entities = this.store.selectSignal(literatureFeature.selectEntities);
  readonly entry = computed(() => this.entities()[this.rxcui()] ?? null);
  readonly multiple = computed(() => (this.entry()?.data?.ingredients.length ?? 0) > 1);

  /** Ticks every second in the browser (never during SSR, which must settle). */
  private readonly now = signal(Date.now());

  constructor() {
    const browser = isPlatformBrowser(inject(PLATFORM_ID));
    let opened: string | null = null;
    effect(() => {
      const rxcui = this.rxcui();
      if (!browser) return;
      untracked(() => {
        if (opened) this.store.dispatch(LiteratureActions.leaveResearch({ rxcui: opened }));
        opened = rxcui;
        this.store.dispatch(LiteratureActions.openResearch({ rxcui }));
      });
    });
    const destroyRef = inject(DestroyRef);
    destroyRef.onDestroy(() => {
      if (opened) this.store.dispatch(LiteratureActions.leaveResearch({ rxcui: opened }));
    });
    afterNextRender(() => {
      const timer = setInterval(() => this.now.set(Date.now()), 1000);
      destroyRef.onDestroy(() => clearInterval(timer));
    });
  }

  elapsed(lit: IngredientLiterature): string | null {
    const startedAt = lit.takeaways.startedAt;
    if (!startedAt) return null;
    const seconds = Math.max(0, Math.floor((this.now() - Date.parse(startedAt)) / 1000));
    return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
  }

  startTakeaways(): void {
    this.store.dispatch(LiteratureActions.startTakeaways({ rxcui: this.rxcui() }));
  }
}
