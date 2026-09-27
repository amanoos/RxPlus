import { expect, test } from '@playwright/test';

import { addMedication, resetMedications, signIn } from './helpers';

const LISINOPRIL = 'lisinopril 10 MG Oral Tablet';
const SPIRONOLACTONE = 'spironolactone 25 MG Oral Tablet';

test.beforeEach(async ({ page }) => {
  await resetMedications();
  await page.goto('/medications');
  await signIn(page);
  await addMedication(page, 'lisinopril', LISINOPRIL);
  await expect(page.getByRole('article', { name: LISINOPRIL })).toBeVisible();
});

test('checks a new prescription against current medications, with FDA label quotes', async ({
  page,
}) => {
  await page.goto('/interactions');
  const check = page.getByRole('region', { name: 'Check a new prescription' });
  await check.locator('#check-drug').pressSequentially('spiro');
  await page.getByRole('option', { name: 'spironolactone', exact: true }).click();
  await check.getByLabel(SPIRONOLACTONE, { exact: true }).check();

  const result = check.getByTestId('interaction').first();
  await expect(result).toContainText('spironolactone + lisinopril');
  await expect(result).toHaveAttribute('data-level', 'Major');

  await result.getByRole('button', { name: 'Show FDA label text' }).click();
  const evidence = result.getByTestId('evidence');
  await expect(evidence).toContainText('Potassium-sparing diuretics (spironolactone');
  await expect(evidence.getByRole('link', { name: 'View on DailyMed' }).first()).toHaveAttribute(
    'href',
    /dailymed\.nlm\.nih\.gov/,
  );
  await expect(page.locator('footer')).toContainText('DDInter 2.0');
});

test('warns in the add dialog before adding an interacting drug', async ({ page }) => {
  await page.getByRole('button', { name: 'Add medication' }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Add medication' });
  await dialog.locator('#drug-search').pressSequentially('spiro');
  await page.getByRole('option', { name: 'spironolactone', exact: true }).click();
  await dialog.getByLabel(SPIRONOLACTONE, { exact: true }).check();

  await expect(dialog.getByTestId('interaction-warning')).toContainText(
    'Interacts with lisinopril (Major)',
  );
  await expect(dialog.getByRole('button', { name: 'Add', exact: true })).toBeEnabled();
});

test('lists interactions between current medications and on the dashboard', async ({ page }) => {
  await addMedication(page, 'spironolactone', SPIRONOLACTONE);
  await expect(page.getByRole('article', { name: SPIRONOLACTONE })).toBeVisible();

  await page.goto('/interactions');
  const current = page.getByTestId('current-results');
  await expect(current.getByTestId('interaction')).toHaveAttribute('data-level', 'Major');

  await page.goto('/');
  await expect(page.getByTestId('interactions-summary')).toContainText(
    '1 Major interaction between your current medications',
  );
});
