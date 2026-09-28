import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { TagModule } from 'primeng/tag';

import type { Paper, StudyType } from './literature';

const STUDY_TYPES: Record<StudyType, string> = {
  'meta-analysis': 'Meta-analysis',
  'systematic-review': 'Systematic review',
  rct: 'Randomized trial',
  other: 'Study',
};

/** Papers with their AI takeaway, each followed by the abstract sentence it rewrites. */
@Component({
  selector: 'app-paper-list',
  imports: [TagModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ul class="flex flex-col gap-4">
      @for (paper of papers(); track paper.pmid) {
        <li data-testid="paper" [attr.data-pmid]="paper.pmid">
          <div class="flex flex-wrap items-center gap-2 text-xs">
            <p-tag [value]="studyType(paper.studyType)" severity="secondary" />
            <span class="text-surface-600 dark:text-surface-300">
              {{ source(paper) }}
            </span>
            @if (action(); as a) {
              <button
                type="button"
                class="ml-auto text-xs text-surface-600 hover:underline dark:text-surface-300"
                [attr.aria-label]="(a === 'hide' ? 'Hide: ' : 'Show again: ') + paper.title"
                data-testid="paper-action"
                (click)="act.emit(paper.pmid)"
              >
                {{ a === 'hide' ? 'Hide' : 'Show again' }}
              </button>
            }
          </div>
          <a
            class="mt-1 block font-medium hover:underline"
            [href]="paper.pubmedUrl"
            target="_blank"
            rel="noopener noreferrer"
            data-testid="paper-title"
            >{{ paper.title }}</a
          >
          @if (paper.fullTextUrl) {
            <a
              class="text-xs underline"
              [href]="paper.fullTextUrl"
              target="_blank"
              rel="noopener noreferrer"
              data-testid="full-text"
              >Free full text</a
            >
          }

          @let t = paper.takeaway;
          @if (!t) {
            @if (writing()) {
              <p class="mt-1 text-sm text-surface-600 italic dark:text-surface-300">
                Writing a takeaway…
              </p>
            }
          } @else if (t.text) {
            <div class="mt-2 text-sm" data-testid="takeaway">
              @if (t.uncited) {
                <p>
                  <span
                    class="underline decoration-surface-400 decoration-dotted underline-offset-4"
                    >{{ t.text }}</span
                  >
                  <span class="ml-1 text-xs text-surface-600 dark:text-surface-300"
                    >(not linked to the abstract)</span
                  >
                </p>
              } @else {
                <p>{{ t.text }}</p>
                <blockquote
                  class="mt-1 border-l-2 border-surface-300 pl-2 text-surface-700 dark:border-surface-600 dark:text-surface-300"
                  data-testid="takeaway-quote"
                >
                  <span class="text-xs font-medium">In the study:</span>&ngsp;
                  <span class="italic">“{{ t.quote }}”</span>
                </blockquote>
                @if (t.supported === false) {
                  <p
                    class="mt-1 text-xs text-orange-700 dark:text-orange-300"
                    data-testid="not-supported"
                  >
                    The quote shown doesn’t back up all of this.
                  </p>
                }
              }
            </div>
          }
        </li>
      }
    </ul>
  `,
})
export class PaperListComponent {
  readonly papers = input.required<Paper[]>();
  /** Takeaways are being written right now. */
  readonly writing = input(false);
  /** Button on each paper: hide it, or show a hidden one again. */
  readonly action = input<'hide' | 'unhide' | null>(null);
  /** The PMID whose button was pressed. */
  readonly act = output<string>();

  /** "Circulation · 1999" */
  source(paper: Paper): string {
    return [paper.journal, paper.year].filter((part) => part != null && part !== '').join(' · ');
  }

  studyType(type: StudyType): string {
    return STUDY_TYPES[type];
  }
}
