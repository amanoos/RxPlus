import { defineConfig, devices } from '@playwright/test';

import { E2E_DATABASE_URL, E2E_PASSWORD } from './e2e/helpers';
import { hashPassword } from './src/server/utils/password';

const PORT = 4300;
const STUB_UPSTREAM_PORT = 4399;

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.spec.ts',
  globalSetup: './e2e/global-setup.ts',
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env['CI'],
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chrome',
      // Uses the installed Google Chrome (fresh profile). Set PW_CHANNEL= to use
      // Playwright's bundled Chromium instead (after `npx playwright install chromium`).
      use: { ...devices['Desktop Chrome'], channel: process.env['PW_CHANNEL'] ?? 'chrome' },
    },
  ],
  webServer: [
    {
      // Recorded RxNav, openFDA, MedlinePlus and Ollama responses, so e2e never
      // depends on NLM, FDA or a local model.
      command: 'node e2e/stub-upstream.ts',
      url: `http://localhost:${STUB_UPSTREAM_PORT}/health`,
      env: { STUB_UPSTREAM_PORT: String(STUB_UPSTREAM_PORT) },
      reuseExistingServer: false,
    },
    {
      // The production build; `npm run e2e` builds first.
      command: 'node dist/analog/server/index.mjs',
      url: `http://localhost:${PORT}/login`,
      reuseExistingServer: false,
      timeout: 30_000,
      env: {
        PORT: String(PORT),
        DATABASE_URL: E2E_DATABASE_URL,
        // Test-only credentials for this throwaway server; never used anywhere else.
        APP_PASSWORD_HASH: await hashPassword(E2E_PASSWORD),
        SESSION_SECRET: 'e2e-session-secret-not-for-real-use-0123456789',
        COOKIE_SECURE: 'false',
        RXNAV_BASE_URL: `http://localhost:${STUB_UPSTREAM_PORT}/REST`,
        OPENFDA_BASE_URL: `http://localhost:${STUB_UPSTREAM_PORT}/openfda/drug`,
        MEDLINEPLUS_BASE_URL: `http://localhost:${STUB_UPSTREAM_PORT}/medlineplus`,
        SUMMARY_PROVIDER: 'ollama',
        OLLAMA_BASE_URL: `http://localhost:${STUB_UPSTREAM_PORT}/ollama`,
        OLLAMA_MODEL: 'qwen2.5:7b',
      },
    },
  ],
});
