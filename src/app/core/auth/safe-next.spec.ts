import { safeNext } from './safe-next';

describe('safeNext', () => {
  it.each([
    ['/digest', '/digest'],
    ['/medications?tab=all#top', '/medications?tab=all#top'],
    ['/', '/'],
  ])('keeps same-origin path %j', (input, expected) => {
    expect(safeNext(input)).toBe(expected);
  });

  it.each([
    [null],
    [undefined],
    [''],
    ['digest'],
    ['//evil.example'],
    ['/\\evil.example'],
    ['https://evil.example/'],
    ['javascript:alert(1)'],
    ['/login'],
    ['/login?next=/x'],
    [' /digest'],
  ])('falls back to / for %j', (input) => {
    expect(safeNext(input)).toBe('/');
  });
});
