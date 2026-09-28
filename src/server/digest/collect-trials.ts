/**
 * Trial news for one ingredient: trials first posted in the window, or whose
 * results were first posted in it. Other updates (status, dates) are left out.
 */
import type { CtGovClient } from '../ctgov/client';
import {
  errorMessage,
  inWindow,
  type Collected,
  type DigestIngredient,
  type DigestWindow,
  type Seen,
} from './collect';
import type { NewDigestItem } from './repository';

export interface TrialsDeps {
  ctgov: Pick<CtGovClient, 'recentUpdates'>;
  seen: Seen;
}

export async function collectTrials(
  ingredient: DigestIngredient,
  window: DigestWindow,
  { ctgov, seen }: TrialsDeps,
): Promise<Collected> {
  let updates;
  try {
    updates = await ctgov.recentUpdates(ingredient.name, window.from);
  } catch (error) {
    return {
      items: [],
      notes: [`Trials for ${ingredient.name} couldn't be checked: ${errorMessage(error)}`],
    };
  }

  const found = updates.flatMap((trial) => {
    const event = inWindow(trial.firstPosted, window)
      ? ('new' as const)
      : inWindow(trial.resultsFirstPosted, window)
        ? ('results' as const)
        : null;
    return event ? [{ trial, event, externalId: `${trial.nctId}:${event}` }] : [];
  });
  const already = await seen(
    'trial',
    found.map((f) => f.externalId),
  );

  const items = found
    .filter((f) => !already.has(f.externalId))
    .map(({ trial, event, externalId }): NewDigestItem => ({
      kind: 'trial',
      ingredientRxcui: ingredient.rxcui,
      subject: ingredient.name,
      title: trial.title,
      url: `https://clinicaltrials.gov/study/${trial.nctId}`,
      details: { nctId: trial.nctId, event, status: trial.status, phases: trial.phases },
      externalId,
    }));
  return { items, notes: [] };
}
