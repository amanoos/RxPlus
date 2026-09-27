import { ChangeDetectionStrategy, Component } from '@angular/core';
import { ButtonModule } from 'primeng/button';

@Component({
  selector: 'app-home-page',
  imports: [ButtonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main class="mx-auto flex min-h-screen max-w-3xl flex-col items-start justify-center gap-6 p-4">
      <h1 class="text-3xl font-semibold">RxPlus</h1>
      <p class="text-surface-600 dark:text-surface-300">Your personal medication watchlist.</p>
      <p-button label="Get started" />
    </main>
  `,
})
export default class HomePage {}
