import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import pg from 'pg';

import {
  addMedication,
  E2E_DATABASE_URL,
  E2E_OTHER_PASSWORD,
  E2E_OTHER_USERNAME,
  resetMedications,
  signIn,
} from './helpers';

const LISINOPRIL = 'lisinopril 10 MG Oral Tablet';
const STUB = 'http://localhost:4399';

/** Switches the stub's news week (a separate context: no app cookies, no stale sockets). */
const digestWeek = (request: APIRequestContext, week: number) =>
  request.post(`${STUB}/stub/digest-week/${week}`, { headers: { connection: 'close' } });

/** Saves "taken for Hypertension" on every medication (the alternatives spec covers the UI). */
async function takenForHypertension() {
  const client = new pg.Client({ connectionString: E2E_DATABASE_URL });
  await client.connect();
  try {
    await client.query(
      "update medications set taken_for_id = 'D006973', taken_for_name = 'Hypertension'",
    );
  } finally {
    await client.end();
  }
}

/** Waits until the server has no digest running. */
async function runFinished(page: Page) {
  await expect
    .poll(async () => (await (await page.request.get('/api/digests')).json()).running, {
      timeout: 30_000,
    })
    .toBeNull();
}

test.beforeEach(async ({ page, request }) => {
  await resetMedications();
  await digestWeek(request, 1);
  await page.goto('/medications');
  await signIn(page);
  await addMedication(page, 'lisinopril', LISINOPRIL);
  await expect(page.getByRole('article', { name: LISINOPRIL })).toBeVisible();
  await takenForHypertension();
});

test.afterEach(async ({ request }) => {
  await digestWeek(request, 0);
});

test('collects the week on Run now, shows the badge, and clears it once read', async ({ page }) => {
  const nav = page.getByRole('navigation', { name: 'Main' });
  await nav.getByRole('link', { name: 'What’s new' }).click();
  await expect(page.getByTestId('no-digests')).toContainText('No digest yet.');
  await expect(page.getByTestId('digest-status')).toContainText('Next digest: Monday');

  // Start a run, then leave the page while it collects.
  await page.getByTestId('run-now').getByRole('button').click();
  await expect(page.getByTestId('digest-status')).toContainText('Collecting this week’s news');
  await nav.getByRole('link', { name: 'Medications' }).click();
  await runFinished(page);

  // Navigating refreshes the badge: 2 papers, "4 more", a new trial and posted results.
  await nav.getByRole('link', { name: 'Dashboard' }).click();
  const whatsNew = nav.getByRole('link', { name: /What’s new/ });
  await expect(whatsNew.getByTestId('unread-badge')).toHaveText('5 unread');

  await whatsNew.click();
  const digest = page.getByTestId('digest').first();
  await expect(digest.locator('summary')).toContainText('5 items');
  const group = digest.getByTestId('digest-group');
  await expect(group.locator('h3')).toHaveText('lisinopril');
  const items = group.getByTestId('digest-item');
  await expect(items).toHaveCount(5);
  await expect(page.locator('[data-testid="digest-item"][data-unread]')).toHaveCount(5);

  const paper = items.filter({ has: page.getByTestId('takeaway') }).first();
  await expect(paper.getByRole('link')).toHaveAttribute(
    'href',
    /pubmed\.ncbi\.nlm\.nih\.gov\/\d+\//,
  );
  await expect(paper.getByTestId('takeaway-quote')).toContainText('In the study:');
  await expect(digest.getByRole('link', { name: 'and 4 more on PubMed' })).toHaveAttribute(
    'href',
    /pubmed\.ncbi\.nlm\.nih\.gov\/\?term=/,
  );
  const trials = items.and(page.locator('[data-kind="trial"]'));
  await expect(trials).toHaveCount(2);
  await expect(trials.first()).toContainText('New trial');
  await expect(trials.first().getByRole('link')).toHaveAttribute(
    'href',
    'https://clinicaltrials.gov/study/NCT07685938',
  );
  await expect(trials.nth(1)).toContainText('Results posted');

  // Opening the page marked it read.
  await expect(whatsNew.getByTestId('unread-badge')).toHaveCount(0);
});

test('reports a newly listed drug and a new label the next week, without repeats', async ({
  page,
  request,
}) => {
  await page.goto('/digest');
  await page.getByTestId('run-now').getByRole('button').click();
  await runFinished(page);

  await digestWeek(request, 2);
  await page.reload();
  await page.getByTestId('run-now').getByRole('button').click();
  await expect(page.getByTestId('digest')).toHaveCount(2, { timeout: 30_000 });

  const latest = page.getByTestId('digest').first();
  await expect(latest.locator('summary')).toContainText('2 items');
  await expect(latest).not.toContainText('more on PubMed');
  await expect(latest.getByTestId('digest-group').locator('h3')).toHaveText([
    'Hypertension',
    'lisinopril',
  ]);
  await expect(latest.locator('[data-kind="approval"]')).toHaveText(
    /Newly listed for Hypertension: aprocitentan \(approved 2024\)/,
  );
  const label = latest.locator('[data-kind="label"]');
  await expect(label).toContainText(`New FDA label for ${LISINOPRIL}, dated`);
  await expect(label.getByRole('link', { name: 'Read it on DailyMed' })).toHaveAttribute(
    'href',
    /dailymed\.nlm\.nih\.gov/,
  );

  // The earlier week stays, collapsed.
  const earlier = page.getByTestId('digest').nth(1);
  await expect(earlier).not.toHaveAttribute('open');
  await expect(earlier.locator('summary')).toContainText('5 items');

  await label.getByRole('link', { name: `New FDA label for ${LISINOPRIL}` }).click();
  await expect(page).toHaveURL(/\/drugs\/314076$/);
});

test("keeps each account's digest to itself", async ({ page, browser }) => {
  const nav = page.getByRole('navigation', { name: 'Main' });
  await nav.getByRole('link', { name: 'What’s new' }).click();
  await page.getByTestId('run-now').getByRole('button').click();
  // Leave the page while it collects: viewing the finished digest would mark it read.
  await nav.getByRole('link', { name: 'Medications' }).click();
  await runFinished(page);
  await nav.getByRole('link', { name: 'Dashboard' }).click();
  await expect(
    nav.getByRole('link', { name: /What’s new/ }).getByTestId('unread-badge'),
  ).toHaveText('5 unread');

  // The other account takes nothing: no badge, no digest, and its own run has no lisinopril.
  const context = await browser.newContext();
  try {
    const other = await context.newPage();
    await other.goto('/digest');
    await signIn(other, E2E_OTHER_PASSWORD, E2E_OTHER_USERNAME);
    const otherNav = other.getByRole('navigation', { name: 'Main' });
    await expect(otherNav.getByTestId('unread-badge')).toHaveCount(0);
    // Its own list is empty, whatever the first account takes.
    await expect(other.getByTestId('no-medications')).toBeVisible();

    await other.getByTestId('run-now').getByRole('button').click();
    await runFinished(other);
    await other.reload();
    await expect(other.getByTestId('digest-group')).toHaveCount(0);
    await expect(other.getByText('lisinopril')).toHaveCount(0);
  } finally {
    await context.close();
  }

  // The first account's digest is untouched by the other's run.
  await nav.getByRole('link', { name: /What’s new/ }).click();
  await expect(
    page.getByTestId('digest').first().getByTestId('digest-group').locator('h3'),
  ).toHaveText('lisinopril');
});
