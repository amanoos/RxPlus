/**
 * Jev (TypeSafe's System One decision model) questions for the yes/no and
 * pick-one decisions the takeaway pipeline would otherwise spend a model call
 * on. Pure: builds request bodies and reads answers; the caller does the I/O.
 *
 * Wire shape, as spoken by .claude/skills/jev-skill-suggestion/hooks/policy.ts:
 *
 *   typesafe  POST https://api.typesafe.ai/v1/systemone
 *             `{ model, state, questions }`; a yes/no question is a `noul`
 *             and every answer carries its own `confidence`.
 *   gateway   POST https://ai-gateway.vercel.sh/v4/ai/evaluation-model
 *             `{ state, questions }` with the model in a header; a yes/no
 *             question is a `boolean` answered as `probability`.
 *
 * `state.request` is one string, so per-item content goes into each question's
 * `instructions`: one request carries every paper's question.
 *
 * Every reader fails open: a malformed body or a missing answer leaves that
 * item out of the map, and the caller keeps its current fallback (support
 * `null`, the regex study subject).
 */
import type { StudySubject } from '../literature/study-subject';
import type { SupportItem } from '../literature/takeaways';

export type JevProvider = 'typesafe' | 'gateway';

export const JEV_DEFAULT_MODEL: Record<JevProvider, string> = {
  typesafe: 'jev-latest',
  gateway: 'typesafe-ai/jev',
};

export function jevUrl(provider: JevProvider, baseUrl?: string): string {
  if (provider === 'typesafe') return `${baseUrl || 'https://api.typesafe.ai'}/v1/systemone`;
  return `${baseUrl || 'https://ai-gateway.vercel.sh/v4/ai'}/evaluation-model`;
}

export function jevHeaders(
  provider: JevProvider,
  apiKey: string,
  model = JEV_DEFAULT_MODEL[provider],
): Record<string, string> {
  const common = { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` };
  if (provider === 'typesafe') return common;
  return {
    ...common,
    'ai-gateway-auth-method': 'api-key',
    'ai-model-id': model,
    'ai-evaluation-model-specification-version': '4',
  };
}

type Questions = Record<string, Record<string, unknown>>;

export function jevBody(
  provider: JevProvider,
  request: string,
  questions: Questions,
  model = JEV_DEFAULT_MODEL[provider],
): string {
  const state = { request, recent_context: '' };
  return JSON.stringify(
    provider === 'typesafe' ? { model, state, questions } : { state, questions },
  );
}

function yesNo(provider: JevProvider, instructions: string): Record<string, unknown> {
  return { type: provider === 'typesafe' ? 'noul' : 'boolean', instructions };
}

// ---------------------------------------------------------------------------
// Support check: replaces the SUPPORT_SYSTEM_PROMPT model call (one noul per takeaway).

export const SUPPORT_REQUEST =
  "Check plain-language summaries of medical studies against the study's own words.";

/** One `supported::<pmid>` noul per takeaway, in a single request. */
export function supportQuestions(provider: JevProvider, items: SupportItem[]): Questions {
  const questions: Questions = {};
  for (const { pmid, takeaway, quote } of items) {
    questions[`supported::${pmid}`] = yesNo(
      provider,
      'Does the QUOTE, on its own, support everything the TAKEAWAY says: the population, ' +
        'the drugs or treatments, which one did better or worse, every number and the ' +
        'direction of every effect? Answer no if the takeaway says anything the quote does ' +
        `not state.\nTAKEAWAY: ${takeaway}\nQUOTE: ${quote}`,
    );
  }
  return questions;
}

// ---------------------------------------------------------------------------
// Study subject: a Choice for the papers the regex in study-subject.ts leaves null.

export const SUBJECT_REQUEST = 'Classify who or what each medical paper studied.';

/** `unclear` is how the model says the abstract doesn't tell; it reads back as null. */
export const SUBJECT_CRITERIA: Record<StudySubject | 'unclear', string> = {
  review: 'A review or meta-analysis of other studies, not new data of its own.',
  animal: 'Experiments on animals (rats, mice, dogs, pigs, zebrafish, ...).',
  lab: 'Cells, tissue or organoids in the lab, or computer models (in vitro, in silico).',
  human: 'People: patients, volunteers, a cohort, a trial or a case report.',
  unclear: 'The title and abstract do not say who or what was studied.',
};

export interface SubjectPaper {
  pmid: string;
  title: string;
  abstract: string;
}

/** One `subject::<pmid>` choice per paper. */
export function subjectQuestions(papers: SubjectPaper[]): Questions {
  const questions: Questions = {};
  for (const { pmid, title, abstract } of papers) {
    questions[`subject::${pmid}`] = {
      type: 'choice',
      instructions: `Who or what did this paper study?\nTITLE: ${title}\nABSTRACT: ${abstract}`,
      criteria: SUBJECT_CRITERIA,
    };
  }
  return questions;
}

// ---------------------------------------------------------------------------
// Answers.

type Answers = Record<string, Record<string, unknown>>;

function answersOf(responseText: string): Answers | null {
  try {
    const answers = (JSON.parse(responseText) as { answers?: unknown }).answers;
    return answers && typeof answers === 'object' ? (answers as Answers) : null;
  } catch {
    return null;
  }
}

/** P(yes): `noul` on TypeSafe, `probability` on the Gateway. */
function yesNoOf(answer: Record<string, unknown> | undefined): number | null {
  if (typeof answer?.['noul'] === 'number') return answer['noul'];
  if (typeof answer?.['probability'] === 'number') return answer['probability'];
  return null;
}

function byPrefix(answers: Answers | null, prefix: string): [string, Record<string, unknown>][] {
  return Object.entries(answers ?? {})
    .filter(([key]) => key.startsWith(prefix))
    .map(([key, answer]) => [key.slice(prefix.length), answer]);
}

/**
 * Support per PMID, the shape `TakeawayProvider.checkSupport` returns. An
 * answer whose P(yes) falls between `1 - threshold` and `threshold` is too
 * close to call and left out, so it reads as `supported: null`.
 */
export function readSupport(responseText: string, threshold = 0.7): Map<string, boolean> {
  const result = new Map<string, boolean>();
  for (const [pmid, answer] of byPrefix(answersOf(responseText), 'supported::')) {
    const p = yesNoOf(answer);
    if (p === null) continue;
    if (p >= threshold) result.set(pmid, true);
    else if (p <= 1 - threshold) result.set(pmid, false);
  }
  return result;
}

/** Study subject per PMID; `unclear` and unknown labels read as null. */
export function readSubjects(responseText: string): Map<string, StudySubject | null> {
  const result = new Map<string, StudySubject | null>();
  for (const [pmid, answer] of byPrefix(answersOf(responseText), 'subject::')) {
    const choice = answer['choice'];
    if (typeof choice !== 'string') continue;
    result.set(
      pmid,
      Object.hasOwn(SUBJECT_CRITERIA, choice) && choice !== 'unclear'
        ? (choice as StudySubject)
        : null,
    );
  }
  return result;
}
