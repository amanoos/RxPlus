// @vitest-environment node
import { groupAlternatives, type GroupInput } from './group';
import type { AlternativeDrug } from './repository';

const ACE = 'N0000175562';
const drug = (
  rxcui: string,
  name: string,
  className: string | null,
  firstApproved: string | null,
  classId: string | null = className ? `C-${className}` : null,
): AlternativeDrug => ({
  ingredientRxcui: rxcui,
  name,
  classId,
  className,
  firstApproved,
  genericAvailable: firstApproved !== null && firstApproved < '2020-01-01',
  productRxcui: `p${rxcui}`,
});

const lisinopril = drug('29046', 'lisinopril', 'ACE inhibitor', '1987-12-29', ACE);
const enalapril = drug('3827', 'enalapril', 'ACE inhibitor', '1985-12-24', ACE);
const ramipril = drug('35296', 'ramipril', 'ACE inhibitor', '1991-01-28', ACE);
const losartan = drug('52175', 'losartan', 'Angiotensin 2 Receptor Blocker', '1995-04-14');
const valsartan = drug('69749', 'valsartan', 'Angiotensin 2 Receptor Blocker', '1996-12-23');
const amlodipine = drug(
  '17767',
  'amlodipine',
  'Dihydropyridine Calcium Channel Blocker',
  '1992-07-31',
);
const aprocitentan = drug(
  '2679059',
  'aprocitentan',
  'Endothelin Receptor Antagonist',
  '2024-03-19',
);
const garlic = drug('1', 'unclassified drug', null, null);

const input = (overrides: Partial<GroupInput> = {}): GroupInput => ({
  ingredientRxcui: '29046',
  classId: ACE,
  classDrugs: [lisinopril, ramipril, enalapril],
  conditionDrugs: [lisinopril, enalapril, losartan, valsartan, amlodipine, aprocitentan, garlic],
  hidden: [],
  today: '2026-09-27',
  ...overrides,
});

describe('groupAlternatives', () => {
  it('lists new drugs, the same class, and other classes, without the drug itself', () => {
    const groups = groupAlternatives(input());
    expect(groups.newForCondition.map((d) => d.name)).toEqual(['aprocitentan']);
    expect(groups.newForCondition[0]).toMatchObject({ isNew: true, approvedYear: 2024 });
    expect(groups.sameClass.map((d) => d.name)).toEqual(['enalapril', 'ramipril']);
    expect(groups.sameClass[0]).toMatchObject({ isNew: false, approvedYear: 1985 });
    expect(groups.otherClasses.map((c) => [c.className, c.drugs.map((d) => d.name)])).toEqual([
      ['Angiotensin 2 Receptor Blocker', ['losartan', 'valsartan']],
      ['Dihydropyridine Calcium Channel Blocker', ['amlodipine']],
      ['Endothelin Receptor Antagonist', ['aprocitentan']],
      ['Other', ['unclassified drug']],
    ]);
  });

  it('counts "new" as first approved within 5 years of today', () => {
    const groups = groupAlternatives(
      input({
        conditionDrugs: [
          drug('9', 'edge', 'X', '2021-09-27'),
          drug('8', 'older', 'X', '2021-09-26'),
        ],
      }),
    );
    expect(groups.newForCondition.map((d) => d.name)).toEqual(['edge']);
  });

  it('moves hidden drugs out of every group into their own list', () => {
    const groups = groupAlternatives(input({ hidden: ['3827', '52175'] }));
    expect(groups.sameClass.map((d) => d.name)).toEqual(['ramipril']);
    expect(groups.otherClasses[0].drugs.map((d) => d.name)).toEqual(['valsartan']);
    expect(groups.hidden.map((d) => d.name)).toEqual(['enalapril', 'losartan']);
  });

  it('works with only one list available', () => {
    const noCondition = groupAlternatives(input({ conditionDrugs: null }));
    expect(noCondition.sameClass).toHaveLength(2);
    expect(noCondition.otherClasses).toEqual([]);
    expect(noCondition.newForCondition).toEqual([]);

    const noClass = groupAlternatives(input({ classId: null, classDrugs: null }));
    // Without a class, same-class drugs appear among the other classes.
    expect(noClass.otherClasses.map((c) => c.className)).toContain('ACE inhibitor');
  });
});
