// @vitest-environment node
import { hashPassword } from '../utils/password';

/** Loads the provider factory with a fresh module registry, so env() is parsed anew. */
async function choiceFor(overrides: Record<string, string | undefined>) {
  vi.resetModules();
  const saved = { ...process.env };
  Object.assign(process.env, {
    DATABASE_URL: 'postgres://x@localhost/x',
    APP_PASSWORD_HASH: await hashPassword('irrelevant-password'),
    SESSION_SECRET: 's'.repeat(32),
  });
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  for (const key of [
    'SUMMARY_PROVIDER',
    'OLLAMA_MODEL',
    'OLLAMA_CHECK_MODEL',
    'ANTHROPIC_API_KEY',
  ]) {
    if (!(key in overrides)) delete process.env[key];
  }
  try {
    const { takeawayProvider } = await import('./providers');
    return takeawayProvider();
  } finally {
    process.env = saved;
  }
}

describe('takeawayProvider', () => {
  it('uses the local model, with the support check only when a check model is set', async () => {
    const plain = await choiceFor({ OLLAMA_MODEL: 'qwen2.5:7b' });
    expect(plain.provider).toMatchObject({ name: 'ollama', model: 'qwen2.5:7b' });
    expect(plain.provider?.checkSupport).toBeUndefined();

    const checked = await choiceFor({
      OLLAMA_MODEL: 'qwen2.5:7b',
      OLLAMA_CHECK_MODEL: 'qwen2.5:14b',
    });
    expect(checked.provider?.checkSupport).toBeTypeOf('function');
  });

  it('explains what is missing', async () => {
    expect((await choiceFor({})).unavailable).toBe('No local model configured (OLLAMA_MODEL).');
    expect((await choiceFor({ SUMMARY_PROVIDER: 'claude' })).unavailable).toBe(
      'Claude takeaways need an API key (ANTHROPIC_API_KEY).',
    );
  });

  it('uses Claude when chosen and a key is set', async () => {
    const choice = await choiceFor({ SUMMARY_PROVIDER: 'claude', ANTHROPIC_API_KEY: 'test-key' });
    expect(choice.provider).toMatchObject({ name: 'claude', model: 'claude-opus-5' });
  });
});
