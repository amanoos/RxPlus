import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { TagModule } from 'primeng/tag';

import type { Trial } from './literature';

/** "PHASE2/PHASE3" → "Phase 2/3", "EARLY_PHASE1" → "Early phase 1", "NA" → "". */
export function phaseLabel(phases: string[]): string {
  const parts = phases
    .filter((p) => p !== 'NA')
    .map((p) => (p === 'EARLY_PHASE1' ? 'Early phase 1' : p.replace(/^PHASE(\d)$/, 'Phase $1')));
  if (parts.length === 2 && parts.every((p) => /^Phase \d$/.test(p))) {
    return `Phase ${parts[0].slice(6)}/${parts[1].slice(6)}`;
  }
  return parts.join(', ');
}

/** Clinical trials from ClinicalTrials.gov: completed with results, then recruiting. */
@Component({
  selector: 'app-trial-list',
  imports: [TagModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ul class="flex flex-col gap-3">
      @for (trial of trials(); track trial.nctId) {
        <li data-testid="trial">
          <div class="flex flex-wrap items-center gap-2 text-xs">
            @if (trial.status === 'RECRUITING') {
              <p-tag value="Recruiting" severity="info" />
            } @else if (trial.status === 'COMPLETED') {
              <p-tag
                [value]="trial.hasResults ? 'Completed · results posted' : 'Completed'"
                severity="success"
              />
            } @else {
              <p-tag [value]="trial.status" severity="secondary" />
            }
            @if (phase(trial); as p) {
              <span class="text-surface-600 dark:text-surface-300" data-testid="trial-phase">{{
                p
              }}</span>
            }
            <span class="text-surface-600 dark:text-surface-300">{{ trial.nctId }}</span>
          </div>
          <a
            class="mt-1 block text-sm font-medium hover:underline"
            [href]="trial.url"
            target="_blank"
            rel="noopener noreferrer"
            data-testid="trial-title"
            >{{ trial.title }}</a
          >
        </li>
      }
    </ul>
  `,
})
export class TrialListComponent {
  readonly trials = input.required<Trial[]>();

  phase(trial: Trial): string {
    return phaseLabel(trial.phases);
  }
}
