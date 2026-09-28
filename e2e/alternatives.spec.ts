import { expect, test } from '@playwright/test';

import { addMedication, resetMedications, signIn } from './helpers';

const LISINOPRIL = 'lisinopril 10 MG Oral Tablet';

test.beforeEach(async ({ page }) => {
  await resetMedications();
  await page.goto('/medications');
  await signIn(page);
  await addMedication(page, 'lisinopril', LISINOPRIL);
  await expect(page.getByRole('article', { name: LISINOPRIL })).toBeVisible();
});

test('shows alternatives for what the medication is taken for, and hides one', async ({ page }) => {
  await page
    .getByRole('article', { name: LISINOPRIL })
    .getByRole('link', { name: 'About this drug' })
    .click();
  const section = page.getByTestId('alternatives');
  await expect(section.getByTestId('alternatives-note')).toContainText('Not a recommendation');

  // The same class builds right away; the condition is asked for.
  await expect(section.getByText('What do you take lisinopril for?')).toBeVisible();
  await section.getByRole('button', { name: 'Hypertension', exact: true }).click();
  await expect(section.getByTestId('condition')).toContainText(
    'For Hypertension (saved for this medication)',
  );

  // New for the condition, same class, other classes; bosentan (pulmonary only) is left out.
  await expect(section.getByTestId('group-new')).toContainText('aprocitentan', {
    timeout: 20_000,
  });
  await expect(section.getByTestId('group-new')).toContainText('New (2024)');
  await expect(section.getByTestId('group-new')).toContainText('No generic yet');
  const sameClass = section.getByTestId('group-same-class');
  await expect(section).toContainText('Same class (Angiotensin Converting Enzyme Inhibitor)');
  await expect(sameClass.getByTestId('alternative')).toHaveCount(1);
  await expect(sameClass).toContainText('enalapril');
  await expect(sameClass).toContainText(/First approved 1985 ·\s+Generic available/);
  await expect(section.getByTestId('other-class')).toHaveText([
    'Angiotensin 2 Receptor Blocker (1)',
    'Endothelin Receptor Antagonist (1)',
  ]);
  await expect(section).not.toContainText('bosentan');

  // Hide enalapril, then show it again.
  await sameClass.getByRole('button', { name: 'Hide: enalapril' }).click();
  await expect(sameClass.getByTestId('alternative')).toHaveCount(0);
  await section.getByRole('button', { name: 'Show hidden (1)' }).click();
  await section
    .getByTestId('hidden-alternatives')
    .getByRole('button', { name: 'Show again: enalapril' })
    .click();
  await expect(sameClass.getByTestId('alternative')).toHaveCount(1);

  // The alternative links to its own drug page.
  await sameClass.getByRole('link', { name: 'enalapril' }).click();
  await expect(page).toHaveURL(/\/drugs\/858804$/);
  await expect(page.getByTestId('drug-name')).toHaveText('enalapril maleate 2.5 MG Oral Tablet');

  // The choice was saved on the medication.
  await page.goto('/medications');
  await expect(page.getByRole('article', { name: LISINOPRIL }).getByTestId('taken-for')).toHaveText(
    'For: Hypertension',
  );
});
