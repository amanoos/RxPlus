// @vitest-environment node
import { verifyPassword } from '../utils/password';
import { runUserCommand, type CliIo } from './cli';
import type { User, UsersRepository } from './repository';

function fakeRepo() {
  const users = new Map<string, User>();
  const repo = {
    findByUsername: vi.fn(async (name: string) => users.get(name) ?? null),
    create: vi.fn(async (username: string, passwordHash: string) => {
      const user = {
        id: `id-${username}`,
        username,
        passwordHash,
        sessionVersion: 1,
        createdAt: new Date('2026-09-28T12:00:00Z'),
        updatedAt: new Date(),
      };
      users.set(username, user);
      return user;
    }),
    resetPassword: vi.fn(async (username: string, passwordHash: string) => {
      const user = users.get(username);
      if (user)
        users.set(username, { ...user, passwordHash, sessionVersion: user.sessionVersion + 1 });
      return !!user;
    }),
    remove: vi.fn(async (username: string) => users.delete(username)),
    list: vi.fn(async () =>
      [...users.values()].map(({ username, createdAt }) => ({ username, createdAt })),
    ),
  };
  return { users, repo: repo as unknown as UsersRepository & typeof repo };
}

function fakeIo(answers: { password?: string; ask?: string } = {}) {
  const out: string[] = [];
  const err: string[] = [];
  const io: CliIo = {
    readPassword: vi.fn(async () => answers.password ?? ''),
    ask: vi.fn(async () => answers.ask ?? ''),
    out: (line) => out.push(line),
    err: (line) => err.push(line),
  };
  return { io, out, err };
}

const PASSWORD = 'correct-horse-battery';

describe('user CLI', () => {
  it('adds a user with a hashed password, never printing it', async () => {
    const { users, repo } = fakeRepo();
    const { io, out } = fakeIo({ password: PASSWORD });
    expect(await runUserCommand(['add', 'Alice'], repo, io)).toBe(0);
    const alice = users.get('alice')!;
    expect(await verifyPassword(PASSWORD, alice.passwordHash)).toBe(true);
    expect(out.join('\n')).toBe('Created alice.');
  });

  it('refuses a taken name, a bad name and a short password', async () => {
    const { repo } = fakeRepo();
    await runUserCommand(['add', 'alice'], repo, fakeIo({ password: PASSWORD }).io);

    const taken = fakeIo({ password: PASSWORD });
    expect(await runUserCommand(['add', 'alice'], repo, taken.io)).toBe(1);
    expect(taken.err.join()).toContain('already exists');
    expect(taken.io.readPassword).not.toHaveBeenCalled();

    const bad = fakeIo({ password: PASSWORD });
    expect(await runUserCommand(['add', 'a b'], repo, bad.io)).toBe(1);
    expect(bad.err.join()).toContain('3–32 characters');

    const short = fakeIo({ password: 'short' });
    expect(await runUserCommand(['add', 'bob'], repo, short.io)).toBe(1);
    expect(short.err.join()).toContain('at least 12 characters');
    expect(repo.create).toHaveBeenCalledTimes(1);
  });

  it('resets a password, and reports an unknown user', async () => {
    const { users, repo } = fakeRepo();
    await runUserCommand(['add', 'alice'], repo, fakeIo({ password: PASSWORD }).io);
    const reset = fakeIo({ password: 'a-brand-new-password' });
    expect(await runUserCommand(['reset-password', 'alice'], repo, reset.io)).toBe(0);
    expect(users.get('alice')!.sessionVersion).toBe(2);
    expect(await verifyPassword('a-brand-new-password', users.get('alice')!.passwordHash)).toBe(
      true,
    );

    const missing = fakeIo({ password: PASSWORD });
    expect(await runUserCommand(['reset-password', 'bob'], repo, missing.io)).toBe(1);
    expect(missing.err.join()).toContain('No account named "bob"');
  });

  it('removes only after the name is typed, or with --yes', async () => {
    const { users, repo } = fakeRepo();
    for (const name of ['alice', 'bob']) {
      await runUserCommand(['add', name], repo, fakeIo({ password: PASSWORD }).io);
    }

    const wrong = fakeIo({ ask: 'bob' });
    expect(await runUserCommand(['remove', 'alice'], repo, wrong.io)).toBe(1);
    expect(users.has('alice')).toBe(true);

    expect(await runUserCommand(['remove', 'alice'], repo, fakeIo({ ask: ' Alice ' }).io)).toBe(0);
    expect(users.has('alice')).toBe(false);

    const yes = fakeIo();
    expect(await runUserCommand(['remove', 'bob', '--yes'], repo, yes.io)).toBe(0);
    expect(yes.io.ask).not.toHaveBeenCalled();
    expect(users.size).toBe(0);
  });

  it('lists names and dates only', async () => {
    const { repo } = fakeRepo();
    const empty = fakeIo();
    await runUserCommand(['list'], repo, empty.io);
    expect(empty.out).toEqual(['No accounts yet.']);

    await runUserCommand(['add', 'alice'], repo, fakeIo({ password: PASSWORD }).io);
    const listed = fakeIo();
    expect(await runUserCommand(['list'], repo, listed.io)).toBe(0);
    expect(listed.out).toEqual(['alice\tcreated 2026-09-28']);
  });

  it('prints usage for a missing or unknown command or option', async () => {
    const { repo } = fakeRepo();
    for (const argv of [[], ['frobnicate', 'alice'], ['add'], ['add', 'alice', '--yes']]) {
      const { io, err } = fakeIo();
      expect(await runUserCommand(argv, repo, io)).toBe(1);
      expect(err.join()).toContain('Usage: user <command>');
    }
  });
});
