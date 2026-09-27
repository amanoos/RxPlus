import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

// Format: scrypt:<N>:<salt>:<hash>, salt and hash in base64url.
// Colons (not `$`) so Docker Compose and dotenv don't interpolate the value.
const COST = 2 ** 15;
const BLOCK_SIZE = 8;
const KEY_LENGTH = 32;
const MAX_COST = 2 ** 20;

function derive(password: string, salt: Buffer, cost: number): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    scrypt(
      password.normalize('NFKC'),
      salt,
      KEY_LENGTH,
      { N: cost, r: BLOCK_SIZE, p: 1, maxmem: 256 * cost * BLOCK_SIZE },
      (error, key) => (error ? reject(error) : resolve(key)),
    ),
  );
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await derive(password, salt, COST);
  return `scrypt:${COST}:${salt.toString('base64url')}:${key.toString('base64url')}`;
}

/** Constant-time check. Returns false (never throws) for a malformed stored hash. */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, costText, saltText, keyText, ...rest] = stored.split(':');
  const cost = Number(costText);
  const isPowerOfTwo = Number.isInteger(cost) && cost > 1 && (cost & (cost - 1)) === 0;
  if (scheme !== 'scrypt' || rest.length || !isPowerOfTwo || cost > MAX_COST) return false;
  if (!saltText || !keyText) return false;

  const expected = Buffer.from(keyText, 'base64url');
  if (expected.length !== KEY_LENGTH) return false;

  const actual = await derive(password, Buffer.from(saltText, 'base64url'), cost);
  return timingSafeEqual(actual, expected);
}
