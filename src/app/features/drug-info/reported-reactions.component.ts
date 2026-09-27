import { DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { MessageModule } from 'primeng/message';

import type { ReportedReactions } from './drug-info';
import type { LoadStatus } from './store/drug-info.reducer';

/** FAERS: most-reported reactions per ingredient as a bar list, disclaimer always shown. */
@Component({
  selector: 'app-reported-reactions',
  imports: [DecimalPipe, MessageModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section aria-labelledby="faers-heading">
      <h2 id="faers-heading" class="text-lg font-semibold">Reported to the FDA</h2>
      <p class="mt-1 text-sm text-surface-600 dark:text-surface-300" data-testid="faers-disclaimer">
        {{ reactions()?.disclaimer ?? disclaimer }}
      </p>

      @switch (status()) {
        @case ('error') {
          <p-message severity="warn" styleClass="mt-3">{{ error() }}</p-message>
        }
        @case ('loaded') {
          @for (item of reactions()?.ingredients; track item.ingredient) {
            <div class="mt-4" data-testid="faers-ingredient">
              <h3 class="text-sm font-medium">
                <span class="capitalize">{{ item.ingredient }}</span
                >: {{ item.total | number }} reports
              </h3>
              @if (item.reactions.length) {
                <ul class="mt-2 flex flex-col gap-1.5">
                  @for (r of item.reactions; track r.term) {
                    <li class="grid grid-cols-[minmax(7rem,12rem)_1fr] items-center gap-2 text-sm">
                      <span data-testid="term">{{ termLabel(r.term) }}</span>
                      <span class="flex items-center gap-2">
                        <span
                          aria-hidden="true"
                          class="h-2.5 rounded-sm bg-primary-400 dark:bg-primary-500"
                          [style.width.%]="barWidth(r.count, item.reactions[0].count)"
                        ></span>
                        <span
                          data-testid="count"
                          class="text-xs text-surface-600 dark:text-surface-300"
                          >{{ r.count | number }}</span
                        >
                      </span>
                    </li>
                  }
                </ul>
              } @else {
                <p class="mt-1 text-sm">No reports found.</p>
              }
            </div>
          }
        }
        @default {
          <p class="mt-3 text-sm">Loading reports…</p>
        }
      }
    </section>
  `,
})
export class ReportedReactionsComponent {
  readonly reactions = input<ReportedReactions | null>(null);
  readonly status = input<LoadStatus>('idle');
  readonly error = input<string | null>(null);

  /** Shown before the response arrives, so the caveat is never missing. */
  readonly disclaimer =
    'Reports submitted to the FDA by patients and professionals. A report doesn’t prove the ' +
    'drug caused the reaction, and counts aren’t how often it happens.';

  /** MedDRA terms arrive upper-case: "DRUG INEFFECTIVE" → "Drug ineffective". */
  termLabel(term: string): string {
    const lower = term.toLowerCase();
    return lower.charAt(0).toUpperCase() + lower.slice(1);
  }

  /** Bar length relative to the top reaction (at least a sliver so it stays visible). */
  barWidth(count: number, max: number): number {
    return max ? Math.max(2, Math.round((count / max) * 100)) : 0;
  }
}
