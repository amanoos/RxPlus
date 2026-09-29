import { expect, test } from '@playwright/test';

import { appReady, signIn } from './helpers';

const background = (page: import('@playwright/test').Page) =>
  page.evaluate(() => getComputedStyle(document.body).backgroundColor);

test('follows the OS until switched, then remembers the choice', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('/login');
  await appReady(page);
  const html = page.locator('html');
  await expect(html).toHaveClass(/app-dark/);
  const dark = await background(page);

  await page.getByRole('button', { name: 'Switch to light theme' }).click();
  await expect(html).not.toHaveClass(/app-dark/);
  expect(await background(page)).not.toBe(dark);

  // The choice beats the OS setting, from the first paint of the next page.
  await page.reload();
  await expect(html).not.toHaveClass(/app-dark/);
  await expect(page.getByRole('button', { name: 'Switch to dark theme' })).toBeVisible();
});

test('the header toggle switches signed-in pages', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('/');
  await signIn(page);
  await expect(page.getByRole('heading', { name: 'Dashboard', exact: true })).toBeVisible();
  await appReady(page);

  await page.getByRole('button', { name: 'Switch to dark theme' }).click();
  await expect(page.locator('html')).toHaveClass(/app-dark/);
  await page.getByRole('link', { name: 'Medications', exact: true }).click();
  await expect(page.locator('html')).toHaveClass(/app-dark/);
});
