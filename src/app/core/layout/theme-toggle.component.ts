import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';

import { IconComponent } from '../../shared/ui/icon.component';
import { Theme } from '../theme';

/** Switches between the light and dark themes; the label says which one it switches to. */
@Component({
  selector: 'app-theme-toggle',
  imports: [IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <button
      type="button"
      class="inline-flex h-9 w-9 items-center justify-center rounded-full text-surface-600 hover:bg-primary-50 hover:text-primary-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600 dark:text-surface-300 dark:hover:bg-surface-800 dark:hover:text-primary-300"
      [attr.aria-label]="label()"
      [title]="label()"
      data-testid="theme-toggle"
      (click)="theme.toggle()"
    >
      <app-icon [name]="theme.dark() ? 'sun' : 'moon'" />
    </button>
  `,
})
export class ThemeToggleComponent {
  protected readonly theme = inject(Theme);
  protected readonly label = computed(() =>
    this.theme.dark() ? 'Switch to light theme' : 'Switch to dark theme',
  );
}
