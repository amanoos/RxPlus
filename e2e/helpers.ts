import { expect, type Browser, type Page } from '@playwright/test';
import pg from 'pg';

/** The accounts global-setup creates; test-only credentials. */
export const E2E_USERNAME = 'e2e';
export const E2E_PASSWORD = 'e2e-test-password';
export const E2E_OTHER_USERNAME = 'e2e-other';
export const E2E_OTHER_PASSWORD = 'e2e-other-password';
export const E2E_DATABASE_URL =
  process.env['TEST_DATABASE_URL'] ?? 'postgres://rxplus:rxplus@localhost:5433/rxplus_test';

/**
 * Waits until the browser app has taken over the server-rendered page (AppReady
 * sets data-hydrated). The login fields and drug search stay disabled until then;
 * other inputs don't, so call it after page.goto and before typing.
 */
export async function appReady(page: Page) {
  await expect(page.locator('html[data-hydrated]')).toBeAttached();
}

export async function signIn(page: Page, password = E2E_PASSWORD, username = E2E_USERNAME) {
  await expect(page).toHaveURL(/\/login/);
  await appReady(page);
  await page.locator('#username').fill(username);
  await page.locator('#password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
}

/**
 * Opens `path` as the second test account, in its own browser context (its own
 * cookies). Close the returned context when done.
 */
export async function asOtherAccount(browser: Browser, path: string) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(path);
  await signIn(page, E2E_OTHER_PASSWORD, E2E_OTHER_USERNAME);
  await expect(page).toHaveURL(new RegExp(`${path}$`));
  return { context, page };
}

/** Empties medications and stored AI output and research, so each test starts clean. */
export async function resetMedications() {
  const client = new pg.Client({ connectionString: E2E_DATABASE_URL });
  await client.connect();
  try {
    await client.query(
      'truncate table medications, drug_summaries, literature_lists, literature_papers, literature_trials, alternative_lists, alternative_drugs, alternative_hidden, digests, digest_items, digest_label_versions',
    );
  } finally {
    await client.end();
  }
}

/** Adds a medication through the add dialog (drug name → exact product). */
export async function addMedication(page: Page, drug: string, product: string, notes?: string) {
  await appReady(page);
  await page.getByRole('button', { name: 'Add medication' }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Add medication' });
  await dialog.locator('#drug-search').pressSequentially(drug.slice(0, 5));
  await page.getByRole('option', { name: drug, exact: true }).click();
  await dialog.getByLabel(product, { exact: true }).check();
  if (notes) await dialog.getByLabel('Notes (optional)').fill(notes);
  await dialog.getByRole('button', { name: 'Add', exact: true }).click();
  return dialog;
}
