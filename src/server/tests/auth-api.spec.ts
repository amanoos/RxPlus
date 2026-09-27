// @vitest-environment node
// Lives outside routes/ and middleware/: Nitro turns every file there into a handler.
import { createApp, createRouter, toWebHandler } from 'h3';

import authMiddleware from '../middleware/auth';
import login from '../routes/api/auth/login.post';
import logout from '../routes/api/auth/logout.post';
import me from '../routes/api/auth/me.get';
import health from '../routes/api/health.get';
import { hashPassword } from '../utils/password';
import { loginLimiter } from '../utils/rate-limit';

const PASSWORD = 'correct-horse-battery';

async function createHandler() {
  process.env['DATABASE_URL'] = 'postgres://u:p@localhost:1/none';
  process.env['APP_PASSWORD_HASH'] = await hashPassword(PASSWORD);
  process.env['SESSION_SECRET'] = 'a'.repeat(32);
  process.env['COOKIE_SECURE'] = 'false';

  const router = createRouter()
    .post('/api/auth/login', login)
    .post('/api/auth/logout', logout)
    .get('/api/auth/me', me)
    .get('/api/health', health)
    .get('/api/private', () => ({ secret: true }));
  return toWebHandler(createApp().use(authMiddleware).use(router));
}

describe('auth API', () => {
  let handle: Awaited<ReturnType<typeof createHandler>>;
  const request = (path: string, init: RequestInit = {}) =>
    handle(new Request(`http://localhost${path}`, init));
  const loginWith = (password: unknown) =>
    request('/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ password }),
    });
  const cookieFrom = (res: Response) => res.headers.get('set-cookie')?.split(';')[0] ?? '';

  beforeAll(async () => {
    handle = await createHandler();
  });
  beforeEach(() => loginLimiter.reset());

  it('logs in with the right password and sets a hardened session cookie', async () => {
    const res = await loginWith(PASSWORD);
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
  });

  it('rejects a wrong password with a generic 401', async () => {
    const res = await loginWith('wrong-password');
    expect(res.status).toBe(401);
    expect(res.headers.get('set-cookie')).toBeNull();
    expect(await res.text()).not.toContain('wrong-password');
  });

  it('rejects a malformed body with 400', async () => {
    expect((await loginWith(42)).status).toBe(400);
  });

  it('returns 429 on the sixth failed attempt, even with the right password', async () => {
    for (let i = 0; i < 5; i++) expect((await loginWith('nope')).status).toBe(401);
    expect((await loginWith('nope')).status).toBe(429);
    expect((await loginWith(PASSWORD)).status).toBe(429);
  });

  it('reports the session through /me and clears it on logout', async () => {
    expect((await request('/api/auth/me')).status).toBe(401);

    const cookie = cookieFrom(await loginWith(PASSWORD));
    const meRes = await request('/api/auth/me', { headers: { cookie } });
    expect(meRes.status).toBe(200);
    expect(await meRes.json()).toEqual({ authenticated: true });

    const out = await request('/api/auth/logout', { method: 'POST', headers: { cookie } });
    expect(out.status).toBe(204);
    const cleared = cookieFrom(out);
    expect((await request('/api/auth/me', { headers: { cookie: cleared } })).status).toBe(401);
  });

  it('protects every other /api route but leaves login and health public', async () => {
    expect((await request('/api/private')).status).toBe(401);
    expect((await request('/api/health')).status).toBe(503);

    const cookie = cookieFrom(await loginWith(PASSWORD));
    expect((await request('/api/private', { headers: { cookie } })).status).toBe(200);
  });

  it('ignores a forged session cookie', async () => {
    const res = await request('/api/private', { headers: { cookie: 'rxplus_session=forged' } });
    expect(res.status).toBe(401);
  });
});
