// @vitest-environment node
import { hashPassword } from '../utils/password';
import { createKeyedRateLimiter } from '../utils/rate-limit';
import type { User, UsersRepository } from './repository';
import { createAccountsService } from './service';

describe('accounts service', () => {
  let alice: User;
  const repo = {
    findByUsername: vi.fn(async (name: string) => (name === 'alice' ? alice : null)),
    findById: vi.fn(async (id: string) => (id === alice.id ? alice : null)),
  } as unknown as UsersRepository;
  const limiter = createKeyedRateLimiter({ max: 2, globalMax: 10, windowMs: 60_000 });
  const service = createAccountsService({ repo, limiter });

  beforeAll(async () => {
    alice = {
      id: 'user-1',
      username: 'alice',
      passwordHash: await hashPassword('correct-horse-battery'),
      sessionVersion: 3,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
  });
  beforeEach(() => limiter.clear());

  it('returns the user for the right password, whatever the case of the name', async () => {
    await expect(service.verifyLogin(' Alice', 'correct-horse-battery')).resolves.toBe(alice);
  });

  it('answers 401 for a wrong password, an unknown name and an invalid name', async () => {
    for (const name of ['alice', 'mallory', 'no spaces allowed']) {
      limiter.clear();
      await expect(service.verifyLogin(name, 'wrong-password')).rejects.toMatchObject({
        statusCode: 401,
      });
    }
  });

  it('answers 429 once the name is limited, even with the right password', async () => {
    await expect(service.verifyLogin('alice', 'x')).rejects.toMatchObject({ statusCode: 401 });
    await expect(service.verifyLogin('alice', 'x')).rejects.toMatchObject({ statusCode: 401 });
    await expect(service.verifyLogin('ALICE', 'correct-horse-battery')).rejects.toMatchObject({
      statusCode: 429,
    });
  });

  it('resolves a session only for an existing user at the current version', async () => {
    await expect(service.resolveSession({ userId: 'user-1', version: 3 })).resolves.toEqual({
      id: 'user-1',
      username: 'alice',
    });
    await expect(service.resolveSession({ userId: 'user-1', version: 2 })).resolves.toBeNull();
    await expect(service.resolveSession({ userId: 'user-2', version: 1 })).resolves.toBeNull();
    await expect(service.resolveSession({})).resolves.toBeNull();
    await expect(
      service.resolveSession({ authenticated: true } as unknown as { userId: string }),
    ).resolves.toBeNull();
  });
});
