// @vitest-environment node
import { normalizeUsername } from './username';

describe('normalizeUsername', () => {
  it('trims and lowercases', () => {
    expect(normalizeUsername('  Alice ')).toBe('alice');
    expect(normalizeUsername('Bob.Smith_2-x')).toBe('bob.smith_2-x');
  });

  it('allows 3 to 32 characters, starting with a letter or digit', () => {
    expect(normalizeUsername('abc')).toBe('abc');
    expect(normalizeUsername('9lives')).toBe('9lives');
    expect(normalizeUsername('a'.repeat(32))).toBe('a'.repeat(32));
    expect(normalizeUsername('ab')).toBeNull();
    expect(normalizeUsername('a'.repeat(33))).toBeNull();
    expect(normalizeUsername('.alice')).toBeNull();
    expect(normalizeUsername('-alice')).toBeNull();
  });

  it('rejects spaces and other characters', () => {
    expect(normalizeUsername('al ice')).toBeNull();
    expect(normalizeUsername('alice@home')).toBeNull();
    expect(normalizeUsername('álice')).toBeNull();
    expect(normalizeUsername('')).toBeNull();
  });
});
