import { expect, type Page } from '@playwright/test';
import pg from 'pg';

export const E2E_PASSWORD = 'e2e-test-password';
export const E2E_DATABASE_URL =
  process.env['TEST_DATABASE_URL'] ?? 'postgres://rxplus:rxplus@localhost:5433/rxplus_test';

export async function signIn(page: Page, password = E2E_PASSWORD) {
  // Wait for the client app to take over (it redirects to /login) before typing.
  await expect(page).toHaveURL(/\/login/);
  await page.locator('#password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
}

/** Empties the medications table so each test starts clean. */
export async function resetMedications() {
  const client = new pg.Client({ connectionString: E2E_DATABASE_URL });
  await client.connect();
  try {
    await client.query('truncate table medications');
  } finally {
    await client.end();
  }
}
