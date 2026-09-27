import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  inject,
  input,
  signal,
} from '@angular/core';
import { Store } from '@ngrx/store';
import { ButtonModule } from 'primeng/button';
import { MessageModule } from 'primeng/message';
import { PopoverModule } from 'primeng/popover';

import { LABEL_SECTION_NAMES, type SummaryCitation, type DrugSummary } from './drug-info';
import { DrugInfoActions } from './store/drug-info.actions';
import type { SummaryState } from './store/drug-info.reducer';

interface Marker {
  n: number;
  citation: SummaryCitation;
}

/** The AI summary of the FDA label: every sentence linked to the label text it came from. */
@Component({
  selector: 'app-summary-panel',
  imports: [ButtonModule, MessageModule, PopoverModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section aria-labelledby="summary-heading" data-testid="summary-panel">
      <h2 id="summary-heading" class="text-lg font-semibold">Plain-language summary</h2>

      @let s = state();
      @if (s.error && s.status !== 'failed' && s.status !== 'error') {
        <p-message severity="warn" styleClass="mt-3" data-testid="summary-start-error">{{
          s.error
        }}</p-message>
      }

      @switch (s.status) {
        @case ('none') {
          <p class="mt-2 text-sm">
            An AI model can summarize this product’s FDA label in plain language, with each sentence
            linked to the label text it’s based on. With the local model this takes a few minutes.
          </p>
          <p-button
            styleClass="mt-3"
            label="Summarize the FDA label"
            [loading]="s.starting"
            data-testid="start-summary"
            (onClick)="start()"
          />
        }
        @case ('pending') {
          <p class="mt-2 text-sm" role="status" data-testid="summary-pending">
            Summarizing the FDA label…
            @if (elapsed(); as e) {
              <span class="text-surface-600 dark:text-surface-300">{{ e }} elapsed</span>
            }
          </p>
          @if (s.timedOut) {
            <p-message severity="warn" styleClass="mt-3" data-testid="summary-timeout">
              This is taking longer than expected. Reload the page later to see the result.
            </p-message>
          }
        }
        @case ('failed') {
          <p-message severity="error" styleClass="mt-3" data-testid="summary-failed">
            The summary couldn’t be written: {{ s.data?.error ?? s.error }}
          </p-message>
          <p-button
            styleClass="mt-3"
            label="Try again"
            severity="secondary"
            [loading]="s.starting"
            data-testid="retry-summary"
            (onClick)="start()"
          />
          @if (s.error && s.error !== s.data?.error) {
            <p-message severity="warn" styleClass="mt-3">{{ s.error }}</p-message>
          }
        }
        @case ('error') {
          <p-message severity="warn" styleClass="mt-3" data-testid="summary-error">{{
            s.error
          }}</p-message>
        }
        @case ('ready') {
          @if (s.data; as summary) {
            @if (summary.lowCitation) {
              <p-message severity="warn" styleClass="mt-3" data-testid="low-citation">
                Several sentences couldn’t be linked to the label. Treat them with extra care.
              </p-message>
            }
            @for (section of sections(); track section.heading) {
              <h3 class="mt-4 font-medium">{{ section.heading }}</h3>
              <ul class="mt-1 flex flex-col gap-1 text-sm">
                @for (sentence of section.sentences; track $index) {
                  <li data-testid="summary-sentence">
                    @if (sentence.noSupport) {
                      <span class="text-surface-600 italic dark:text-surface-300">{{
                        sentence.text
                      }}</span>
                    } @else if (sentence.uncited) {
                      <span
                        class="underline decoration-surface-400 decoration-dotted underline-offset-4"
                        data-testid="uncited"
                        >{{ sentence.text }}</span
                      >
                      <span class="ml-1 text-xs text-surface-600 dark:text-surface-300"
                        >(not linked to the label)</span
                      >
                    } @else {
                      <span>{{ sentence.text }}</span>
                      @for (m of sentence.markers; track m.n) {
                        <button
                          type="button"
                          class="ml-0.5 align-super text-xs font-medium text-primary-700 hover:underline dark:text-primary-300"
                          [attr.aria-label]="'Source ' + m.n + ': ' + sectionName(m.citation)"
                          [attr.aria-expanded]="selected()?.n === m.n"
                          data-testid="citation-marker"
                          (click)="showCitation($event, m, op)"
                        >
                          [{{ m.n }}]
                        </button>
                      }
                    }
                  </li>
                } @empty {
                  <!-- Every sentence was removed (e.g. as medication advice). -->
                  <li
                    class="text-surface-600 italic dark:text-surface-300"
                    data-testid="empty-section"
                  >
                    Nothing to show for this section.
                    <a
                      class="underline"
                      [href]="summary.label.dailyMedUrl"
                      target="_blank"
                      rel="noopener noreferrer"
                      >See the full label on DailyMed</a
                    >.
                  </li>
                }
              </ul>
            }
            @if (summary.removedAdvice) {
              <p class="mt-3 text-xs text-surface-600 dark:text-surface-300">
                {{ summary.removedAdvice }}
                {{ summary.removedAdvice === 1 ? 'sentence' : 'sentences' }} giving medication
                advice {{ summary.removedAdvice === 1 ? 'was' : 'were' }} removed.
              </p>
            }

            <p-popover #op (onHide)="selected.set(null)">
              @if (selected(); as m) {
                <div class="max-w-sm text-sm" data-testid="citation-popover">
                  <p class="font-medium">{{ sectionName(m.citation) }}</p>
                  <blockquote class="mt-1 border-l-2 border-surface-300 pl-2 italic">
                    “{{ m.citation.text }}”
                  </blockquote>
                  <a
                    class="mt-2 inline-block text-xs underline"
                    [href]="summary.label.dailyMedUrl"
                    target="_blank"
                    rel="noopener noreferrer"
                    >Read the full label on DailyMed</a
                  >
                </div>
              }
            </p-popover>

            <footer
              class="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-surface-200 pt-3 text-xs text-surface-600 dark:border-surface-800 dark:text-surface-300"
            >
              <p data-testid="summary-footer">{{ footer(summary) }}</p>
              <p-button
                label="Check for a newer label"
                size="small"
                severity="secondary"
                [text]="true"
                [loading]="s.checking"
                data-testid="check-label"
                (onClick)="start(true)"
              />
            </footer>
            @if (s.upToDate) {
              <p class="mt-1 text-xs" role="status" data-testid="up-to-date">
                This summary is for the newest FDA label.
              </p>
            }
          }
        }
        @default {
          <p class="mt-2 text-sm">Loading summary…</p>
        }
      }
    </section>
  `,
})
export class SummaryPanelComponent {
  private readonly store = inject(Store);

  readonly rxcui = input.required<string>();
  readonly state = input.required<SummaryState>();

  readonly selected = signal<Marker | null>(null);
  /** Ticks every second in the browser (never during SSR, which must settle). */
  private readonly now = signal(Date.now());

  /** Sentences with citation markers numbered across the whole summary. */
  readonly sections = computed(() => {
    let n = 0;
    return (this.state().data?.sections ?? []).map((section) => ({
      heading: section.heading,
      sentences: section.sentences.map((s) => ({
        ...s,
        markers: s.citations.map((citation) => ({ n: ++n, citation })),
      })),
    }));
  });

  readonly elapsed = computed(() => {
    const startedAt = this.state().data?.startedAt;
    if (!startedAt) return null;
    const seconds = Math.max(0, Math.floor((this.now() - Date.parse(startedAt)) / 1000));
    return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
  });

  constructor() {
    const destroyRef = inject(DestroyRef);
    afterNextRender(() => {
      const timer = setInterval(() => this.now.set(Date.now()), 1000);
      destroyRef.onDestroy(() => clearInterval(timer));
    });
  }

  start(refresh = false): void {
    this.store.dispatch(DrugInfoActions.startSummary({ rxcui: this.rxcui(), refresh }));
  }

  showCitation(event: Event, marker: Marker, popover: { toggle(e: Event): void }): void {
    this.selected.set(marker);
    popover.toggle(event);
  }

  sectionName(citation: SummaryCitation): string {
    return LABEL_SECTION_NAMES[citation.labelSection] ?? citation.labelSection;
  }

  footer(summary: DrugSummary): string {
    const where = summary.provider === 'ollama' ? 'local' : 'Claude';
    const dated = summary.label.effectiveDate ? ` dated ${summary.label.effectiveDate}` : '';
    return (
      `Summary written by AI (${summary.model}, ${where}) from the FDA label${dated}. ` +
      'Check anything important with your pharmacist.'
    );
  }
}
