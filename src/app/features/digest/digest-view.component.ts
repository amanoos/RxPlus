import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ButtonModule } from 'primeng/button';
import { MessageModule } from 'primeng/message';
import { TagModule } from 'primeng/tag';

import type { Digest, DigestItem } from './digest';

/** "Sep 15, 2026" for a YYYY-MM-DD date, whatever the viewer's time zone. */
export function formatDay(date: string, withYear = true): string {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    ...(withYear ? { year: 'numeric' } : {}),
    timeZone: 'UTC',
  }).format(new Date(`${date.slice(0, 10)}T00:00:00Z`));
}

/** One digest: its news grouped by drug, or why it failed. */
@Component({
  selector: 'app-digest-view',
  imports: [RouterLink, ButtonModule, MessageModule, TagModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @let d = digest();
    @if (d.status === 'failed') {
      <p-message severity="error" data-testid="digest-failed">
        <div class="flex flex-wrap items-center gap-3">
          <span>This digest couldn’t be collected: {{ d.error }}</span>
          @if (canRetry()) {
            <p-button
              label="Try again"
              size="small"
              severity="secondary"
              [disabled]="busy()"
              data-testid="try-again"
              (onClick)="retry.emit()"
            />
          }
        </div>
      </p-message>
    } @else if (!d.groups.length) {
      <p class="text-sm text-surface-600 dark:text-surface-300" data-testid="digest-empty">
        Nothing new this week for your medications.
      </p>
    }

    @for (group of d.groups; track group.subject) {
      <section class="mt-4 first:mt-0" [attr.aria-label]="group.subject" data-testid="digest-group">
        <h3 class="font-semibold capitalize">{{ group.subject }}</h3>
        <ul class="mt-2 flex flex-col gap-3">
          @for (item of group.items; track item.id) {
            <li
              class="border-l-2 pl-3"
              [class]="
                item.read ? 'border-transparent' : 'border-primary-500 dark:border-primary-400'
              "
              [attr.data-kind]="item.kind"
              [attr.data-unread]="!item.read || null"
              data-testid="digest-item"
            >
              @if (!item.read) {
                <span class="sr-only">New:</span>&ngsp;
              }
              @switch (item.kind) {
                @case ('paper') {
                  <a
                    class="font-medium hover:underline"
                    [href]="item.url"
                    target="_blank"
                    rel="noopener noreferrer"
                    >{{ item.title }}</a
                  >
                  @if (source(item); as s) {
                    <p class="text-xs text-surface-600 dark:text-surface-300">{{ s }}</p>
                  }
                  @if (item.takeaway?.text) {
                    <div class="mt-1 text-sm" data-testid="takeaway">
                      @if (item.takeaway!.uncited) {
                        <p>
                          <span
                            class="underline decoration-surface-400 decoration-dotted underline-offset-4"
                            >{{ item.takeaway!.text }}</span
                          >&ngsp;
                          <span class="ml-1 text-xs text-surface-600 dark:text-surface-300"
                            >(not linked to the abstract)</span
                          >
                        </p>
                      } @else {
                        <p>{{ item.takeaway!.text }}</p>
                        <blockquote
                          class="mt-1 border-l-2 border-surface-300 pl-2 text-surface-700 dark:border-surface-600 dark:text-surface-300"
                          data-testid="takeaway-quote"
                        >
                          <span class="text-xs font-medium">In the study:</span>&ngsp;
                          <span class="italic">“{{ item.takeaway!.quote }}”</span>
                        </blockquote>
                      }
                    </div>
                  }
                }
                @case ('more-papers') {
                  <a
                    class="text-sm underline"
                    [href]="item.url"
                    target="_blank"
                    rel="noopener noreferrer"
                    >and {{ item.details?.count }} more on PubMed</a
                  >
                }
                @case ('trial') {
                  <div class="flex flex-wrap items-center gap-2 text-xs">
                    <p-tag
                      [value]="item.details?.event === 'results' ? 'Results posted' : 'New trial'"
                      [severity]="item.details?.event === 'results' ? 'success' : 'info'"
                    />&ngsp;
                    <span class="text-surface-600 dark:text-surface-300">{{
                      item.details?.nctId
                    }}</span>
                  </div>
                  <a
                    class="mt-1 block font-medium hover:underline"
                    [href]="item.url"
                    target="_blank"
                    rel="noopener noreferrer"
                    >{{ item.title }}</a
                  >
                }
                @case ('approval') {
                  <p class="text-sm">
                    Newly listed for {{ item.details?.condition }}:
                    <a class="font-medium underline" [routerLink]="item.url">{{ item.title }}</a>
                    @if (item.details?.firstApproved; as approved) {
                      <span> (approved {{ approved.slice(0, 4) }})</span>
                    }
                  </p>
                }
                @case ('label') {
                  <p class="text-sm">
                    <a class="font-medium underline" [routerLink]="item.url">{{ item.title }}</a>
                    @if (item.details?.labelDate; as date) {
                      <span>, dated {{ day(date) }}</span>
                    }
                  </p>
                  @if (item.details?.dailyMedUrl; as dailyMed) {
                    <a
                      class="text-xs underline"
                      [href]="dailyMed"
                      target="_blank"
                      rel="noopener noreferrer"
                      >Read it on DailyMed</a
                    >
                  }
                }
              }
            </li>
          }
        </ul>
      </section>
    }

    @if (d.notes.length) {
      <ul class="mt-4 text-xs text-surface-600 dark:text-surface-300" data-testid="digest-notes">
        @for (note of d.notes; track note) {
          <li>{{ note }}</li>
        }
      </ul>
    }
  `,
})
export class DigestViewComponent {
  readonly digest = input.required<Digest>();
  /** Offer "Try again" on a failed digest (the latest one). */
  readonly canRetry = input(false);
  /** A run is starting or going. */
  readonly busy = input(false);
  readonly retry = output<void>();

  /** "Hypertension · 2026" */
  source(item: DigestItem): string {
    const { journal, year } = item.details ?? {};
    return [journal, year].filter((part) => part != null && part !== '').join(' · ');
  }

  day(date: string): string {
    return formatDay(date);
  }
}
