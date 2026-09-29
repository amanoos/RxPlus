import { TestBed } from '@angular/core/testing';

import { Theme, THEME_KEY } from './theme';

describe('Theme', () => {
  const html = document.documentElement;

  beforeEach(() => {
    html.classList.remove('app-dark');
    localStorage.clear();
    TestBed.resetTestingModule();
  });

  it('starts from the class index.html set before paint', () => {
    html.classList.add('app-dark');
    expect(TestBed.inject(Theme).dark()).toBe(true);
  });

  it('toggles the class on <html> and remembers the choice', () => {
    const theme = TestBed.inject(Theme);
    expect(theme.dark()).toBe(false);

    theme.toggle();
    expect(theme.dark()).toBe(true);
    expect(html.classList.contains('app-dark')).toBe(true);
    expect(localStorage.getItem(THEME_KEY)).toBe('dark');

    theme.toggle();
    expect(html.classList.contains('app-dark')).toBe(false);
    expect(localStorage.getItem(THEME_KEY)).toBe('light');
  });

  it('still switches when storage is blocked', () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    const theme = TestBed.inject(Theme);
    theme.toggle();
    expect(html.classList.contains('app-dark')).toBe(true);
    setItem.mockRestore();
  });
});
