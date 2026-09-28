/**
 * New papers for one ingredient: the most relevant ones entered in PubMed during
 * the window and not reported before, each with an AI takeaway; the rest counted
 * with a link to the same search on PubMed.
 */
import { InputTooLargeError, ProviderOutputError, ProviderUnavailableError } from '../ai/errors';
import type { PaperTakeaway } from '../db/schema';
import type { TakeawayChoice } from '../literature/providers';
import { checkTakeawaySupport, verifyTakeaways } from '../literature/takeaways';
import type { PubMedClient } from '../pubmed/client';
import {
  errorMessage,
  type Collected,
  type DigestIngredient,
  type DigestWindow,
  type Seen,
} from './collect';
import type { NewDigestItem } from './repository';

/** Papers listed (with takeaways) per ingredient. */
export const PAPERS_PER_INGREDIENT = 5;
/** Candidates asked for, so papers reported before can be skipped. */
const CANDIDATES = 20;

export interface PapersDeps {
  pubmed: Pick<PubMedClient, 'recentPapers' | 'paperDetails' | 'abstracts'>;
  seen: Seen;
  /** The takeaway provider for this call (daily limit already applied). */
  takeaways: () => Promise<TakeawayChoice>;
}

export async function collectPapers(
  ingredient: DigestIngredient,
  window: DigestWindow,
  { pubmed, seen, takeaways }: PapersDeps,
): Promise<Collected> {
  const { name } = ingredient;
  let found;
  try {
    const recent = await pubmed.recentPapers(name, { ...window, limit: CANDIDATES });
    const already = await seen('paper', recent.pmids);
    const pmids = recent.pmids.filter((p) => !already.has(p)).slice(0, PAPERS_PER_INGREDIENT);
    const [details, abstracts] = pmids.length
      ? await Promise.all([pubmed.paperDetails(pmids), pubmed.abstracts(pmids)])
      : [[], new Map<string, string>()];
    found = { recent, already, details, abstracts };
  } catch (error) {
    return {
      items: [],
      notes: [`New papers for ${name} couldn't be checked: ${errorMessage(error)}`],
    };
  }

  const { recent, already, details, abstracts } = found;
  const notes: string[] = [];
  const byPmid = details.length
    ? await writeTakeaways(ingredient, details, abstracts, takeaways, notes)
    : new Map<string, PaperTakeaway>();

  const items: NewDigestItem[] = details.map((paper) => {
    const takeaway = byPmid.get(paper.pmid);
    return {
      kind: 'paper',
      ingredientRxcui: ingredient.rxcui,
      subject: name,
      title: paper.title,
      url: `https://pubmed.ncbi.nlm.nih.gov/${paper.pmid}/`,
      details: { journal: paper.journal, year: paper.year, studyType: paper.studyType },
      takeaway: takeaway?.text ? takeaway : null,
      externalId: paper.pmid,
    };
  });

  const more = recent.total - details.length - already.size;
  if (more > 0) {
    items.push({
      kind: 'more-papers',
      ingredientRxcui: ingredient.rxcui,
      subject: name,
      title: `${more} more new ${more === 1 ? 'paper' : 'papers'} on PubMed`,
      url: recent.searchUrl,
      details: { count: more },
    });
  }
  return { items, notes };
}

/** One model call for the ingredient's papers; failures become a note, not an error. */
async function writeTakeaways(
  ingredient: DigestIngredient,
  papers: { pmid: string }[],
  abstracts: Map<string, string>,
  takeaways: () => Promise<TakeawayChoice>,
  notes: string[],
): Promise<Map<string, PaperTakeaway>> {
  const input = papers.flatMap((p) => {
    const abstract = abstracts.get(p.pmid);
    return abstract ? [{ pmid: p.pmid, abstract }] : [];
  });
  if (!input.length) return new Map();
  const fail = (reason: string) => {
    notes.push(`Takeaways for ${ingredient.name} couldn't be written: ${reason}`);
    return new Map<string, PaperTakeaway>();
  };

  const choice = await takeaways();
  if (!choice.provider) return fail(choice.unavailable);
  try {
    const { raw } = await choice.provider.generate(input);
    const { byPmid } = verifyTakeaways(raw, input, { ignoreWords: [ingredient.name] });
    await checkTakeawaySupport(byPmid, choice.provider);
    const written = [...byPmid.values()].filter((t) => t.text).length;
    if (written < input.length) {
      notes.push(
        `Takeaways for ${ingredient.name}: ${written} of ${input.length} papers got one; the model's answer didn't match the rest.`,
      );
    }
    return byPmid;
  } catch (error) {
    const known =
      error instanceof ProviderUnavailableError ||
      error instanceof ProviderOutputError ||
      error instanceof InputTooLargeError;
    if (!known) console.error('[digest] takeaway generation failed:', error);
    return fail(known ? errorMessage(error) : 'the model call failed.');
  }
}
