import { expect, test } from '@playwright/test';

import { asOtherAccount, resetMedications, signIn } from './helpers';

test.beforeEach(async ({ page }) => {
  await resetMedications();
  await page.goto('/drugs/314076');
  await signIn(page);
  await expect(page).toHaveURL(/\/drugs\/314076$/);
});

test('shows research with verified takeaways and trials; hides a paper and shows it again', async ({
  page,
  browser,
}) => {
  const research = page.getByTestId('research');
  const papers = research
    .getByTestId('research-ingredient')
    .locator('> div > app-paper-list [data-testid="paper"]');

  // Reviews first, then randomized trials (the stub has details for four papers).
  await expect(papers).toHaveCount(4, { timeout: 15_000 });
  await expect(papers.nth(0)).toHaveAttribute('data-pmid', '37417783');
  await expect(papers.nth(0)).toContainText('Meta-analysis');
  await expect(papers.nth(0).getByTestId('paper-title')).toHaveAttribute(
    'href',
    'https://pubmed.ncbi.nlm.nih.gov/37417783/',
  );
  await expect(papers.nth(0).getByTestId('full-text')).toHaveAttribute(
    'href',
    /pmc\.ncbi\.nlm\.nih\.gov/,
  );
  await expect(papers.nth(3)).toContainText('Randomized trial');

  // Takeaways are written in the background, then shown with their quote in plain view.
  const takeaway = papers.nth(1).getByTestId('takeaway');
  await expect(takeaway).toContainText('lisinopril worked well for kidney disease', {
    timeout: 20_000,
  });
  await expect(papers.nth(1).getByTestId('takeaway-quote')).toContainText(
    'In the study: “The identified studies showed that lisinopril was highly effective',
  );
  await expect(research.getByTestId('research-footer')).toContainText(
    'Takeaways written by AI (qwen2.5:7b, local) from the abstracts.',
  );

  // Trials: up to 3 completed with results, then recruiting.
  const trials = research.getByTestId('trial');
  await expect(trials).toHaveCount(5);
  await expect(trials.nth(0)).toContainText('Completed · results posted');
  await expect(trials.nth(4)).toContainText('Recruiting');

  // Hide the first paper, then show it again.
  await papers
    .nth(0)
    .getByRole('button', { name: /^Hide: / })
    .click();
  await expect(papers).toHaveCount(3);
  await expect(papers.nth(0)).toHaveAttribute('data-pmid', '29971804');

  // Hides are personal: the other account still sees the paper.
  const other = await asOtherAccount(browser, '/drugs/314076');
  try {
    const theirPapers = other.page
      .getByTestId('research')
      .getByTestId('research-ingredient')
      .locator('> div > app-paper-list [data-testid="paper"]');
    await expect(theirPapers).toHaveCount(4, { timeout: 15_000 });
    await expect(theirPapers.nth(0)).toHaveAttribute('data-pmid', '37417783');
    await expect(other.page.getByRole('button', { name: /Show hidden/ })).toHaveCount(0);
  } finally {
    await other.context.close();
  }
  await research.getByRole('button', { name: 'Show hidden (1)' }).click();
  await research
    .getByTestId('hidden-papers')
    .getByRole('button', { name: /^Show again: / })
    .click();
  await expect(papers).toHaveCount(4);
  await expect(papers.nth(0)).toHaveAttribute('data-pmid', '37417783');

  // Stored: a reload shows the same lists and takeaways at once.
  await page.reload();
  await expect(papers.nth(1).getByTestId('takeaway')).toContainText('lisinopril worked well');
});
