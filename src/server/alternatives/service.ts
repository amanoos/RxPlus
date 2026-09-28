/**
 * Alternatives for a drug page: per ingredient, drugs in the same class and, for
 * the condition it's taken for, new drugs and other classes. No AI.
 */
import { createError } from 'h3';
import { z } from 'zod';

import { db } from '../db/client';
import { drugFactsService } from '../drug-info/facts';
import { createMedicationsRepository, type MedicationsRepository } from '../medications/repository';
import { openFda } from '../openfda';
import { rxnav, type RxNavClient } from '../rxnorm';
import type { RxClassRef } from '../rxnorm/client';
import { createAlternativesBuilder, type AlternativesBuilder } from './builder';
import { groupAlternatives, type AlternativeGroups } from './group';
import {
  createAlternativesRepository,
  type AlternativeList,
  type AlternativesRepository,
} from './repository';

export const ConditionQuery = z.object({
  condition: z
    .string()
    .regex(/^D\d{6,9}$/)
    .optional(),
});
export const HiddenParams = z.object({
  ingredient: z.string().regex(/^\d{1,10}$/),
  rxcui: z.string().regex(/^\d{1,10}$/),
});

export interface ListStatus {
  status: AlternativeList['status'];
  builtAt: string | null;
  skipped: number | null;
  error: string | null;
}

export interface IngredientAlternatives {
  rxcui: string;
  name: string;
  /** The ingredient's FDA class. */
  drugClass: RxClassRef | null;
  classList: ListStatus | null;
  conditionList: ListStatus | null;
  groups: AlternativeGroups;
}

export interface AlternativesResponse {
  /** Known uses of the product (for the "taken for" choice). */
  uses: RxClassRef[];
  /** The chosen condition, from the medication or the request. */
  condition: RxClassRef | null;
  /** Where the choice is stored: the medication, or only this visit. */
  conditionSource: 'medication' | 'visit' | null;
  /** The saved medication for this product, if it's on the list. */
  medicationId: string | null;
  ingredients: IngredientAlternatives[];
}

interface Deps {
  repo: AlternativesRepository;
  builder: Pick<AlternativesBuilder, 'ensure'>;
  medications: Pick<MedicationsRepository, 'list'>;
  rxnav: Pick<RxNavClient, 'drugFacts' | 'epcClasses'>;
  /** The product's ingredients (saved medications skip RxNav). */
  ingredients: (rxcui: string) => Promise<{ rxcui: string; name: string }[]>;
  today?: () => string;
}

const status = (list: AlternativeList | null): ListStatus | null =>
  list && {
    status: list.status,
    builtAt: list.builtAt?.toISOString() ?? null,
    skipped: list.skipped,
    error: list.error,
  };

export function createAlternativesService({
  repo,
  builder,
  medications,
  rxnav,
  ingredients,
  today = () => new Date().toISOString().slice(0, 10),
}: Deps) {
  async function load(
    rxcui: string,
    conditionId: string | undefined,
    { force = false }: { force?: boolean } = {},
  ): Promise<AlternativesResponse> {
    const ings = await ingredients(rxcui);
    const facts = await Promise.all(ings.map((i) => rxnav.drugFacts(i.rxcui)));
    const uses = [...new Map(facts.flatMap((f) => f.uses).map((u) => [u.id, u])).values()].sort(
      (a, b) => a.name.localeCompare(b.name),
    );

    // Active medication first, then any earlier one, for this product.
    const saved = (await medications.list()).filter((m) => m.rxcui === rxcui);
    const medication = saved.find((m) => !m.stoppedOn) ?? saved[0] ?? null;
    let condition: RxClassRef | null = null;
    let conditionSource: AlternativesResponse['conditionSource'] = null;
    if (conditionId) {
      const use = uses.find((u) => u.id === conditionId);
      if (!use) {
        throw createError({
          statusCode: 400,
          statusMessage: 'That condition isn’t a known use of this drug.',
        });
      }
      condition = use;
      conditionSource = 'visit';
    } else if (medication?.takenForId && medication.takenForName) {
      condition = { id: medication.takenForId, name: medication.takenForName };
      conditionSource = 'medication';
    }

    const conditionKey = condition
      ? await builder.ensure('condition', condition.id, condition.name, { force })
      : null;
    const conditionList = conditionKey ? await repo.list(conditionKey) : null;
    const conditionDrugs =
      conditionKey && conditionList?.builtAt ? await repo.drugs(conditionKey) : null;

    const result: IngredientAlternatives[] = [];
    for (const ing of ings) {
      const drugClass = (await rxnav.epcClasses(ing.rxcui))[0] ?? null;
      const classKey = drugClass
        ? await builder.ensure('class', drugClass.id, drugClass.name, { force })
        : null;
      const classList = classKey ? await repo.list(classKey) : null;
      // Drugs from the last build stay visible while a rebuild runs.
      const classDrugs = classKey && classList?.builtAt ? await repo.drugs(classKey) : null;
      result.push({
        rxcui: ing.rxcui,
        name: ing.name,
        drugClass,
        classList: status(classList),
        conditionList: status(conditionList),
        groups: groupAlternatives({
          ingredientRxcui: ing.rxcui,
          classId: drugClass?.id ?? null,
          classDrugs,
          conditionDrugs,
          hidden: await repo.hidden(ing.rxcui),
          today: today(),
        }),
      });
    }
    return {
      uses,
      condition,
      conditionSource,
      medicationId: medication?.id ?? null,
      ingredients: result,
    };
  }

  return {
    /** Lists for a drug page; missing or stale lists start building in the background. */
    get: (rxcui: string, conditionId?: string) => load(rxcui, conditionId),

    /** "Check for new approvals": rebuilds this drug's lists now. */
    refresh: (rxcui: string, conditionId?: string) => load(rxcui, conditionId, { force: true }),

    hide: (ingredient: string, hiddenRxcui: string) => repo.hide(ingredient, hiddenRxcui),
    unhide: (ingredient: string, hiddenRxcui: string) => repo.unhide(ingredient, hiddenRxcui),
  };
}

/** One builder per process, so every build shares the same openFDA pacing. */
let sharedBuilder: AlternativesBuilder | undefined;

/** Service wired to the app database and upstream clients. */
export function alternativesService() {
  const repo = createAlternativesRepository(db());
  const facts = drugFactsService();
  sharedBuilder ??= createAlternativesBuilder({ repo, rxnav: rxnav(), openFda: openFda() });
  return createAlternativesService({
    repo,
    builder: sharedBuilder,
    medications: createMedicationsRepository(db()),
    rxnav: rxnav(),
    ingredients: async (rxcui) => (await facts.product(rxcui)).ingredients,
  });
}
