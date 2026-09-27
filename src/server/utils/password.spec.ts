// @vitest-environment node
import { hashPassword, verifyPassword } from './password';

describe('password hashing', () => {
  it('produces the env-compatible format', async () => {
    const hash = await hashPassword('correct horse battery staple');
    expect(hash).toMatch(/^scrypt:\d+:[\w-]+:[\w-]+$/);
  });

  it('uses a random salt', async () => {
    expect(await hashPassword('same')).not.toEqual(await hashPassword('same'));
  });

  it('verifies the right password and rejects a wrong one', async () => {
    const hash = await hashPassword('s3cret-pass');
    expect(await verifyPassword('s3cret-pass', hash)).toBe(true);
    expect(await verifyPassword('s3cret-pasS', hash)).toBe(false);
    expect(await verifyPassword('', hash)).toBe(false);
  });

  it('rejects a tampered hash', async () => {
    const hash = await hashPassword('s3cret-pass');
    const parts = hash.split(':');
    parts[3] = parts[3].slice(0, -2) + (parts[3].endsWith('AA') ? 'BB' : 'AA');
    expect(await verifyPassword('s3cret-pass', parts.join(':'))).toBe(false);
  });

  it.each(['', 'plaintext', 'scrypt:abc:salt:hash', 'bcrypt:1:a:b', 'scrypt:16384:salt'])(
    'returns false for malformed hash %j',
    async (bad) => {
      expect(await verifyPassword('anything', bad)).toBe(false);
    },
  );
});
