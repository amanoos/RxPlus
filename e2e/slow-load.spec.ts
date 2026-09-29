import { expect, test, type Page } from '@playwright/test';

import { E2E_PASSWORD, E2E_USERNAME, signIn } from './helpers';

/** Holds the app's scripts back 1.5 s, like a slow phone: the page shows before it works. */
const slowScripts = (page: Page) =>
  page.route('**/*.js', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    await route.continue();
  });

// Text typed before the app has loaded used to be lost (Sign in stayed disabled).
// The fields now stay disabled until the app is ready, so typing waits for it.
test('signs in when typing as soon as the login page shows', async ({ page }) => {
  await slowScripts(page);
  await page.goto('/login', { waitUntil: 'commit' });
  await expect(page.locator('#username')).toBeDisabled(); // disabled by its fieldset
  await page.locator('#username').fill(E2E_USERNAME);
  await page.locator('#password').fill(E2E_PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Dashboard', exact: true })).toBeVisible();
});

test('keeps the drug search disabled until the app loads, then searches', async ({ page }) => {
  await page.goto('/interactions');
  await signIn(page);
  await expect(page).toHaveURL(/\/interactions$/);

  await slowScripts(page);
  await page.reload({ waitUntil: 'commit' });
  const search = page.locator('#check-drug');
  await expect(search).toBeDisabled();
  await expect(search).toBeEnabled({ timeout: 15_000 });
  await search.pressSequentially('spiro');
  await expect(page.getByRole('option', { name: 'spironolactone', exact: true })).toBeVisible({
    timeout: 15_000,
  });
});
