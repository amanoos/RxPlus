import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TagModule } from 'primeng/tag';

import type { Alternative } from './alternatives';

/** Alternative drugs: link to each drug's page, approval year, generic availability. */
@Component({
  selector: 'app-alternative-list',
  imports: [RouterLink, TagModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ul class="flex flex-col gap-2">
      @for (drug of drugs(); track drug.ingredientRxcui) {
        <li
          class="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm"
          data-testid="alternative"
          [attr.data-rxcui]="drug.ingredientRxcui"
        >
          @if (drug.productRxcui) {
            <a
              class="font-medium capitalize hover:underline"
              [routerLink]="['/drugs', drug.productRxcui]"
              data-testid="alternative-link"
              >{{ drug.name }}</a
            >
          } @else {
            <span class="font-medium capitalize">{{ drug.name }}</span>
          }
          @if (drug.isNew) {
            <p-tag
              [value]="'New (' + drug.approvedYear + ')'"
              severity="success"
              data-testid="new-tag"
            />
          }
          <span class="text-xs text-surface-600 dark:text-surface-300">
            @if (drug.approvedYear) {
              First approved {{ drug.approvedYear }} ·
            }
            {{ drug.genericAvailable ? 'Generic available' : 'No generic yet' }}
          </span>
          @if (action(); as a) {
            <button
              type="button"
              class="ml-auto text-xs text-surface-600 hover:underline dark:text-surface-300"
              [attr.aria-label]="(a === 'hide' ? 'Hide: ' : 'Show again: ') + drug.name"
              data-testid="alternative-action"
              (click)="act.emit(drug.ingredientRxcui)"
            >
              {{ a === 'hide' ? 'Hide' : 'Show again' }}
            </button>
          }
        </li>
      }
    </ul>
  `,
})
export class AlternativeListComponent {
  readonly drugs = input.required<Alternative[]>();
  readonly action = input<'hide' | 'unhide' | null>(null);
  /** The ingredient RXCUI whose button was pressed. */
  readonly act = output<string>();
}
