import { expect, test } from '@playwright/test';

import { E2E_PASSWORD, E2E_USERNAME, signIn } from './helpers';

test('redirects to login when not signed in', async ({ page }) => {
  await page.goto('/medications');
  await expect(page).toHaveURL('/login?next=%2Fmedications');
  await expect(page.getByRole('heading', { name: 'RxPlus' })).toBeVisible();
});

test('rejects a wrong password, then signs in by username and survives a hard refresh', async ({
  page,
}) => {
  await page.goto('/medications');

  await signIn(page, 'not-the-password');
  await expect(page.getByText('Invalid username or password.')).toBeVisible();
  await expect(page).toHaveURL(/\/login/);

  // Usernames are case-insensitive.
  await signIn(page, E2E_PASSWORD, E2E_USERNAME.toUpperCase());
  await expect(page).toHaveURL('/medications');
  await expect(page.getByTestId('signed-in-user')).toHaveText(`Signed in as ${E2E_USERNAME}`);
  await expect(page.getByRole('heading', { name: 'Medications', exact: true })).toBeVisible();

  await page.reload();
  await expect(page).toHaveURL('/medications');
  await expect(page.getByRole('heading', { name: 'Medications', exact: true })).toBeVisible();
});

test('logs out back to the login page', async ({ page }) => {
  await page.goto('/');
  await signIn(page, E2E_PASSWORD);
  await expect(page.getByRole('heading', { name: 'Dashboard', exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Log out' }).click();
  await expect(page).toHaveURL('/login');

  await page.goto('/digest');
  await expect(page).toHaveURL('/login?next=%2Fdigest');
});
