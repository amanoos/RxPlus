// @vitest-environment node
import { DdinterFormatError, normalizeDdinter, parseDdinterCsv, splitRoute } from './ddinter';

const HEADER = 'DDInterID_A,Drug_A,DDInterID_B,Drug_B,Level';

describe('parseDdinterCsv', () => {
  it('parses rows, including quoted names with commas and escaped quotes', () => {
    const csv = [
      HEADER,
      'DDInter1079,Lisinopril,DDInter1710,Spironolactone,Major',
      'DDInter1,"Insulin, porcine",DDInter2,"Vitamin ""A""",Minor',
      '',
    ].join('\r\n');
    expect(parseDdinterCsv(csv)).toEqual([
      {
        idA: 'DDInter1079',
        nameA: 'Lisinopril',
        idB: 'DDInter1710',
        nameB: 'Spironolactone',
        level: 'Major',
      },
      {
        idA: 'DDInter1',
        nameA: 'Insulin, porcine',
        idB: 'DDInter2',
        nameB: 'Vitamin "A"',
        level: 'Minor',
      },
    ]);
  });

  it('rejects an unexpected header or level', () => {
    expect(() => parseDdinterCsv('id,a,b\n1,2,3')).toThrowError(DdinterFormatError);
    expect(() => parseDdinterCsv(`${HEADER}\nDDInter1,A,DDInter2,B,Severe`)).toThrowError(/Severe/);
  });
});

describe('splitRoute', () => {
  it.each([
    ['Lisinopril', { base: 'Lisinopril', route: null }],
    ['Hydrocortisone (topical)', { base: 'Hydrocortisone', route: 'topical' }],
    ['Timolol (ophthalmic)', { base: 'Timolol', route: 'ophthalmic' }],
    ['Daunorubicin (liposomal)', { base: 'Daunorubicin', route: null }],
    ['Paclitaxel (protein-bound)', { base: 'Paclitaxel', route: null }],
    ['Fludeoxyglucose (18F)', { base: 'Fludeoxyglucose (18F)', route: null }],
    ['Clobetasol (topiclal)', { base: 'Clobetasol', route: 'topical' }],
    ['Diclofenac (topical ophthalmic)', { base: 'Diclofenac', route: 'ophthalmic' }],
    ['Insulin lispro (inhalation, rapid acting)', { base: 'Insulin lispro', route: 'inhalation' }],
    ['Heparin (intravenous and subcutaneous)', { base: 'Heparin', route: null }],
    ['Magnesium (sulfate)', { base: 'Magnesium (sulfate)', route: null }],
  ])('%j', (name, expected) => {
    expect(splitRoute(name)).toEqual(expected);
  });
});

describe('normalizeDdinter', () => {
  it('orders each pair, merges duplicates keeping the most severe level, and lists drugs', () => {
    const { drugs, pairs } = normalizeDdinter([
      { idA: 'DDInter9', nameA: 'Warfarin', idB: 'DDInter2', nameB: 'Aspirin', level: 'Moderate' },
      { idA: 'DDInter2', nameA: 'Aspirin', idB: 'DDInter9', nameB: 'Warfarin', level: 'Major' },
      { idA: 'DDInter2', nameA: 'Aspirin', idB: 'DDInter5', nameB: 'Ibuprofen', level: 'Unknown' },
      { idA: 'DDInter5', nameA: 'Ibuprofen', idB: 'DDInter2', nameB: 'Aspirin', level: 'Minor' },
    ]);
    expect(pairs).toEqual([
      { drugA: 'DDInter2', drugB: 'DDInter5', level: 'Minor' },
      { drugA: 'DDInter2', drugB: 'DDInter9', level: 'Major' },
    ]);
    expect(drugs).toEqual(
      new Map([
        ['DDInter9', 'Warfarin'],
        ['DDInter2', 'Aspirin'],
        ['DDInter5', 'Ibuprofen'],
      ]),
    );
  });

  it('ignores self-pairs', () => {
    const { pairs } = normalizeDdinter([
      { idA: 'DDInter1', nameA: 'X', idB: 'DDInter1', nameB: 'X', level: 'Major' },
    ]);
    expect(pairs).toEqual([]);
  });
});
