import { ChangeDetectionStrategy, Component, inject, input, signal } from '@angular/core';
import { Store } from '@ngrx/store';
import { MessageModule } from 'primeng/message';
import { TagModule } from 'primeng/tag';

import {
  evidenceQuery,
  pairKey,
  type InteractionLevel,
  type InteractionResult,
  type LabelEvidence,
} from './interaction';
import { InteractionsActions } from './store/interactions.actions';
import { interactionsFeature } from './store/interactions.reducer';

const TAGS: Record<
  InteractionLevel,
  { label: string; severity: 'danger' | 'warn' | 'info' | 'secondary' }
> = {
  Major: { label: 'Major', severity: 'danger' },
  Moderate: { label: 'Moderate', severity: 'warn' },
  Minor: { label: 'Minor', severity: 'info' },
  Unknown: { label: 'Not rated', severity: 'secondary' },
};

/** Interaction results with severity tags and expandable FDA label quotes. */
@Component({
  selector: 'app-interaction-list',
  imports: [MessageModule, TagModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ul class="flex flex-col gap-3">
      @for (result of results(); track key(result)) {
        @let k = key(result);
        @let tag = tags[result.level];
        <li
          class="rounded-lg border border-surface-200 p-4 dark:border-surface-800"
          [attr.data-level]="result.level"
          data-testid="interaction"
        >
          <div class="flex flex-wrap items-start justify-between gap-2">
            <div>
              <h3 class="font-semibold capitalize">
                {{ result.a.ingredient }} + {{ result.b.ingredient }}
              </h3>
              <p class="text-sm text-surface-600 dark:text-surface-300">
                {{ result.a.name }} · {{ result.b.name }}
              </p>
            </div>
            <p-tag [value]="tag.label" [severity]="tag.severity" />
          </div>
          @if (result.level === 'Unknown') {
            <p class="mt-2 text-sm">Listed in DDInter; severity not rated.</p>
          }

          <button
            type="button"
            data-testid="toggle-evidence"
            class="mt-2 text-sm font-medium text-primary-700 hover:underline dark:text-primary-300"
            [attr.aria-expanded]="open().has(k)"
            (click)="toggle(result)"
          >
            {{ open().has(k) ? 'Hide FDA label text' : 'Show FDA label text' }}
          </button>

          @if (open().has(k)) {
            @let entry = evidence()[k];
            <div class="mt-2 flex flex-col gap-3" data-testid="evidence">
              @if (!entry || entry.status === 'loading') {
                <p class="text-sm text-surface-600 dark:text-surface-300">Loading label text…</p>
              } @else if (entry.status === 'error') {
                <p-message severity="warn">{{ entry.error }}</p-message>
              } @else {
                @for (item of entry.items; track item.label) {
                  <section class="text-sm">
                    <h4 class="font-medium">{{ item.label }}</h4>
                    @if (item.missing) {
                      <p class="text-surface-600 dark:text-surface-300">
                        No FDA label with an interactions section was found for this product.
                      </p>
                    } @else {
                      @for (sentence of item.sentences; track $index) {
                        <blockquote
                          class="mt-1 border-l-4 border-surface-300 pl-3 dark:border-surface-700"
                        >
                          “{{ sentence }}”
                        </blockquote>
                      } @empty {
                        <p class="text-surface-600 dark:text-surface-300">
                          The label doesn’t mention the other drug by name. See the full
                          interactions section.
                        </p>
                      }
                      <p class="mt-1 text-xs text-surface-600 dark:text-surface-300">
                        {{ sourceLine(item) }} ·
                        <a
                          class="underline"
                          [href]="item.url"
                          target="_blank"
                          rel="noopener noreferrer"
                          >View on DailyMed</a
                        >
                      </p>
                    }
                  </section>
                }
              }
            </div>
          }
        </li>
      }
    </ul>
  `,
})
export class InteractionListComponent {
  private readonly store = inject(Store);

  readonly results = input.required<InteractionResult[]>();
  readonly evidence = this.store.selectSignal(interactionsFeature.selectEvidence);
  readonly open = signal(new Set<string>());

  protected readonly tags = TAGS;
  protected readonly key = pairKey;

  /** "FDA label: Maker, Sep 9, 2026" (calendar date, no timezone shift). */
  sourceLine(item: LabelEvidence): string {
    const date = item.effectiveDate
      ? new Date(`${item.effectiveDate}T00:00:00Z`).toLocaleDateString('en-US', {
          month: 'short',
          day: 'numeric',
          year: 'numeric',
          timeZone: 'UTC',
        })
      : null;
    return ['FDA label', [item.manufacturer, date].filter(Boolean).join(', ')]
      .filter(Boolean)
      .join(': ');
  }

  toggle(result: InteractionResult): void {
    const k = pairKey(result);
    const next = new Set(this.open());
    if (next.has(k)) {
      next.delete(k);
    } else {
      next.add(k);
      this.store.dispatch(
        InteractionsActions.loadEvidence({ key: k, query: evidenceQuery(result) }),
      );
    }
    this.open.set(next);
  }
}
