import { TestBed } from '@angular/core/testing';

import { ThemeToggleComponent } from './theme-toggle.component';

describe('ThemeToggleComponent', () => {
  beforeEach(() => {
    document.documentElement.classList.remove('app-dark');
    localStorage.clear();
  });

  it('says which theme it switches to, and switches', async () => {
    const fixture = TestBed.createComponent(ThemeToggleComponent);
    await fixture.whenStable();
    const button = (fixture.nativeElement as HTMLElement).querySelector('button')!;
    expect(button.getAttribute('aria-label')).toBe('Switch to dark theme');

    button.click();
    await fixture.whenStable();
    expect(document.documentElement.classList.contains('app-dark')).toBe(true);
    expect(button.getAttribute('aria-label')).toBe('Switch to light theme');
  });
});
