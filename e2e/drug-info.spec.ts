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

test('opens a drug page from a medication card, with facts, FDA reports and links', async ({
  page,
}) => {
  await page
    .getByRole('article', { name: LISINOPRIL })
    .getByRole('link', { name: 'About this drug' })
    .click();
  await expect(page).toHaveURL(/\/drugs\/314076$/);

  await expect(page.getByRole('heading', { level: 1 })).toHaveText(LISINOPRIL);
  await expect(page.getByText('Angiotensin Converting Enzyme Inhibitor')).toBeVisible();
  await expect(page.getByTestId('uses')).toContainText('Hypertension');
  await expect(page.getByTestId('avoid')).toContainText('Angioedema');

  const reports = page.getByRole('region', { name: 'Reported to the FDA' });
  await expect(reports.getByTestId('faers-disclaimer')).toContainText(
    'A report doesn’t prove the drug caused the reaction',
  );
  await expect(reports).toContainText('304,318 reports');

  await expect(page.getByRole('link', { name: 'FDA label on DailyMed' })).toHaveAttribute(
    'href',
    /dailymed\.nlm\.nih\.gov/,
  );
  await expect(page.getByRole('link', { name: /^MedlinePlus: / })).toHaveAttribute(
    'href',
    /medlineplus\.gov\/druginfo\/meds\//,
  );
});

test('summarizes the FDA label and shows the quoted source of a sentence', async ({ page }) => {
  await page.goto('/drugs/314076');
  const panel = page.getByTestId('summary-panel');
  await panel.getByRole('button', { name: 'Summarize the FDA label' }).click();

  await expect(panel.getByTestId('summary-pending')).toContainText('Summarizing the FDA label…');
  await expect(panel.getByRole('heading', { name: "What it's for" })).toBeVisible({
    timeout: 15_000,
  });
  await expect(panel.getByRole('heading', { name: 'How well it works' })).toBeVisible();
  await expect(panel.getByTestId('low-citation')).toHaveCount(0);
  await expect(panel.getByTestId('summary-footer')).toContainText('(qwen2.5:7b, local)');

  await panel.getByRole('button', { name: 'Source 1: Indications and usage' }).click();
  const popover = page.getByTestId('citation-popover');
  await expect(popover).toContainText('indicated for the treatment of hypertension');
  await expect(
    popover.getByRole('link', { name: 'Read the full label on DailyMed' }),
  ).toBeVisible();

  // The stored summary is reused on the next visit.
  await page.reload();
  await expect(panel.getByRole('heading', { name: "What it's for" })).toBeVisible();
  await expect(panel.getByRole('button', { name: 'Summarize the FDA label' })).toHaveCount(0);
});
