import { defineConfig, devices } from '@playwright/test';

import { hashPassword } from './src/server/utils/password';

// Test-only credentials for the throwaway e2e server; never used anywhere else.
export const E2E_PASSWORD = 'e2e-test-password';
const PORT = 4300;

export default defineConfig({
  testDir: './e2e',
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
  // Runs the production build; `npm run e2e` builds first.
  webServer: {
    command: 'node dist/analog/server/index.mjs',
    url: `http://localhost:${PORT}/login`,
    reuseExistingServer: false,
    timeout: 30_000,
    env: {
      PORT: String(PORT),
      DATABASE_URL:
        process.env['TEST_DATABASE_URL'] ?? 'postgres://rxplus:rxplus@localhost:5433/rxplus_test',
      APP_PASSWORD_HASH: await hashPassword(E2E_PASSWORD),
      SESSION_SECRET: 'e2e-session-secret-not-for-real-use-0123456789',
      COOKIE_SECURE: 'false',
    },
  },
});
