// @vitest-environment node
import { EnvError, parseEnv } from './env';

const valid = {
  DATABASE_URL: 'postgres://rxplus:pw@db:5432/rxplus',
  APP_PASSWORD_HASH: 'scrypt:16384:c2FsdHNhbHRzYWx0c2FsdA:aGFzaGhhc2hoYXNoaGFzaGhhc2hoYXNo',
  SESSION_SECRET: 'x'.repeat(32),
};

describe('parseEnv', () => {
  it('accepts a valid environment and applies defaults', () => {
    expect(parseEnv(valid)).toEqual({
      ...valid,
      COOKIE_SECURE: false,
      PORT: 3000,
      TZ: 'America/New_York',
      RXNAV_BASE_URL: 'https://rxnav.nlm.nih.gov/REST',
      OPENFDA_BASE_URL: 'https://api.fda.gov/drug',
    });
  });

  it('parses optional values', () => {
    const env = parseEnv({ ...valid, COOKIE_SECURE: 'true', PORT: '8080', TZ: 'UTC' });
    expect(env).toMatchObject({ COOKIE_SECURE: true, PORT: 8080, TZ: 'UTC' });
  });

  it('names every missing required variable', () => {
    expect(() => parseEnv({})).toThrowError(EnvError);
    try {
      parseEnv({});
    } catch (e) {
      const message = (e as Error).message;
      expect(message).toContain('DATABASE_URL');
      expect(message).toContain('APP_PASSWORD_HASH');
      expect(message).toContain('SESSION_SECRET');
    }
  });

  it('rejects a short session secret without printing it', () => {
    const secret = 'too-short-secret-value';
    expect(() => parseEnv({ ...valid, SESSION_SECRET: secret })).toThrowError(/SESSION_SECRET/);
    expect(() => parseEnv({ ...valid, SESSION_SECRET: secret })).not.toThrowError(secret);
  });

  it('rejects malformed values', () => {
    expect(() => parseEnv({ ...valid, DATABASE_URL: 'mysql://x' })).toThrowError(/DATABASE_URL/);
    expect(() => parseEnv({ ...valid, APP_PASSWORD_HASH: 'plaintext' })).toThrowError(
      /APP_PASSWORD_HASH/,
    );
    expect(() => parseEnv({ ...valid, COOKIE_SECURE: 'yes' })).toThrowError(/COOKIE_SECURE/);
    expect(() => parseEnv({ ...valid, PORT: '0' })).toThrowError(/PORT/);
    expect(() => parseEnv({ ...valid, TZ: 'Mars/Olympus' })).toThrowError(/TZ/);
    expect(() => parseEnv({ ...valid, RXNAV_BASE_URL: 'ftp://x' })).toThrowError(/RXNAV_BASE_URL/);
  });
});
