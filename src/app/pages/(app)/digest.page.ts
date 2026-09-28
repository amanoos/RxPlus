import { ChangeDetectionStrategy, Component, inject, OnDestroy, OnInit } from '@angular/core';
import { RouteMeta } from '@analogjs/router';
import { Store } from '@ngrx/store';
import { ButtonModule } from 'primeng/button';
import { MessageModule } from 'primeng/message';

import type { Digest } from '../../features/digest/digest';
import { DigestViewComponent, formatDay } from '../../features/digest/digest-view.component';
import { DigestActions } from '../../features/digest/store/digest.actions';
import { digestFeature } from '../../features/digest/store/digest.reducer';

export const routeMeta: RouteMeta = { title: 'What’s new · RxPlus' };

const time = (iso: string, options: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat('en-US', options).format(new Date(iso));

@Component({
  selector: 'app-digest-page',
  imports: [ButtonModule, MessageModule, DigestViewComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="flex flex-wrap items-center gap-3">
      <h1 class="text-2xl font-semibold">What’s new</h1>
      <p-button
        label="Run now"
        size="small"
        severity="secondary"
        class="ml-auto"
        [loading]="busy()"
        [disabled]="busy()"
        data-testid="run-now"
        (onClick)="run()"
      />
    </div>
    <p class="mt-1 text-sm text-surface-600 dark:text-surface-300">
      New research, trial news, newly listed drugs for your conditions, and FDA label changes for
      the medications you take, collected weekly.
    </p>

    @let data = state.data();
    <p class="mt-3 text-sm" data-testid="digest-status" aria-live="polite">
      @if (data?.running; as running) {
        Collecting this week’s news… started {{ clock(running.startedAt) }}.
      } @else if (data) {
        Next digest: {{ nextRun(data.nextRun) }}.
      }
    </p>
    @if (state.timedOut()) {
      <p class="mt-1 text-sm text-surface-600 dark:text-surface-300" data-testid="timed-out">
        Still collecting. Reload the page later to see it.
      </p>
    }
    @if (state.error(); as error) {
      <p-message severity="error" styleClass="mt-3" data-testid="digest-error">{{
        error
      }}</p-message>
    }

    @if (state.status() === 'loading') {
      <p class="mt-6 text-sm">Loading…</p>
    } @else if (data) {
      @if (!data.hasActiveMedications) {
        <p class="mt-6 text-sm" data-testid="no-medications">
          You have no active medications, so there’s nothing to follow. Add one on the Medications
          page.
        </p>
      } @else if (!data.digests.length && !data.running) {
        <p class="mt-6 text-sm" data-testid="no-digests">
          No digest yet. The first one arrives {{ nextRun(data.nextRun) }}, or press Run now.
        </p>
      }

      <div class="mt-6 flex flex-col gap-4">
        @for (digest of data.digests; track digest.id; let first = $first) {
          <details
            class="rounded border border-surface-200 p-4 dark:border-surface-700"
            [open]="first"
            data-testid="digest"
          >
            <summary class="cursor-pointer font-semibold">
              {{ title(digest) }}
              @if (digest.unread) {
                <span class="ml-2 text-xs font-normal text-primary-700 dark:text-primary-300"
                  >{{ digest.unread }} new</span
                >
              }
            </summary>
            <div class="mt-4">
              <app-digest-view
                [digest]="digest"
                [canRetry]="first"
                [busy]="busy()"
                (retry)="run()"
              />
            </div>
          </details>
        }
      </div>
    }
  `,
})
export default class DigestPage implements OnInit, OnDestroy {
  private readonly store = inject(Store);
  protected readonly state = {
    status: this.store.selectSignal(digestFeature.selectStatus),
    data: this.store.selectSignal(digestFeature.selectData),
    error: this.store.selectSignal(digestFeature.selectError),
    starting: this.store.selectSignal(digestFeature.selectStarting),
    timedOut: this.store.selectSignal(digestFeature.selectTimedOut),
  };

  ngOnInit(): void {
    this.store.dispatch(DigestActions.open());
  }

  ngOnDestroy(): void {
    this.store.dispatch(DigestActions.leave());
  }

  busy(): boolean {
    return this.state.starting() || !!this.state.data()?.running;
  }

  run(): void {
    this.store.dispatch(DigestActions.run());
  }

  /** "Week of Sep 21: 4 items" (or why it failed). */
  title(digest: Digest): string {
    const week = `Week of ${formatDay(digest.windowStart, false)}`;
    if (digest.status === 'failed') return `${week}: couldn’t be collected`;
    const n = digest.itemCount;
    return `${week}: ${n === 0 ? 'nothing new' : `${n} ${n === 1 ? 'item' : 'items'}`}`;
  }

  /** "6:00 AM" */
  clock(iso: string): string {
    return time(iso, { hour: 'numeric', minute: '2-digit' });
  }

  /** "Monday, Oct 5, 6:00 AM" */
  nextRun(iso: string): string {
    return time(iso, {
      weekday: 'long',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  }
}
