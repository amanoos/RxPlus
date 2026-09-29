// @vitest-environment node
import { EnvError, ignoredSettings, parseEnv } from './env';

const valid = {
  DATABASE_URL: 'postgres://rxplus:pw@db:5432/rxplus',
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
      PUBMED_BASE_URL: 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils',
      CTGOV_BASE_URL: 'https://clinicaltrials.gov/api/v2',
      COSTPLUS_BASE_URL: 'https://us-central1-costplusdrugs-publicapi.cloudfunctions.net/main',
      MEDLINEPLUS_BASE_URL: 'https://connect.medlineplus.gov/service',
      SUMMARY_PROVIDER: 'ollama',
      OLLAMA_BASE_URL: 'http://127.0.0.1:11434',
      OLLAMA_NUM_CTX: 16384,
      OLLAMA_TIMEOUT_MS: 600000,
      JEV_PROVIDER: 'typesafe',
      JEV_TIMEOUT_MS: 30000,
      AI_DAILY_LIMIT: 20,
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
    expect(() => parseEnv({ ...valid, COOKIE_SECURE: 'yes' })).toThrowError(/COOKIE_SECURE/);
    expect(() => parseEnv({ ...valid, PORT: '0' })).toThrowError(/PORT/);
    expect(() => parseEnv({ ...valid, TZ: 'Mars/Olympus' })).toThrowError(/TZ/);
    expect(() => parseEnv({ ...valid, RXNAV_BASE_URL: 'ftp://x' })).toThrowError(/RXNAV_BASE_URL/);
    expect(() => parseEnv({ ...valid, SUMMARY_PROVIDER: 'gpt' })).toThrowError(/SUMMARY_PROVIDER/);
    expect(() => parseEnv({ ...valid, OLLAMA_NUM_CTX: '512' })).toThrowError(/OLLAMA_NUM_CTX/);
    expect(() => parseEnv({ ...valid, NCBI_EMAIL: 'not-an-email' })).toThrowError(/NCBI_EMAIL/);
  });

  it('no longer needs APP_PASSWORD_HASH, and notes a leftover one', () => {
    expect(parseEnv({ ...valid, APP_PASSWORD_HASH: 'plaintext' })).not.toHaveProperty(
      'APP_PASSWORD_HASH',
    );
    expect(ignoredSettings({ APP_PASSWORD_HASH: 'scrypt:1:a:b' })).toEqual([
      expect.stringContaining('APP_PASSWORD_HASH is ignored'),
    ]);
    expect(ignoredSettings({})).toEqual([]);
  });
});
