/**
 * Login and session checks for accounts. Routes, the auth middleware and the
 * admin CLI all go through here, so the rules live in one place.
 */
import { randomBytes } from 'node:crypto';

import { createError } from 'h3';

import { db } from '../db/client';
import { hashPassword, verifyPassword } from '../utils/password';
import { loginLimiter } from '../utils/rate-limit';
import type { AuthSession } from '../utils/session';
import { createUsersRepository, type User, type UsersRepository } from './repository';
import { normalizeUsername } from './username';

/** The signed-in user, as routes see it (event.context.user). */
export interface SessionUser {
  id: string;
  username: string;
}

declare module 'h3' {
  interface H3EventContext {
    /** Set by the auth middleware for every signed-in /api request; read it with requireUser. */
    user?: SessionUser;
  }
}

export const INVALID_LOGIN = 'Invalid username or password.';

type Limiter = Pick<typeof loginLimiter, 'isBlocked' | 'recordFailure' | 'reset'>;

export function createAccountsService({
  repo,
  limiter = loginLimiter,
}: {
  repo: UsersRepository;
  limiter?: Limiter;
}) {
  // Checked for unknown usernames, so they take as long as a wrong password.
  let dummyHash: Promise<string> | undefined;
  const dummy = () => (dummyHash ??= hashPassword(randomBytes(16).toString('hex')));

  return {
    /** The user for these credentials; throws 429 when limited, 401 otherwise. */
    async verifyLogin(usernameInput: string, password: string): Promise<User> {
      // Invalid names are counted too, under what was typed.
      const key = usernameInput.trim().toLowerCase();
      if (limiter.isBlocked(key)) {
        throw createError({ statusCode: 429, message: 'Too many attempts. Try again later.' });
      }
      const username = normalizeUsername(usernameInput);
      const user = username ? await repo.findByUsername(username) : null;
      const ok = await verifyPassword(password, user?.passwordHash ?? (await dummy()));
      if (!user || !ok) {
        limiter.recordFailure(key);
        throw createError({ statusCode: 401, message: INVALID_LOGIN });
      }
      limiter.reset(key);
      return user;
    },

    /** The session's user, or null when it has none, is gone, or was signed out everywhere. */
    async resolveSession(session: AuthSession): Promise<SessionUser | null> {
      if (typeof session.userId !== 'string' || typeof session.version !== 'number') return null;
      const user = await repo.findById(session.userId).catch(() => null);
      if (!user || user.sessionVersion !== session.version) return null;
      return { id: user.id, username: user.username };
    },
  };
}

export type AccountsService = ReturnType<typeof createAccountsService>;

let shared: AccountsService | undefined;

/** The app-wide service on the app database. */
export function accounts(): AccountsService {
  shared ??= createAccountsService({ repo: createUsersRepository(db()) });
  return shared;
}
