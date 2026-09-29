import { createError } from 'h3';
import { z } from 'zod';

import { db } from '../db/client';
import { createMedicationsRepository, type MedicationsRepository } from '../medications/repository';
import { medlinePlus, type MedlinePlusClient } from '../medlineplus';
import { openFda, OpenFdaUnavailableError, type OpenFdaClient } from '../openfda';
import { rxnav, type RxNavClient, type RxProductDetails } from '../rxnorm';
import { toHttpError as rxnavHttpError } from '../rxnorm/errors';

export const DrugParams = z.object({ rxcui: z.string().regex(/^\d{1,10}$/) });

export const FAERS_DISCLAIMER =
  'Reports submitted to the FDA by patients and professionals. A report doesn’t prove the ' +
  'drug caused the reaction, and counts aren’t how often it happens. See the label’s side ' +
  'effects for frequencies from clinical trials.';

type Product = Pick<
  RxProductDetails,
  'rxcui' | 'name' | 'tty' | 'strength' | 'doseForm' | 'brandName' | 'ingredients'
>;

export interface DrugFactsResponse extends Product {
  epcClasses: string[];
  atcClasses: string[];
  mayTreat: string[];
  mayPrevent: string[];
  avoidWith: string[];
  /** Known uses with their MED-RT ids (for "taken for"), across ingredients. */
  uses: { id: string; name: string }[];
  label: {
    setId: string;
    version: string;
    effectiveDate: string | null;
    manufacturer: string | null;
    dailyMedUrl: string;
  } | null;
  medlinePlus: { ingredient: string; title: string; url: string }[];
  /** Optional sources that failed this time (the page still renders). */
  unavailable: ('RxClass' | 'FDA label' | 'MedlinePlus')[];
}

export interface ReportedReactionsResponse {
  ingredients: {
    ingredient: string;
    total: number;
    reactions: { term: string; count: number }[];
  }[];
  disclaimer: string;
}

interface Deps {
  medications: Pick<MedicationsRepository, 'productByRxcui'>;
  rxnav: RxNavClient;
  openFda: OpenFdaClient;
  medlinePlus: MedlinePlusClient;
}

const union = (lists: string[][]) => [...new Set(lists.flat())].sort((a, b) => a.localeCompare(b));

export function createDrugFactsService({ medications, rxnav, openFda, medlinePlus }: Deps) {
  /** Saved medications already hold RxNorm details; others are resolved via RxNav. */
  async function product(rxcui: string): Promise<Product> {
    const saved = await medications.productByRxcui(rxcui);
    if (saved) return saved;
    let found: RxProductDetails | null;
    try {
      found = await rxnav.product(rxcui);
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
    product,

    async facts(rxcui: string): Promise<DrugFactsResponse> {
      const p = await product(rxcui);
      const unavailable: DrugFactsResponse['unavailable'] = [];
      const optional = <T>(
        source: DrugFactsResponse['unavailable'][number],
        work: Promise<T>,
        fallback: T,
      ) =>
        work.catch(() => {
          if (!unavailable.includes(source)) unavailable.push(source);
          return fallback;
        });

      const [facts, label, pages] = await Promise.all([
        Promise.all(p.ingredients.map((i) => optional('RxClass', rxnav.drugFacts(i.rxcui), null))),
        optional('FDA label', openFda.summaryLabel(rxcui), null),
        Promise.all(
          p.ingredients.map(async (i) => {
            const page = await optional('MedlinePlus', medlinePlus.drugPage(i.rxcui), null);
            return page ? [{ ingredient: i.name, ...page }] : [];
          }),
        ),
      ]);
      const known = facts.filter((f) => f !== null);

      return {
        rxcui: p.rxcui,
        name: p.name,
        tty: p.tty,
        strength: p.strength,
        doseForm: p.doseForm,
        brandName: p.brandName,
        ingredients: p.ingredients,
        epcClasses: union(known.map((f) => f.epcClasses)),
        atcClasses: union(known.map((f) => f.atcClasses)),
        mayTreat: union(known.map((f) => f.mayTreat)),
        mayPrevent: union(known.map((f) => f.mayPrevent)),
        avoidWith: union(known.map((f) => f.avoidWith)),
        uses: [...new Map(known.flatMap((f) => f.uses).map((u) => [u.id, u])).values()].sort(
          (a, b) => a.name.localeCompare(b.name),
        ),
        label: label
          ? {
              setId: label.setId,
              version: label.version,
              effectiveDate: label.effectiveDate,
              manufacturer: label.manufacturer,
              dailyMedUrl: label.dailyMedUrl,
            }
          : null,
        medlinePlus: pages.flat(),
        unavailable,
      };
    },

    async reportedReactions(rxcui: string): Promise<ReportedReactionsResponse> {
      const p = await product(rxcui);
      try {
        const ingredients = await Promise.all(
          p.ingredients.map(async (i) => ({
            ingredient: i.name,
            ...(await openFda.reportedReactions(i.name)),
          })),
        );
        return { ingredients, disclaimer: FAERS_DISCLAIMER };
      } catch (error) {
        if (error instanceof OpenFdaUnavailableError) {
          console.warn(`[openfda] ${error.message}`);
          const message = 'FDA adverse event reports are unavailable right now.';
          throw createError({ statusCode: 503, statusMessage: message, message });
        }
        throw error;
      }
    },
  };
}

/** Service wired to the app database and upstream clients. */
export function drugFactsService() {
  return createDrugFactsService({
    medications: createMedicationsRepository(db()),
    rxnav: rxnav(),
    openFda: openFda(),
    medlinePlus: medlinePlus(),
  });
}
