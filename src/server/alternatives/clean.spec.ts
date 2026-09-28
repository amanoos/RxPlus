// @vitest-environment node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  cleanCondition,
  mentionsCondition,
  needsLabelCheck,
  qualifierOf,
  type SpecificForm,
} from './clean';

/** Indications texts from the recorded openFDA label fixtures. */
const labelTexts = (name: string): string[] =>
  (
    JSON.parse(
      readFileSync(
        join(__dirname, '..', 'openfda', 'fixtures', `indications-${name}.json`),
        'utf8',
      ),
    ).results as { indications_and_usage?: string[] }[]
  )
    .map((r) => (r.indications_and_usage ?? []).join(' '))
    .filter(Boolean);

describe('qualifierOf', () => {
  it('finds the words that make a form specific', () => {
    expect(qualifierOf('Hypertension, Pulmonary', 'Hypertension')).toBe('pulmonary');
    expect(qualifierOf('Hypertension, Pregnancy-Induced', 'Hypertension')).toBe(
      'pregnancy-induced',
    );
    expect(qualifierOf('Isolated Systolic Hypertension', 'Hypertension')).toBe('isolated systolic');
    expect(qualifierOf('Heart Failure, Systolic', 'Heart Failure')).toBe('systolic');
    expect(qualifierOf('Hypertensive Crisis', 'Hypertension')).toBeNull();
  });
});

describe('mentionsCondition', () => {
  it('ignores mentions that are part of the specific form', () => {
    expect(
      mentionsCondition(['treatment of pulmonary arterial hypertension (PAH)'], 'Hypertension', [
        'pulmonary',
      ]),
    ).toBe(false);
    expect(
      mentionsCondition(['Pulmonary hypertension, and systemic hypertension.'], 'Hypertension', [
        'pulmonary',
      ]),
    ).toBe(true);
    expect(
      mentionsCondition(['Essential hypertension, alone or as an adjunct.'], 'Hypertension', [
        'pulmonary',
      ]),
    ).toBe(true);
    expect(mentionsCondition(['hypertensive emergencies'], 'Hypertension', [])).toBe(false);
  });
});

describe('cleanCondition with recorded labels', () => {
  const candidates = [
    { rxcui: '5470', name: 'hydralazine' },
    { rxcui: '75207', name: 'bosentan' },
    { rxcui: '136411', name: 'sildenafil' },
    { rxcui: '1998', name: 'captopril' },
    { rxcui: '4917', name: 'nitroglycerin' },
    { rxcui: '17767', name: 'amlodipine' },
  ];
  const forms: SpecificForm[] = [
    {
      name: 'Hypertension, Pulmonary',
      ingredientRxcuis: new Set(['5470', '75207', '136411', '4917']),
    },
    { name: 'Hypertension, Malignant', ingredientRxcuis: new Set(['1998']) },
    { name: 'Hypertension, Pregnancy-Induced', ingredientRxcuis: new Set(['4917']) },
  ];
  const indications = new Map([
    ['5470', labelTexts('hydralazine')],
    ['75207', labelTexts('bosentan')],
    ['136411', labelTexts('sildenafil')],
    ['1998', ['Captopril tablets are indicated for the treatment of hypertension.']],
    [
      '4917',
      [
        'Nitroglycerin in dextrose injection is indicated for treatment of peri-operative hypertension; for control of congestive heart failure in the setting of acute myocardial infarction.',
      ],
    ],
  ]);

  it('keeps hypertension drugs and drops pulmonary-hypertension-only drugs', () => {
    const { kept, dropped } = cleanCondition({
      condition: 'Hypertension',
      candidates,
      forms,
      indications,
    });
    expect(kept.map((c) => c.name)).toEqual([
      'hydralazine',
      'captopril',
      'nitroglycerin',
      'amlodipine',
    ]);
    expect(dropped.map((c) => c.name)).toEqual(['bosentan', 'sildenafil']);
  });

  it('only checks labels for drugs listed for a specific form', () => {
    expect(needsLabelCheck(candidates, forms).map((c) => c.name)).toEqual([
      'hydralazine',
      'bosentan',
      'sildenafil',
      'captopril',
      'nitroglycerin',
    ]);
  });

  it('keeps a drug when no label text could be found', () => {
    const { kept } = cleanCondition({
      condition: 'Hypertension',
      candidates: [{ rxcui: '75207', name: 'bosentan' }],
      forms,
      indications: new Map(),
    });
    expect(kept).toHaveLength(1);
  });
});
