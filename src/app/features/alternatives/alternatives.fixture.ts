import type {
  Alternative,
  AlternativesResponse,
  IngredientAlternatives,
  ListStatus,
} from './alternatives';

/** Test helpers: lisinopril taken for hypertension. */
export function alternativeFixture(overrides: Partial<Alternative> = {}): Alternative {
  return {
    ingredientRxcui: '3827',
    name: 'enalapril',
    classId: 'N0000175562',
    className: 'Angiotensin Converting Enzyme Inhibitor',
    firstApproved: '1985-12-24',
    approvedYear: 1985,
    genericAvailable: true,
    isNew: false,
    productRxcui: '858804',
    ...overrides,
  };
}

const ready = (builtAt = '2026-09-27T20:00:00.000Z'): ListStatus => ({
  status: 'ready',
  builtAt,
  skipped: 0,
  error: null,
});

export const aprocitentan = alternativeFixture({
  ingredientRxcui: '2679059',
  name: 'aprocitentan',
  classId: 'N0000191266',
  className: 'Endothelin Receptor Antagonist',
  firstApproved: '2024-03-19',
  approvedYear: 2024,
  genericAvailable: false,
  isNew: true,
  productRxcui: '2679064',
});

export function ingredientAlternativesFixture(
  overrides: Partial<IngredientAlternatives> = {},
): IngredientAlternatives {
  return {
    rxcui: '29046',
    name: 'lisinopril',
    drugClass: { id: 'N0000175562', name: 'Angiotensin Converting Enzyme Inhibitor' },
    classList: ready(),
    conditionList: ready(),
    groups: {
      newForCondition: [aprocitentan],
      sameClass: [
        alternativeFixture(),
        alternativeFixture({
          ingredientRxcui: '35296',
          name: 'ramipril',
          firstApproved: '1991-01-28',
          approvedYear: 1991,
          productRxcui: '845488',
        }),
      ],
      otherClasses: [
        {
          classId: 'N0000175561',
          className: 'Angiotensin 2 Receptor Blocker',
          drugs: [
            alternativeFixture({
              ingredientRxcui: '52175',
              name: 'losartan',
              classId: 'N0000175561',
              className: 'Angiotensin 2 Receptor Blocker',
              firstApproved: '1995-04-14',
              approvedYear: 1995,
              productRxcui: '979492',
            }),
          ],
        },
        {
          classId: 'N0000191266',
          className: 'Endothelin Receptor Antagonist',
          drugs: [aprocitentan],
        },
      ],
      hidden: [],
    },
    ...overrides,
  };
}

export function alternativesFixture(
  overrides: Partial<AlternativesResponse> = {},
): AlternativesResponse {
  return {
    uses: [
      { id: 'D006333', name: 'Heart Failure' },
      { id: 'D006973', name: 'Hypertension' },
    ],
    condition: { id: 'D006973', name: 'Hypertension' },
    conditionSource: 'medication',
    medicationId: 'm1',
    ingredients: [ingredientAlternativesFixture()],
    ...overrides,
  };
}
