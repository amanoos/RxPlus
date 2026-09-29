import { useSession, type H3Event, type SessionConfig } from 'h3';

import { env } from './env';

/**
 * What the sealed cookie carries: the user and the session version it was
 * issued at (users.session_version). Sessions from before accounts carry
 * neither and are refused.
 */
export interface AuthSession {
  userId?: string;
  version?: number;
}

const THIRTY_DAYS = 30 * 24 * 60 * 60;

function sessionConfig(): SessionConfig {
  const { SESSION_SECRET, COOKIE_SECURE } = env();
  return {
    name: 'rxplus_session',
    password: SESSION_SECRET,
    maxAge: THIRTY_DAYS,
    // Cookie only: don't accept the session from a request header.
    sessionHeader: false,
    cookie: { httpOnly: true, sameSite: 'lax', secure: COOKIE_SECURE, path: '/' },
  };
}

export function authSession(event: H3Event) {
  return useSession<AuthSession>(event, sessionConfig());
}
