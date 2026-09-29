import { expect, test } from '@playwright/test';

import {
  addMedication,
  E2E_OTHER_PASSWORD,
  E2E_OTHER_USERNAME,
  E2E_PASSWORD,
  E2E_USERNAME,
  resetMedications,
  signIn,
} from './helpers';

const LISINOPRIL = 'lisinopril 10 MG Oral Tablet';

test('two accounts stay signed in side by side, each seeing its own name', async ({ browser }) => {
  const first = await browser.newContext();
  const second = await browser.newContext();
  try {
    const a = await first.newPage();
    const b = await second.newPage();

    await a.goto('/');
    await signIn(a, E2E_PASSWORD, E2E_USERNAME);
    await expect(a.getByTestId('signed-in-user')).toHaveText(`Signed in as ${E2E_USERNAME}`);

    await b.goto('/');
    await signIn(b, E2E_OTHER_PASSWORD, E2E_OTHER_USERNAME);
    await expect(b.getByTestId('signed-in-user')).toHaveText(`Signed in as ${E2E_OTHER_USERNAME}`);

    // The first session is untouched by the second sign-in, and by its logout.
    await b.getByRole('button', { name: 'Log out' }).click();
    await expect(b).toHaveURL('/login');
    await a.reload();
    await expect(a.getByTestId('signed-in-user')).toHaveText(`Signed in as ${E2E_USERNAME}`);
  } finally {
    await first.close();
    await second.close();
  }
});

test('each account keeps its own medication list', async ({ browser }) => {
  await resetMedications();
  const first = await browser.newContext();
  const second = await browser.newContext();
  try {
    const a = await first.newPage();
    await a.goto('/medications');
    await signIn(a, E2E_PASSWORD, E2E_USERNAME);
    await addMedication(a, 'lisinopril', LISINOPRIL, 'first account note');
    await expect(a.getByRole('article', { name: LISINOPRIL })).toContainText('first account note');

    const b = await second.newPage();
    await b.goto('/medications');
    await signIn(b, E2E_OTHER_PASSWORD, E2E_OTHER_USERNAME);
    await expect(b.getByRole('heading', { name: 'No medications yet' })).toBeVisible();

    // The same product is not a duplicate on another account's list.
    const dialog = await addMedication(b, 'lisinopril', LISINOPRIL);
    await expect(dialog).toBeHidden();
    const card = b.getByRole('article', { name: LISINOPRIL });
    await expect(card).toBeVisible();
    await expect(card).not.toContainText('first account note');

    await b.goto('/');
    await expect(b.getByText('You’re taking 1 medication')).toBeVisible();

    await a.reload();
    await expect(a.getByRole('article', { name: LISINOPRIL })).toHaveCount(1);
    await expect(a.getByRole('article', { name: LISINOPRIL })).toContainText('first account note');
  } finally {
    await first.close();
    await second.close();
  }
});
