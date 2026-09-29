// @vitest-environment node
// Lives outside routes/ and middleware/: Nitro turns every file there into a handler.
import { sql } from 'drizzle-orm';
import { createApp, createRouter, defineEventHandler, toWebHandler } from 'h3';

import { createUsersRepository } from '../accounts/repository';
import { createDb } from '../db/client';
import { runMigrations } from '../db/migrate';
import authMiddleware from '../middleware/auth';
import login from '../routes/api/auth/login.post';
import logout from '../routes/api/auth/logout.post';
import me from '../routes/api/auth/me.get';
import health from '../routes/api/health.get';
import { requireUser } from '../utils/auth-user';
import { hashPassword } from '../utils/password';
import { loginLimiter } from '../utils/rate-limit';
import { authSession } from '../utils/session';

// Requires: npm run db:test:up
const TEST_DB =
  process.env['TEST_DATABASE_URL'] ?? 'postgres://rxplus:rxplus@localhost:5433/rxplus_test';
const ALICE_PASSWORD = 'correct-horse-battery';
const BOB_PASSWORD = 'staple-battery-horse';

describe('auth API (integration)', () => {
  const { db, pool } = createDb(TEST_DB);
  const users = createUsersRepository(db);
  let handle: (req: Request) => Promise<Response>;

  const request = (path: string, init: RequestInit = {}) =>
    handle(new Request(`http://localhost${path}`, init));
  const loginWith = (username: unknown, password: unknown) =>
    request('/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
  const cookieFrom = (res: Response) => res.headers.get('set-cookie')?.split(';')[0] ?? '';
  const signIn = async (username: string, password: string) =>
    cookieFrom(await loginWith(username, password));
  const meWith = (cookie: string) => request('/api/auth/me', { headers: { cookie } });

  beforeAll(async () => {
    process.env['DATABASE_URL'] = TEST_DB;
    process.env['SESSION_SECRET'] = 'a'.repeat(32);
    process.env['COOKIE_SECURE'] = 'false';
    await runMigrations(TEST_DB, 'drizzle');

    const router = createRouter()
      .post('/api/auth/login', login)
      .post('/api/auth/logout', logout)
      .get('/api/auth/me', me)
      .get('/api/health', health)
      .get(
        '/api/private',
        defineEventHandler((event) => ({ user: requireUser(event).username })),
      )
      // A session as the single-user app issued it, before accounts existed.
      .get(
        '/legacy-session',
        defineEventHandler(async (event) => {
          await (await authSession(event)).update({ authenticated: true } as never);
          return 'ok';
        }),
      );
    handle = toWebHandler(createApp().use(authMiddleware).use(router));
  });
  beforeEach(async () => {
    loginLimiter.clear();
    await db.execute(sql`truncate table users cascade`);
    await users.create('alice', await hashPassword(ALICE_PASSWORD));
    await users.create('bob', await hashPassword(BOB_PASSWORD));
  });
  afterAll(async () => {
    await pool.end();
  });

  it('signs in case-insensitively and sets a hardened session cookie', async () => {
    const res = await loginWith('  Alice ', ALICE_PASSWORD);
    expect(res.status).toBe(204);
    const cookie = res.headers.get('set-cookie') ?? '';
    expect(cookie).toMatch(/^rxplus_session=/);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
    // h3 sets Expires (not Max-Age) and also enforces the TTL inside the sealed session.
    const expires = Date.parse(/Expires=([^;]+)/i.exec(cookie)?.[1] ?? '');
    const thirtyDays = 30 * 24 * 60 * 60 * 1000;
    expect(Math.abs(expires - (Date.now() + thirtyDays))).toBeLessThan(60_000);
    expect(cookie).not.toMatch(/Secure/i);

    const meRes = await meWith(cookieFrom(res));
    expect(meRes.status).toBe(200);
    expect(await meRes.json()).toEqual({
      authenticated: true,
      user: { id: expect.any(String), username: 'alice' },
    });
  });

  it('answers a wrong password and an unknown username the same way', async () => {
    const wrong = await loginWith('alice', 'wrong-password');
    const unknown = await loginWith('mallory', 'wrong-password');
    const bodies = [];
    for (const res of [wrong, unknown]) {
      expect(res.status).toBe(401);
      expect(res.headers.get('set-cookie')).toBeNull();
      bodies.push(await res.text());
    }
    expect(bodies[0]).toBe(bodies[1]);
    expect(bodies[0]).not.toContain('wrong-password');
  });

  it('checks a hash for unknown usernames too, so timing does not tell them apart', async () => {
    const time = async (username: string) => {
      const start = performance.now();
      await loginWith(username, 'wrong-password');
      return performance.now() - start;
    };
    await time('mallory'); // the dummy hash is made on first use
    const known = await time('alice');
    const unknown = await time('mallory');
    expect(unknown).toBeGreaterThan(known * 0.3);
  });

  it('rejects a malformed body with 400', async () => {
    expect((await loginWith(42, ALICE_PASSWORD)).status).toBe(400);
    expect((await loginWith('alice', '')).status).toBe(400);
  });

  it('limits failures per username, leaving others free', async () => {
    for (let i = 0; i < 5; i++) expect((await loginWith('alice', 'nope')).status).toBe(401);
    expect((await loginWith('alice', 'nope')).status).toBe(429);
    expect((await loginWith('ALICE', ALICE_PASSWORD)).status).toBe(429);
    expect((await loginWith('bob', BOB_PASSWORD)).status).toBe(204);
  });

  // 21 sign-ins, each checking a scrypt hash on purpose: about 2.5 s, so more room than 5 s.
  it(
    'blocks everyone once failures across usernames reach the global cap',
    {
      timeout: 15_000,
    },
    async () => {
      for (let i = 0; i < 20; i++) await loginWith(`guess${i}`, 'nope');
      expect((await loginWith('bob', BOB_PASSWORD)).status).toBe(429);
    },
  );

  it('keeps two users signed in at once, and logout ends only that browser', async () => {
    const alicePhone = await signIn('alice', ALICE_PASSWORD);
    const aliceLaptop = await signIn('alice', ALICE_PASSWORD);
    const bob = await signIn('bob', BOB_PASSWORD);
    const bobRes = await request('/api/private', { headers: { cookie: bob } });
    expect(await bobRes.json()).toEqual({ user: 'bob' });

    const out = await request('/api/auth/logout', {
      method: 'POST',
      headers: { cookie: alicePhone },
    });
    expect(out.status).toBe(204);
    expect((await meWith(cookieFrom(out))).status).toBe(401);
    expect((await meWith(aliceLaptop)).status).toBe(200);
    expect((await meWith(bob)).status).toBe(200);
  });

  it('ends every session of a user whose password is reset or who is removed', async () => {
    const alice = await signIn('alice', ALICE_PASSWORD);
    const bob = await signIn('bob', BOB_PASSWORD);

    await users.resetPassword('alice', await hashPassword('a-brand-new-password'));
    expect((await meWith(alice)).status).toBe(401);
    expect((await loginWith('alice', ALICE_PASSWORD)).status).toBe(401);
    expect((await loginWith('alice', 'a-brand-new-password')).status).toBe(204);

    await users.remove('bob');
    expect((await meWith(bob)).status).toBe(401);
    expect((await loginWith('bob', BOB_PASSWORD)).status).toBe(401);
  });

  it('refuses a session from before accounts, and a forged cookie', async () => {
    const legacy = cookieFrom(await request('/legacy-session'));
    expect(legacy).toMatch(/^rxplus_session=/);
    expect((await meWith(legacy)).status).toBe(401);
    expect((await meWith('rxplus_session=forged')).status).toBe(401);
  });

  it('protects every other /api route but leaves login and health public', async () => {
    expect((await request('/api/private')).status).toBe(401);
    expect((await request('/api/health')).status).toBe(200);
  });
});
