import { ChangeDetectionStrategy, Component, input } from '@angular/core';

export type IconName = 'capsule' | 'interactions' | 'arrow-right' | 'sun' | 'moon';

/** Line icons drawn for RxPlus (24×24, currentColor). Decorative: hidden from screen readers. */
@Component({
  selector: 'app-icon',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { 'aria-hidden': 'true', class: 'inline-flex' },
  template: `
    <svg
      viewBox="0 0 24 24"
      [attr.class]="size()"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      @switch (name()) {
        @case ('capsule') {
          <rect x="3" y="8.5" width="18" height="7" rx="3.5" transform="rotate(-45 12 12)" />
          <path d="M9.5 9.5l5 5" />
        }
        @case ('interactions') {
          <!-- Two overlapping circles: two drugs meeting. -->
          <circle cx="9" cy="12" r="5.5" />
          <circle cx="15" cy="12" r="5.5" />
        }
        @case ('arrow-right') {
          <path d="M5 12h14M13 6l6 6-6 6" />
        }
        @case ('sun') {
          <circle cx="12" cy="12" r="4" />
          <path
            d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"
          />
        }
        @case ('moon') {
          <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" />
        }
      }
    </svg>
  `,
})
export class IconComponent {
  readonly name = input.required<IconName>();
  /** Tailwind size classes for the svg. */
  readonly size = input('h-5 w-5');
}
