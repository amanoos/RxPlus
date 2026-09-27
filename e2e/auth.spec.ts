import { expect, test } from '@playwright/test';

import { E2E_PASSWORD, signIn } from './helpers';

test('redirects to login when not signed in', async ({ page }) => {
  await page.goto('/medications');
  await expect(page).toHaveURL('/login?next=%2Fmedications');
  await expect(page.getByRole('heading', { name: 'RxPlus' })).toBeVisible();
});

test('rejects a wrong password, then signs in and survives a hard refresh', async ({ page }) => {
  await page.goto('/medications');

  await signIn(page, 'not-the-password');
  await expect(page.getByText('Incorrect password.')).toBeVisible();
  await expect(page).toHaveURL(/\/login/);

  await signIn(page, E2E_PASSWORD);
  await expect(page).toHaveURL('/medications');
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
