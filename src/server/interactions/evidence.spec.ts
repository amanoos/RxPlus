// @vitest-environment node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { createOpenFdaClient } from '../openfda/client';
import type { RxNavClient } from '../rxnorm/client';
import { evidenceFor, matchEvidence, termsFor } from './evidence';

const labelFixture = (rxcui: string) =>
  readFileSync(join(__dirname, '..', 'openfda', 'fixtures', `label-${rxcui}.json`), 'utf8');

/** Label text as the openFDA client produces it. */
async function labelText(rxcui: string): Promise<string> {
  const client = createOpenFdaClient({
    baseUrl: 'https://openfda.test/drug',
    fetch: async () => new Response(labelFixture(rxcui)),
  });
  return (await client.interactionLabel(rxcui))!.text;
}

describe('termsFor', () => {
  it('adds common label phrasings for classes', () => {
    expect(
      termsFor({
        ingredient: 'lisinopril',
        brands: ['Zestril'],
        classes: ['Angiotensin Converting Enzyme Inhibitor'],
      }),
    ).toEqual(
      expect.arrayContaining([
        'lisinopril',
        'Zestril',
        'Angiotensin Converting Enzyme Inhibitor',
        'ACE inhibitor',
      ]),
    );
    expect(
      termsFor({ ingredient: 'spironolactone', brands: [], classes: ['Aldosterone Antagonist'] }),
    ).toEqual(expect.arrayContaining(['potassium-sparing diuretic']));
  });
});

describe('matchEvidence', () => {
  it('finds the other drug by name (lisinopril label ↔ spironolactone)', async () => {
    const sentences = matchEvidence(await labelText('314076'), {
      ingredient: 'spironolactone',
      brands: ['Aldactone'],
      classes: ['Aldosterone Antagonist'],
    });
    expect(sentences.length).toBeGreaterThan(0);
    expect(sentences.length).toBeLessThanOrEqual(3);
    expect(sentences.join(' ')).toMatch(/spironolactone/i);
  });

  it('finds the other drug by class phrasing (spironolactone label ↔ ACE inhibitor)', async () => {
    const sentences = matchEvidence(await labelText('313096'), {
      ingredient: 'lisinopril',
      brands: ['Zestril'],
      classes: ['Angiotensin Converting Enzyme Inhibitor'],
    });
    expect(sentences.join(' ')).toMatch(/ACE inhibitor|angiotensin/i);
  });

  it('finds names inside interaction tables (atorvastatin label ↔ clarithromycin)', async () => {
    const sentences = matchEvidence(await labelText('617310'), {
      ingredient: 'clarithromycin',
      brands: ['Biaxin'],
      classes: ['Macrolide Antimicrobial'],
    });
    expect(sentences.join(' ')).toMatch(/clarithromycin/i);
  });

  it('matches whole words only and caps sentence length', () => {
    const text =
      'Aceclofenac is unrelated. ' +
      'Use caution with ACE inhibitors because ' +
      'x'.repeat(600) +
      '.';
    // "clofenac" is only part of the word "Aceclofenac", so nothing matches.
    expect(matchEvidence(text, { ingredient: 'clofenac', brands: [], classes: [] })).toEqual([]);
    const [capped] = matchEvidence(text, {
      ingredient: 'z',
      brands: [],
      classes: ['Angiotensin Converting Enzyme Inhibitor'],
    });
    expect(capped.length).toBeLessThanOrEqual(401);
    expect(capped.endsWith('…')).toBe(true);
  });
});

describe('evidenceFor', () => {
  const rxnav = {
    classNames: vi.fn(async (rxcui: string) =>
      rxcui === '29046' ? ['Angiotensin Converting Enzyme Inhibitor'] : ['Aldosterone Antagonist'],
    ),
    brandNames: vi.fn(async (rxcui: string) => (rxcui === '29046' ? ['Zestril'] : ['Aldactone'])),
  } as unknown as RxNavClient;
  const openFda = createOpenFdaClient({
    baseUrl: 'https://openfda.test/drug',
    fetch: async (input) => {
      const rxcui = /openfda\.rxcui%3A(\d+)|openfda\.rxcui:(\d+)/.exec(
        decodeURIComponent(String(input)),
      );
      const id = rxcui?.[1] ?? rxcui?.[2];
      return id === '314076' || id === '313096'
        ? new Response(labelFixture(id))
        : new Response('{"error":{"code":"NOT_FOUND"}}', { status: 404 });
    },
  });

  it('quotes both labels with their source', async () => {
    const evidence = await evidenceFor(
      {
        a: {
          rxcui: '313096',
          name: 'spironolactone 25 MG Oral Tablet',
          ingredient: 'spironolactone',
          ingredientRxcui: '9997',
        },
        b: {
          rxcui: '314076',
          name: 'lisinopril 10 MG Oral Tablet',
          ingredient: 'lisinopril',
          ingredientRxcui: '29046',
        },
      },
      { openFda, rxnav },
    );
    expect(evidence).toHaveLength(2);
    expect(evidence[0]).toMatchObject({
      label: 'spironolactone 25 MG Oral Tablet',
      url: expect.stringContaining('dailymed.nlm.nih.gov'),
      effectiveDate: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
    });
    expect(evidence.every((e) => e.sentences.length > 0)).toBe(true);
  });

  it('marks a product without a label', async () => {
    const [missing] = await evidenceFor(
      {
        a: { rxcui: '1', name: 'unlabeled product', ingredient: 'x', ingredientRxcui: '1' },
        b: {
          rxcui: '314076',
          name: 'lisinopril 10 MG Oral Tablet',
          ingredient: 'lisinopril',
          ingredientRxcui: '29046',
        },
      },
      { openFda, rxnav },
    );
    expect(missing).toEqual({ label: 'unlabeled product', missing: true, sentences: [] });
  });
});
