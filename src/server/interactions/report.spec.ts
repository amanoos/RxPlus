// @vitest-environment node
import type { DdiPair } from './ddinter';
import { buildReport, type CheckedDrug, type DdiDrug } from './report';

const drug = (
  rxcui: string,
  name: string,
  ingredients: [string, string][],
  doseForm = 'Oral Tablet',
  medicationId?: string,
): CheckedDrug => ({
  rxcui,
  name,
  doseForm,
  medicationId,
  ingredients: ingredients.map(([r, n]) => ({ rxcui: r, name: n })),
});

const lisinopril = drug(
  '314076',
  'lisinopril 10 MG Oral Tablet',
  [['29046', 'lisinopril']],
  'Oral Tablet',
  'm1',
);
const spironolactone = drug('313096', 'spironolactone 25 MG Oral Tablet', [
  ['9997', 'spironolactone'],
]);
const atorvastatin = drug(
  '617310',
  'atorvastatin 20 MG Oral Tablet',
  [['83367', 'atorvastatin']],
  'Oral Tablet',
  'm2',
);
const zestoretic = drug('197885', 'hydrochlorothiazide 12.5 MG / lisinopril 10 MG Oral Tablet', [
  ['5487', 'hydrochlorothiazide'],
  ['29046', 'lisinopril'],
]);
const hydrocortisoneCream = drug(
  '106258',
  'hydrocortisone 1 % Topical Cream',
  [['5492', 'hydrocortisone']],
  'Topical Cream',
);
const hydrocortisoneTablet = drug('197782', 'hydrocortisone 10 MG Oral Tablet', [
  ['5492', 'hydrocortisone'],
]);
const unknownDrug = drug('999', 'mystery 5 MG Oral Tablet', [['12345', 'mystery']]);

const ddiDrugs: DdiDrug[] = [
  { ddinterId: 'L', ingredientRxcui: '29046', route: null },
  { ddinterId: 'S', ingredientRxcui: '9997', route: null },
  { ddinterId: 'A', ingredientRxcui: '83367', route: null },
  { ddinterId: 'H', ingredientRxcui: '5487', route: null },
  { ddinterId: 'HC', ingredientRxcui: '5492', route: null },
  { ddinterId: 'HCT', ingredientRxcui: '5492', route: 'topical' },
];
const pairs: DdiPair[] = [
  { drugA: 'L', drugB: 'S', level: 'Major' },
  { drugA: 'A', drugB: 'L', level: 'Unknown' },
  { drugA: 'H', drugB: 'S', level: 'Moderate' },
  { drugA: 'HC', drugB: 'L', level: 'Minor' },
  { drugA: 'HCT', drugB: 'L', level: 'Major' },
];
const data = { ddiDrugs, pairs };

describe('buildReport', () => {
  it('checks a candidate against current medications, most severe first', () => {
    const report = buildReport({
      candidate: spironolactone,
      current: [lisinopril, atorvastatin],
      ...data,
    });
    expect(report.results).toEqual([
      {
        a: {
          rxcui: '313096',
          name: spironolactone.name,
          ingredient: 'spironolactone',
          ingredientRxcui: '9997',
        },
        b: {
          rxcui: '314076',
          name: lisinopril.name,
          ingredient: 'lisinopril',
          ingredientRxcui: '29046',
          medicationId: 'm1',
        },
        level: 'Major',
      },
    ]);
    expect(report.notCovered).toEqual([]);
  });

  it('reports listed-but-unrated pairs as Unknown', () => {
    const report = buildReport({ candidate: atorvastatin, current: [lisinopril], ...data });
    expect(report.results.map((r) => r.level)).toEqual(['Unknown']);
  });

  it('checks every ingredient of a combination product', () => {
    const report = buildReport({ candidate: zestoretic, current: [spironolactone], ...data });
    expect(report.results.map((r) => [r.a.ingredient, r.level])).toEqual([
      ['lisinopril', 'Major'],
      ['hydrochlorothiazide', 'Moderate'],
    ]);
  });

  it('ignores ingredients the two drugs share', () => {
    const report = buildReport({ candidate: zestoretic, current: [lisinopril], ...data });
    expect(report.results).toEqual([]);
  });

  it('ignores shared ingredients in the reverse direction too', () => {
    const pairsWithHctz: DdiPair[] = [...pairs, { drugA: 'H', drugB: 'L', level: 'Moderate' }];
    const report = buildReport({
      candidate: lisinopril,
      current: [zestoretic],
      ddiDrugs,
      pairs: pairsWithHctz,
    });
    expect(report.results).toEqual([]);
  });

  it('uses route-specific entries only for matching dose forms', () => {
    const cream = buildReport({ candidate: hydrocortisoneCream, current: [lisinopril], ...data });
    expect(cream.results.map((r) => r.level)).toEqual(['Major']);
    const tablet = buildReport({ candidate: hydrocortisoneTablet, current: [lisinopril], ...data });
    expect(tablet.results.map((r) => r.level)).toEqual(['Minor']);
  });

  it('lists ingredients missing from the dataset', () => {
    const report = buildReport({ candidate: unknownDrug, current: [lisinopril], ...data });
    expect(report.results).toEqual([]);
    expect(report.notCovered).toEqual([
      { rxcui: '999', name: unknownDrug.name, ingredient: 'mystery' },
    ]);
  });

  it('checks every pair among current medications when there is no candidate', () => {
    const report = buildReport({ current: [lisinopril, spironolactone, atorvastatin], ...data });
    expect(report.results.map((r) => [r.a.ingredient, r.b.ingredient, r.level])).toEqual([
      ['lisinopril', 'spironolactone', 'Major'],
      ['lisinopril', 'atorvastatin', 'Unknown'],
    ]);
  });
});
