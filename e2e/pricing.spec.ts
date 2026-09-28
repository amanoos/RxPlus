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

test('shows the Cost Plus price, sets units and a copay, and compares them', async ({ page }) => {
  await page
    .getByRole('article', { name: LISINOPRIL })
    .getByRole('link', { name: 'About this drug' })
    .click();
  const prices = page.getByTestId('prices');
  await expect(prices.getByTestId('cash-price')).toContainText(
    'Cost Plus Drugs: $0.0131 per tablet → $0.39 for 30 tablets a month',
  );
  await expect(prices.getByRole('link', { name: 'See it at Cost Plus Drugs' })).toHaveAttribute(
    'href',
    'https://www.costplusdrugs.com/medications/lisinopril-10mg-tablet/',
  );
  await expect(prices.getByTestId('my-cost')).toContainText('No copay entered.');

  await prices.getByRole('button', { name: 'Edit units and copay' }).click();
  const dialog = page.getByRole('dialog', { name: 'Edit medication' });
  await dialog.locator('#edit-units').fill('60');
  await dialog.locator('#edit-copay').fill('10');
  await dialog.locator('#edit-copay-units').fill('90');
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog).toBeHidden();

  // 60 × $0.0131 = $0.79 cash; $10 × 60 / 90 = $6.67 with insurance.
  await expect(prices.getByTestId('cash-price')).toContainText('$0.79 for 60 tablets a month');
  await expect(prices.getByTestId('my-cost')).toContainText(
    'Your copay: $10.00 per 90 tablets → $6.67 a month',
  );
  await expect(prices.getByTestId('comparison')).toHaveText(
    'Cash at Cost Plus is cheaper by $5.88 a month.',
  );
});

test('totals the month on the Costs page, and says what is not sold', async ({ page }) => {
  await addMedication(page, 'spironolactone', SPIRONOLACTONE);
  await expect(page.getByRole('article', { name: SPIRONOLACTONE })).toBeVisible();

  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Costs' }).click();
  const table = page.getByTestId('costs-table');
  await expect(table.getByTestId('cost-row')).toHaveCount(2);
  const lisinopril = table.getByTestId('cost-row').filter({ hasText: LISINOPRIL });
  await expect(lisinopril).toContainText('$0.39');
  await expect(table.getByTestId('cost-row').filter({ hasText: SPIRONOLACTONE })).toContainText(
    'Not sold',
  );

  await lisinopril.getByRole('button', { name: `Edit units and copay: ${LISINOPRIL}` }).click();
  const dialog = page.getByRole('dialog', { name: 'Edit medication' });
  await dialog.locator('#edit-copay').fill('3');
  await dialog.locator('#edit-copay-units').fill('30');
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog).toBeHidden();

  await expect(lisinopril).toContainText('Cash, by $2.61');
  await expect(table.getByTestId('totals')).toContainText('$0.39');
  await expect(table.getByTestId('totals')).toContainText('$3.00');
  await expect(page.getByTestId('missing')).toHaveText(
    'Totals leave out 1 of 2 without a Cost Plus price and 1 of 2 without a copay.',
  );
});
