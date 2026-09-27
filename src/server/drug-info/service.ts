/**
 * AI summaries: one per product and FDA label version, generated in the background
 * after a 202 and polled by the page.
 */
import { createError } from 'h3';

import { db } from '../db/client';
import { openFda, OpenFdaUnavailableError, type OpenFdaClient } from '../openfda';
import type { SummaryLabel } from '../openfda/client';
import { env } from '../utils/env';
import { drugFactsService } from './facts';
import {
  LabelTooLargeError,
  ProviderOutputError,
  ProviderUnavailableError,
  summaryProvider,
  type ProviderChoice,
  type SummaryProvider,
} from './providers';
import { createSummaryRepository, type DrugSummary, type SummaryRepository } from './repository';
import {
  MAX_UNCITED_RATIO,
  SummaryFormatError,
  verifySummary,
  type VerifiedSummary,
} from './summary';

export interface SummaryResponse {
  status: 'pending' | 'ready' | 'failed';
  provider: DrugSummary['provider'];
  model: string;
  label: { setId: string; version: string; effectiveDate: string | null; dailyMedUrl: string };
  sections: NonNullable<DrugSummary['sections']> | null;
  sentenceCount: number | null;
  uncitedCount: number | null;
  removedAdvice: number | null;
  /** More than 20% of claims couldn't be linked to the label, even after a retry. */
  lowCitation: boolean;
  error: string | null;
  startedAt: string;
  completedAt: string | null;
}

interface Deps {
  repo: SummaryRepository;
  openFda: OpenFdaClient;
  provider: () => ProviderChoice;
  /** The product's ingredient names, ignored when judging quote relevance. */
  drugNames: (rxcui: string) => Promise<string[]>;
  dailyLimit: number;
  timeZone: string;
}

/** In-flight generations; tests await them via settleSummaryJobs(). */
const jobs = new Set<Promise<void>>();

export async function settleSummaryJobs(): Promise<void> {
  await Promise.allSettled([...jobs]);
}

const fail = (statusCode: number, message: string) =>
  createError({ statusCode, statusMessage: message, message });

export function createSummaryService(deps: Deps) {
  async function currentLabel(rxcui: string): Promise<SummaryLabel> {
    let label: SummaryLabel | null;
    try {
      label = await deps.openFda.summaryLabel(rxcui);
    } catch (error) {
      if (error instanceof OpenFdaUnavailableError) {
        throw fail(503, 'The FDA label is unavailable right now.');
      }
      throw error;
    }
    if (!label) throw fail(422, 'There is no FDA label to summarize for this product.');
    return label;
  }

  const keyOf = (rxcui: string, label: SummaryLabel) => ({
    rxcui,
    labelSetId: label.setId,
    labelVersion: label.version,
  });

  function toResponse(row: DrugSummary, label: SummaryLabel): SummaryResponse {
    return {
      status: row.status,
      provider: row.provider,
      model: row.model,
      label: {
        setId: label.setId,
        version: label.version,
        effectiveDate: label.effectiveDate,
        dailyMedUrl: label.dailyMedUrl,
      },
      sections: row.sections,
      sentenceCount: row.sentenceCount,
      uncitedCount: row.uncitedCount,
      removedAdvice: row.removedAdvice,
      lowCitation: ratio(row) > MAX_UNCITED_RATIO,
      error: row.error,
      startedAt: row.startedAt.toISOString(),
      completedAt: row.completedAt?.toISOString() ?? null,
    };
  }

  /** Generates, verifies, retries once on too many uncited claims, and stores the result. */
  async function generate(
    row: DrugSummary,
    label: SummaryLabel,
    provider: SummaryProvider,
    ignoreWords: string[],
  ): Promise<void> {
    let inputTokens = 0;
    let outputTokens = 0;
    const attempt = async (): Promise<VerifiedSummary> => {
      const generated = await provider.generate(label);
      inputTokens += generated.inputTokens ?? 0;
      outputTokens += generated.outputTokens ?? 0;
      return verifySummary(generated.raw, label, { ignoreWords });
    };

    try {
      let best = await attempt();
      if (best.uncitedRatio > MAX_UNCITED_RATIO) {
        const second = await attempt().catch(() => null);
        if (second && second.uncitedRatio < best.uncitedRatio) best = second;
      }
      await deps.repo.complete(row.id, {
        sections: best.sections,
        sentenceCount: best.sentenceCount,
        uncitedCount: best.uncitedCount,
        removedAdvice: best.removedAdvice,
        inputTokens: inputTokens || null,
        outputTokens: outputTokens || null,
      });
    } catch (error) {
      const known =
        error instanceof ProviderUnavailableError ||
        error instanceof ProviderOutputError ||
        error instanceof LabelTooLargeError ||
        error instanceof SummaryFormatError;
      if (!known) console.error('[summary] generation failed:', error);
      const message = known ? (error as Error).message : 'The summary could not be generated.';
      await deps.repo.fail(row.id, message).catch((e: unknown) => {
        console.error('[summary] could not record the failure:', e);
      });
    }
  }

  return {
    /** The stored summary for the product's current label; 404 when there is none. */
    async get(rxcui: string): Promise<SummaryResponse> {
      const label = await currentLabel(rxcui);
      const row = await deps.repo.find(keyOf(rxcui, label));
      if (!row) throw fail(404, 'No summary yet.');
      return toResponse(row, label);
    },

    /** Starts generation for the current label; idempotent while pending or ready. */
    async start(rxcui: string): Promise<SummaryResponse> {
      const label = await currentLabel(rxcui);
      const key = keyOf(rxcui, label);
      const existing = await deps.repo.find(key);
      if (existing && existing.status !== 'failed') return toResponse(existing, label);

      const choice = deps.provider();
      if (!choice.provider) throw fail(503, `AI summary unavailable: ${choice.unavailable}`);
      const { provider } = choice;
      if (
        provider.name === 'claude' &&
        (await deps.repo.startedToday('claude', deps.timeZone)) >= deps.dailyLimit
      ) {
        throw fail(429, `The daily limit of ${deps.dailyLimit} Claude summaries has been reached.`);
      }

      const ignoreWords = await deps.drugNames(rxcui);
      const row = await deps.repo.claim({
        ...key,
        labelEffectiveDate: label.effectiveDate,
        provider: provider.name,
        model: provider.model,
      });
      // Someone else claimed it between find() and claim(): report their row.
      if (!row) return toResponse((await deps.repo.find(key))!, label);

      const job = generate(row, label, provider, ignoreWords);
      jobs.add(job);
      void job.finally(() => jobs.delete(job));
      return toResponse(row, label);
    },
  };
}

function ratio(row: DrugSummary): number {
  return row.sentenceCount ? (row.uncitedCount ?? 0) / row.sentenceCount : 0;
}

/** Service wired to the app database, openFDA and the configured provider. */
export function summaryService() {
  const config = env();
  const facts = drugFactsService();
  return createSummaryService({
    repo: createSummaryRepository(db()),
    openFda: openFda(),
    provider: summaryProvider,
    drugNames: async (rxcui) => {
      const product = await facts.product(rxcui);
      return [product.brandName ?? '', ...product.ingredients.map((i) => i.name)];
    },
    dailyLimit: config.AI_DAILY_LIMIT,
    timeZone: config.TZ,
  });
}
