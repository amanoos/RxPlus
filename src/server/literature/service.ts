/**
 * Research lists per ingredient: papers from PubMed and trials from
 * ClinicalTrials.gov, searched once, stored, and refreshed after 30 days.
 */
import { createError } from 'h3';
import { z } from 'zod';

import { ctGov, CtGovUnavailableError, type CtGovClient } from '../ctgov';
import { db } from '../db/client';
import type { PaperTakeaway } from '../db/schema';
import { drugFactsService } from '../drug-info/facts';
import { pubMed, PubMedUnavailableError, type PubMedClient } from '../pubmed';
import {
  createLiteratureRepository,
  type FetchedPaper,
  type LiteratureList,
  type LiteraturePaper,
  type LiteratureRepository,
  type LiteratureTrial,
} from './repository';

export const REFRESH_AFTER_MS = 30 * 24 * 60 * 60 * 1000;

export const PaperParams = z.object({
  ingredient: z.string().regex(/^\d{1,10}$/),
  pmid: z.string().regex(/^\d{1,10}$/),
});

export interface PaperView {
  pmid: string;
  tier: LiteraturePaper['tier'];
  studyType: LiteraturePaper['studyType'];
  title: string;
  journal: string | null;
  year: number | null;
  pubmedUrl: string;
  /** Free full text on PubMed Central, when available. */
  fullTextUrl: string | null;
  takeaway: PaperTakeaway | null;
}

export interface TrialView {
  nctId: string;
  title: string;
  status: string;
  phases: string[];
  hasResults: boolean;
  startDate: string | null;
  url: string;
}

export interface IngredientLiterature {
  rxcui: string;
  name: string;
  fetchedAt: string;
  papers: PaperView[];
  hidden: PaperView[];
  trials: TrialView[];
  takeaways: {
    status: LiteratureList['takeawayStatus'];
    provider: LiteratureList['provider'];
    model: string | null;
    error: string | null;
    startedAt: string | null;
  };
}

export interface LiteratureResponse {
  ingredients: IngredientLiterature[];
}

interface Ingredient {
  rxcui: string;
  name: string;
}

interface Deps {
  repo: LiteratureRepository;
  pubMed: PubMedClient;
  ctGov: CtGovClient;
  /** The product's ingredients (saved medications skip RxNav). */
  ingredients: (rxcui: string) => Promise<Ingredient[]>;
  now?: () => number;
}

/** Background refreshes; tests await them via settleLiteratureJobs(). */
const jobs = new Set<Promise<unknown>>();
/** One search per ingredient at a time, shared by concurrent requests. */
const inflight = new Map<string, Promise<void>>();

export async function settleLiteratureJobs(): Promise<void> {
  await Promise.allSettled([...jobs]);
}

const unavailable = (message: string) =>
  createError({ statusCode: 503, statusMessage: message, message });

function paperView(p: LiteraturePaper): PaperView {
  return {
    pmid: p.pmid,
    tier: p.tier,
    studyType: p.studyType,
    title: p.title,
    journal: p.journal,
    year: p.year,
    pubmedUrl: `https://pubmed.ncbi.nlm.nih.gov/${p.pmid}/`,
    fullTextUrl: p.pmcid ? `https://pmc.ncbi.nlm.nih.gov/articles/${p.pmcid}/` : null,
    takeaway: p.takeaway,
  };
}

function trialView(t: LiteratureTrial): TrialView {
  return {
    nctId: t.nctId,
    title: t.title,
    status: t.status,
    phases: t.phases,
    hasResults: t.hasResults,
    startDate: t.startDate,
    url: `https://clinicaltrials.gov/study/${t.nctId}`,
  };
}

