/**
 * Newly listed drugs for the conditions the medications are taken for: rebuild
 * each condition's alternatives list and report drugs that weren't in it before
 * and were first approved within the alternatives' 5-year rule. A condition's
 * first build is a baseline.
 */
import type { AlternativesBuilder } from '../alternatives/builder';
import { isNewApproval } from '../alternatives/group';
import { listKey, type AlternativesRepository } from '../alternatives/repository';
import { errorMessage, type Collected, type Seen } from './collect';
import type { NewDigestItem } from './repository';

export interface DigestCondition {
  id: string;
  name: string;
}

export interface ApprovalsDeps {
  alternatives: Pick<AlternativesRepository, 'list' | 'drugs'>;
  builder: Pick<AlternativesBuilder, 'rebuild'>;
  seen: Seen;
  /** YYYY-MM-DD */
  today: string;
}

export async function collectApprovals(
  condition: DigestCondition,
  { alternatives, builder, seen, today }: ApprovalsDeps,
): Promise<Collected> {
  const key = listKey('condition', condition.id);
  const couldNot = (reason: string): Collected => ({
    items: [],
    notes: [`New drugs for ${condition.name} couldn't be checked: ${reason}`],
  });

  let before, after, drugs;
  try {
    // The drugs listed before the rebuild; null when the list was never built.
    before = (await alternatives.list(key))?.builtAt ? await alternatives.drugs(key) : null;
    await builder.rebuild('condition', condition.id, condition.name);
    after = await alternatives.list(key);
    drugs = after?.status === 'ready' ? await alternatives.drugs(key) : null;
  } catch (error) {
    return couldNot(errorMessage(error));
  }
  if (!drugs) return couldNot(after?.error ?? 'the list could not be built.');
  // Never built before: this build is the baseline.
  if (!before) return { items: [], notes: [] };

  const listed = new Set(before.map((d) => d.ingredientRxcui));
  const added = drugs.filter(
    (d) => !listed.has(d.ingredientRxcui) && isNewApproval(d.firstApproved, today),
  );
  const externalId = (rxcui: string) => `${condition.id}:${rxcui}`;
  const already = await seen(
    'approval',
    added.map((d) => externalId(d.ingredientRxcui)),
  );

  const items = added
    .filter((d) => !already.has(externalId(d.ingredientRxcui)))
    .map((d): NewDigestItem => ({
      kind: 'approval',
      ingredientRxcui: d.ingredientRxcui,
      productRxcui: d.productRxcui,
      conditionId: condition.id,
      subject: condition.name,
      title: d.name,
      url: d.productRxcui ? `/drugs/${d.productRxcui}` : '/drugs',
      details: { condition: condition.name, firstApproved: d.firstApproved },
      externalId: externalId(d.ingredientRxcui),
    }));
  return { items, notes: [] };
}
