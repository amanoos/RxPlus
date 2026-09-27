import { createError } from 'h3';
import { z } from 'zod';

import { db } from '../db/client';
import { createMedicationsRepository, type MedicationsRepository } from '../medications/repository';
import { openFda, OpenFdaUnavailableError, type OpenFdaClient } from '../openfda';
import { rxnav, type RxNavClient, type RxProductDetails } from '../rxnorm';
import { toHttpError as rxnavHttpError } from '../rxnorm/errors';
import { evidenceFor, type LabelEvidence } from './evidence';
import { buildReport, type CheckedDrug, type InteractionReport } from './report';
import { createInteractionsRepository, type InteractionsRepository } from './repository';

const rxcui = z.string().regex(/^\d{1,10}$/);
export const CheckQuery = z.object({ rxcui });
export const EvidenceQuery = z.object({
  a: rxcui,
  aIngredient: rxcui,
  b: rxcui,
  bIngredient: rxcui,
});

export const DDINTER_SOURCE = {
  name: 'DDInter 2.0',
  license: 'CC BY-NC-SA 4.0',
  url: 'https://ddinter2.scbdd.com',
} as const;

export interface InteractionReportResponse extends InteractionReport {
  source: typeof DDINTER_SOURCE & { importedAt: string };
}

type ProductInfo = Pick<RxProductDetails, 'rxcui' | 'name' | 'ingredients'>;

interface Deps {
  repo: InteractionsRepository;
  medications: MedicationsRepository;
  rxnav: RxNavClient;
  openFda: OpenFdaClient;
}

export function createInteractionsService({ repo, medications, rxnav, openFda }: Deps) {
  async function source() {
    const latest = await repo.latestImport();
    if (!latest) {
      throw createError({
        statusCode: 409,
        statusMessage: 'Interaction data has not been imported yet.',
        data: { code: 'no-data' },
      });
    }
    return { ...DDINTER_SOURCE, importedAt: latest.importedAt.toISOString() };
  }

  async function activeMedications(): Promise<CheckedDrug[]> {
    return (await medications.list())
      .filter((m) => m.stoppedOn === null)
      .map((m) => ({
        rxcui: m.rxcui,
        name: m.name,
        doseForm: m.doseForm,
        ingredients: m.ingredients,
        medicationId: m.id,
      }));
  }

  async function report(candidate: CheckedDrug | undefined): Promise<InteractionReportResponse> {
    const src = await source();
    const current = await activeMedications();
    const ingredients = [...(candidate ? [candidate] : []), ...current].flatMap((d) =>
      d.ingredients.map((i) => i.rxcui),
    );
    const data = await repo.dataFor(ingredients);
    return { ...buildReport({ candidate, current, ...data }), source: src };
  }

  async function resolveProduct(id: string): Promise<RxProductDetails> {
    let found: RxProductDetails | null;
    try {
      found = await rxnav.product(id);
    } catch (error) {
      throw rxnavHttpError(error);
    }
    if (!found) {
      throw createError({
        statusCode: 422,
        statusMessage: 'That is not a prescribable RxNorm product.',
      });
    }
    return found;
  }

  return {
    current: () => report(undefined),

    async check(candidateRxcui: string): Promise<InteractionReportResponse> {
      await source(); // fail fast with no-data before calling RxNav
      const p = await resolveProduct(candidateRxcui);
      return report({
        rxcui: p.rxcui,
        name: p.name,
        doseForm: p.doseForm,
        ingredients: p.ingredients,
      });
    },

    async evidence(query: z.infer<typeof EvidenceQuery>): Promise<LabelEvidence[]> {
      // Saved medications already hold their RxNorm names and ingredients; only
      // other products (e.g. the candidate, usually cached by the check) need RxNav.
      const saved = await medications.list();
      const productInfo = async (id: string): Promise<ProductInfo> =>
        saved.find((m) => m.rxcui === id) ?? resolveProduct(id);
      const [a, b] = await Promise.all([productInfo(query.a), productInfo(query.b)]);
      const side = (p: ProductInfo, ingredientRxcui: string) => {
        const ingredient = p.ingredients.find((i) => i.rxcui === ingredientRxcui);
        if (!ingredient || query.aIngredient === query.bIngredient) {
          throw createError({
            statusCode: 400,
            statusMessage: 'Ingredient does not belong to that product.',
          });
        }
        return { rxcui: p.rxcui, name: p.name, ingredient: ingredient.name, ingredientRxcui };
      };
      const pair = { a: side(a, query.aIngredient), b: side(b, query.bIngredient) };
      try {
        return await evidenceFor(pair, { openFda, rxnav });
      } catch (error) {
        if (error instanceof OpenFdaUnavailableError) {
          console.warn(`[openfda] ${error.message}`);
          const message = 'FDA label text is unavailable right now.';
          throw createError({ statusCode: 503, statusMessage: message, message });
        }
        throw rxnavHttpError(error);
      }
    },
  };
}

/** Service wired to the app database and upstream clients. */
export function interactionsService() {
  return createInteractionsService({
    repo: createInteractionsRepository(db()),
    medications: createMedicationsRepository(db()),
    rxnav: rxnav(),
    openFda: openFda(),
  });
}