export function createLiteratureService({
  repo,
  pubMed,
  ctGov,
  ingredients,
  now = Date.now,
}: Deps) {
  /** Searches PubMed and ClinicalTrials.gov and stores the result. */
  async function search(ingredient: Ingredient): Promise<void> {
    const { reviews, rcts } = await pubMed.searchPapers(ingredient.name);
    const pmids = [...reviews, ...rcts];
    const details = await pubMed.paperDetails(pmids);
    const abstracts = await pubMed.abstracts(pmids);
    const papers: FetchedPaper[] = details.flatMap((d) => {
      const abstract = abstracts.get(d.pmid);
      if (!abstract) return [];
      const inReviews = reviews.indexOf(d.pmid);
      return [
        {
          ...d,
          tier: inReviews >= 0 ? 'review' : 'rct',
          rank: inReviews >= 0 ? inReviews : rcts.indexOf(d.pmid),
          abstract,
        },
      ];
    });

    let trials;
    try {
      trials = (await ctGov.trials(ingredient.name)).map((t, rank) => ({ ...t, rank }));
    } catch (error) {
      // Papers still update; the stored trials are kept.
      if (!(error instanceof CtGovUnavailableError)) throw error;
      console.warn(`[literature] ${error.message}`);
    }
    await repo.saveFetched({
      ingredientRxcui: ingredient.rxcui,
      ingredientName: ingredient.name,
      papers,
      trials,
    });
  }

  function searchOnce(ingredient: Ingredient): Promise<void> {
    let running = inflight.get(ingredient.rxcui);
    if (!running) {
      running = search(ingredient).finally(() => inflight.delete(ingredient.rxcui));
      inflight.set(ingredient.rxcui, running);
    }
    return running;
  }

  async function searchOrFail(ingredient: Ingredient): Promise<void> {
    try {
      await searchOnce(ingredient);
    } catch (error) {
      if (error instanceof PubMedUnavailableError) {
        console.warn(`[literature] ${error.message}`);
        throw unavailable('PubMed is unavailable right now. Try again later.');
      }
      throw error;
    }
  }

  async function view(ingredient: Ingredient, list: LiteratureList): Promise<IngredientLiterature> {
    const [papers, hidden, trials] = await Promise.all([
      repo.shownPapers(ingredient.rxcui),
      repo.hiddenPapers(ingredient.rxcui),
      repo.trials(ingredient.rxcui),
    ]);
    return {
      rxcui: ingredient.rxcui,
      name: ingredient.name,
      fetchedAt: list.fetchedAt.toISOString(),
      papers: papers.map(paperView),
      hidden: hidden.map(paperView),
      trials: trials.map(trialView),
      takeaways: {
        status: list.takeawayStatus,
        provider: list.provider,
        model: list.model,
        error: list.error,
        startedAt: list.startedAt?.toISOString() ?? null,
      },
    };
  }

  /** Loads (and on first use, searches) one ingredient's lists. */
  async function ingredientLiterature(ingredient: Ingredient): Promise<IngredientLiterature> {
    let list = await repo.list(ingredient.rxcui);
    if (!list) {
      await searchOrFail(ingredient);
      list = (await repo.list(ingredient.rxcui))!;
    } else if (now() - list.fetchedAt.getTime() > REFRESH_AFTER_MS) {
      // Serve what's stored now; the next visit sees the refreshed lists.
      const job = searchOnce(ingredient).catch((error: unknown) => {
        console.warn(`[literature] background refresh failed: ${(error as Error).message}`);
      });
      jobs.add(job);
      void job.finally(() => jobs.delete(job));
    }
    return view(ingredient, list);
  }

  return {
    async get(rxcui: string): Promise<LiteratureResponse> {
      const result: IngredientLiterature[] = [];
      // One ingredient at a time keeps NCBI's request queue short.
      for (const ingredient of await ingredients(rxcui)) {
        result.push(await ingredientLiterature(ingredient));
      }
      return { ingredients: result };
    },

    /** "Check for new research": searches every ingredient now. */
    async refresh(rxcui: string): Promise<LiteratureResponse> {
      const result: IngredientLiterature[] = [];
      for (const ingredient of await ingredients(rxcui)) {
        await searchOrFail(ingredient);
        result.push(await view(ingredient, (await repo.list(ingredient.rxcui))!));
      }
      return { ingredients: result };
    },

    async setHidden(ingredientRxcui: string, pmid: string, hidden: boolean): Promise<void> {
      if (!(await repo.setHidden(ingredientRxcui, pmid, hidden))) {
        throw createError({ statusCode: 404, statusMessage: 'Paper not found.' });
      }
    },
  };
}

/** Service wired to the app database and upstream clients. */
export function literatureService() {
  const facts = drugFactsService();
  return createLiteratureService({
    repo: createLiteratureRepository(db()),
    pubMed: pubMed(),
    ctGov: ctGov(),
    ingredients: async (rxcui) => (await facts.product(rxcui)).ingredients,
  });
}
