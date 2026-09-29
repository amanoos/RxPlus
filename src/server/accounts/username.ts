/**
 * Usernames are case-insensitive: stored and looked up trimmed and lowercased.
 * 3–32 characters of a–z 0–9 . _ -, starting with a letter or digit.
 */
const USERNAME = /^[a-z0-9][a-z0-9._-]{2,31}$/;

export const USERNAME_RULES =
  'Usernames are 3–32 characters: letters, digits, ".", "_" or "-", starting with a letter or digit.';

/** The stored form of a username, or null when it breaks the rules. */
export function normalizeUsername(input: string): string | null {
  const name = input.trim().toLowerCase();
  return USERNAME.test(name) ? name : null;
}

/** Minimum password length for new and reset passwords. */
export const MIN_PASSWORD_LENGTH = 12;
