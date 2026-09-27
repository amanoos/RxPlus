import { expect, type Page, test } from '@playwright/test';

import { resetMedications, signIn } from './helpers';

const LISINOPRIL = 'lisinopril 10 MG Oral Tablet';

async function addMedication(page: Page, drug: string, product: string, notes?: string) {
  await page.getByRole('button', { name: 'Add medication' }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Add medication' });
  await dialog.locator('#drug-search').pressSequentially(drug.slice(0, 5));
  await page.getByRole('option', { name: drug, exact: true }).click();
  await dialog.getByLabel(product, { exact: true }).check();
  if (notes) await dialog.getByLabel('Notes (optional)').fill(notes);
  await dialog.getByRole('button', { name: 'Add', exact: true }).click();
  return dialog;
}

test.beforeEach(async ({ page }) => {
  await resetMedications();
  await page.goto('/medications');
  await signIn(page);
  await expect(page.getByRole('heading', { name: 'No medications yet' })).toBeVisible();
});

test('adds a medication through search and product choice, and keeps it after reload', async ({
  page,
}) => {
  const dialog = await addMedication(page, 'lisinopril', LISINOPRIL, 'with breakfast');
  await expect(dialog).toBeHidden();

  const card = page.getByRole('article', { name: LISINOPRIL });
  await expect(card).toContainText('10 MG');
  await expect(card).toContainText('Oral Tablet');
  await expect(card).toContainText('with breakfast');

  await page.reload();
  await expect(page.getByRole('article', { name: LISINOPRIL })).toBeVisible();
});

test('explains a duplicate instead of adding it twice', async ({ page }) => {
  await addMedication(page, 'lisinopril', LISINOPRIL);
  await expect(page.getByRole('article', { name: LISINOPRIL })).toBeVisible();

  const dialog = await addMedication(page, 'lisinopril', LISINOPRIL);
  await expect(dialog.getByText('This medication is already on your active list.')).toBeVisible();
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByRole('article', { name: LISINOPRIL })).toHaveCount(1);
});

test('stops a medication, shows it under Stopped, and restarts it', async ({ page }) => {
  await addMedication(page, 'lisinopril', LISINOPRIL);

  await page.getByRole('button', { name: `Stop taking ${LISINOPRIL}` }).click();
  const stopDialog = page.getByRole('dialog', { name: 'Stop taking' });
  await stopDialog.getByRole('button', { name: 'Stop taking' }).click();
  await expect(stopDialog).toBeHidden();

  const stopped = page.getByTestId('stopped');
  await expect(stopped.locator('summary')).toHaveText('Stopped (1)');
  await stopped.locator('summary').click();
  await stopped.getByRole('button', { name: `Restart ${LISINOPRIL}` }).click();

  await expect(page.getByTestId('stopped')).toHaveCount(0);
  await expect(page.getByTestId('active-list')).toContainText(LISINOPRIL);
});

test('deletes only after confirmation', async ({ page }) => {
  await addMedication(page, 'lisinopril', LISINOPRIL);

  await page.getByRole('button', { name: `Delete ${LISINOPRIL}` }).click();
  const confirm = page
    .getByRole('alertdialog')
    .or(page.getByRole('dialog', { name: 'Delete medication?' }));
  await confirm.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByRole('article', { name: LISINOPRIL })).toBeVisible();

  await page.getByRole('button', { name: `Delete ${LISINOPRIL}` }).click();
  await confirm.getByRole('button', { name: 'Delete' }).click();
  await expect(page.getByRole('heading', { name: 'No medications yet' })).toBeVisible();
});
