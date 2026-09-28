import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TagModule } from 'primeng/tag';

import type { Medication } from './medication';

@Component({
  selector: 'app-medication-card',
  imports: [DatePipe, RouterLink, TagModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @let med = medication();
    <article
      class="flex flex-col gap-3 rounded-lg border border-surface-200 p-4 dark:border-surface-800"
      [attr.aria-labelledby]="'med-' + med.id"
    >
      <div class="flex flex-col gap-2">
        <h3 [id]="'med-' + med.id" class="text-base font-semibold leading-snug">
          {{ med.name }}
        </h3>
        <div class="flex flex-wrap gap-2">
          @if (med.strength) {
            <p-tag [value]="med.strength" severity="info" />
          }
          @if (med.doseForm) {
            <p-tag [value]="med.doseForm" severity="secondary" />
          }
          @if (med.brandName) {
            <p-tag [value]="med.brandName" severity="contrast" />
          }
        </div>
      </div>

      @if (med.startedOn || med.stoppedOn) {
        <p class="text-sm text-surface-600 dark:text-surface-300">
          <!-- YYYY-MM-DD dates are calendar days: format in UTC so they don't shift. -->
          @if (med.startedOn) {
            <span>Started {{ med.startedOn | date: 'mediumDate' : 'UTC' }}</span>
          }
          @if (med.startedOn && med.stoppedOn) {
            <span aria-hidden="true"> · </span>
          }
          @if (med.stoppedOn) {
            <span>Stopped {{ med.stoppedOn | date: 'mediumDate' : 'UTC' }}</span>
          }
        </p>
      }

      @if (med.takenForName) {
        <p class="text-sm" data-testid="taken-for">For: {{ med.takenForName }}</p>
      }

      @if (med.notes) {
        <p data-testid="notes" class="whitespace-pre-line text-sm">{{ med.notes }}</p>
      }

      <a
        [routerLink]="['/drugs', med.rxcui]"
        class="self-start text-sm font-medium text-primary-700 hover:underline dark:text-primary-300"
        data-testid="about-drug"
        >About this drug</a
      >

      <ng-content />
    </article>
  `,
})
export class MedicationCardComponent {
  readonly medication = input.required<Medication>();
}
