import { DOCUMENT, isPlatformBrowser } from '@angular/common';
import { inject, Injectable, PLATFORM_ID, signal } from '@angular/core';

/** Where the chosen theme is remembered (this browser only). index.html reads it too. */
export const THEME_KEY = 'rxplus-theme';
const DARK_CLASS = 'app-dark';

/**
 * Light or dark. Until someone picks, it follows the OS setting; once they do,
 * the choice is saved and wins. The class on <html> is what everything styles
 * from (PrimeNG, Tailwind's dark: variant, styles.css); index.html sets it
 * before first paint, and this service keeps it in step afterwards.
 */
@Injectable({ providedIn: 'root' })
export class Theme {
  private readonly html = inject(DOCUMENT).documentElement;
  private readonly browser = isPlatformBrowser(inject(PLATFORM_ID));
  private readonly isDark = signal(false);
  readonly dark = this.isDark.asReadonly();

  constructor() {
    if (!this.browser) return;
    this.isDark.set(this.html.classList.contains(DARK_CLASS));
    // Follow the OS while nothing has been chosen (matchMedia is missing in some test DOMs).
    globalThis.matchMedia?.('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
      if (!this.saved()) this.apply(e.matches);
    });
  }

  toggle(): void {
    const dark = !this.isDark();
    this.apply(dark);
    try {
      localStorage.setItem(THEME_KEY, dark ? 'dark' : 'light');
    } catch {
      // Storage blocked (private mode): the switch still works for this page.
    }
  }

  private apply(dark: boolean): void {
    this.html.classList.toggle(DARK_CLASS, dark);
    this.isDark.set(dark);
  }

  private saved(): string | null {
    try {
      return localStorage.getItem(THEME_KEY);
    } catch {
      return null;
    }
  }
}
