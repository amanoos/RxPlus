/**
 * Provider-neutral core of the drug summary: prompt, output schema and the
 * server-side check that every quote really appears in the FDA label.
 */
import { z } from 'zod';

import { SUMMARY_SECTIONS, type SummaryLabel, type SummarySectionName } from '../openfda/client';

export const HEADINGS = [
  "What it's for",
  'How it works',
  'Common side effects',
  'Serious warnings',
  'How well it works',
] as const;
export type Heading = (typeof HEADINGS)[number];

/** Above this share of uncited sentences a summary is regenerated once. */
export const MAX_UNCITED_RATIO = 0.2;
/** Shorter quotes ("ACE", "and cough") can't meaningfully ground a sentence. */
const MIN_QUOTE_CHARS = 12;

export const SYSTEM_PROMPT = `You explain FDA drug labels to a patient in plain language.

Rules:
- Use only the label sections provided. Never add outside knowledge.
- Write at about an 8th-grade reading level, in short sentences.
- For every sentence, give the exact words from the label it is based on ("quotes"), copied character for character, and the label section they come from. Prefer quotes of one full phrase or sentence.
- If the label has nothing for a heading, write one sentence: "The label doesn't say." with no quotes.
- Do not give dosing instructions. Do not advise starting, stopping or changing any medication.
- "How well it works" reports only what the clinical studies section states, including numbers when given.
- Use exactly these headings, in this order: ${HEADINGS.map((h) => `"${h}"`).join(', ')}.`;

const QuoteSchema = z.object({
  labelSection: z.enum(SUMMARY_SECTIONS),
  text: z.string(),
});
const SentenceSchema = z.object({
  text: z.string().min(1),
  quotes: z.array(QuoteSchema),
});
export const RawSummarySchema = z.object({
  sections: z
    .array(z.object({ heading: z.enum(HEADINGS), sentences: z.array(SentenceSchema).min(1) }))
    .length(HEADINGS.length),
});
export type RawSummary = z.infer<typeof RawSummarySchema>;

/** JSON schema for providers with structured output (e.g. Ollama `format`). */
export function rawSummaryJsonSchema(): unknown {
  return z.toJSONSchema(RawSummarySchema);
}

export interface Citation {
  labelSection: SummarySectionName;
  text: string;
}
export interface VerifiedSentence {
  text: string;
  citations: Citation[];
  uncited: boolean;
  /** "The label doesn't say" sentences: honest gaps, not uncited claims. */
  noSupport?: true;
}
export interface VerifiedSummary {
  sections: { heading: Heading; sentences: VerifiedSentence[] }[];
  /** Claims (sentences other than "the label doesn't say"). */
  sentenceCount: number;
  uncitedCount: number;
  uncitedRatio: number;
  /** Sentences removed for advising to start, stop or change a medication. */
  removedAdvice: number;
}

export class SummaryFormatError extends Error {
  override readonly name = 'SummaryFormatError';
}

/** The user message: only public label text, each section named. */
export function buildLabelMessage(label: SummaryLabel): string {
  return label.sections.map((s) => `### ${s.name}\n${s.text}`).join('\n\n');
}

/** Rough token estimate (≈3.5 characters per token for English label text). */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 3.5);
}

/** Lowercase, straight quotes, plain hyphens, single spaces, no edge punctuation. */
function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[‘’‚‛′]/g, "'")
    .replace(/[“”„‟″]/g, '"')
    .replace(/[‐-―−]/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/^[\s"'.,;:()-]+|[\s"'.,;:()-]+$/g, '');
}

const NO_SUPPORT = /^the label (doesn['’]t|does not) say/i;

/** Advice to start, stop or change a medication: removed whatever the model wrote. */
const ADVICE =
  /\b(stop|start|quit|discontinue|keep) (taking|using)\b|\b(do not|don['’]t|never) (take|use|stop)\b|\byou should (stop|start|take|not take|avoid taking)\b|\b(increase|decrease|lower|raise|change|skip) (your|the) dose\b/i;

/** Words that carry no meaning for relevance (plus the drug's own names, per call). */
const STOP_WORDS = new Set(
  (
    'about above after again also been before being between both cause caused causes could does ' +
    'doing drug drugs during each even from have having help helps into less like made make many ' +
    'medicine medicines might more most much must only other over people person patient patients ' +
    'same should some such take taken takes taking than that their them then there these they ' +
    'this those through tablet tablets under until used uses using very what when where which ' +
    'while with within without would your label labels also common commonly'
  ).split(' '),
);

const STEM_LENGTH = 6;

/**
 * Plain words and the label terms they translate, as stems. A sentence stem in a
 * group matches any stem of that group (e.g. "heart attack" ~ "myocardial infarction").
 */
const SYNONYM_GROUPS = [
  ['heart', 'attack', 'myocar', 'infarc'],
  ['death', 'deaths', 'mortal', 'fatal'],
  ['pressu', 'hypert', 'hypote', 'systol', 'diasto'],
  ['kidney', 'renal'],
  ['liver', 'hepati', 'hepato'],
  ['swell', 'swelli', 'swolle', 'angioe', 'edema', 'oedema'],
  ['potass', 'hyperk'],
  ['pregna', 'fetal', 'fetus'],
  ['dizzy', 'dizzin', 'vertig', 'lighth'],
  ['sugar', 'glucos', 'hypogl', 'hyperg'],
  ['muscle', 'myopat', 'rhabdo', 'myalgi'],
  ['breath', 'dyspne'],
  ['faint', 'fainti', 'syncop'],
  ['rash', 'skin', 'dermat', 'urtica'],
  ['stomac', 'nausea', 'vomit', 'vomiti', 'gastro'],
  ['sleep', 'sleepy', 'insomn', 'drowsy', 'drowsi', 'somnol'],
  ['child', 'childr', 'kids', 'pediat', 'paedia'],
].map((group) => new Set(group));

/** Content-word stems: lowercase letters, ≥ 4 chars, not filler, first 6 letters. */
function stems(text: string, ignore: Set<string>): Set<string> {
  const words = normalize(text).match(/[a-z]{4,}/g) ?? [];
  return new Set(
    words.filter((w) => !STOP_WORDS.has(w) && !ignore.has(w)).map((w) => w.slice(0, STEM_LENGTH)),
  );
}

/** Sentence stems widened with their synonym groups. */
function withSynonyms(sentenceStems: Set<string>): Set<string> {
  const widened = new Set(sentenceStems);
  for (const group of SYNONYM_GROUPS) {
    if ([...sentenceStems].some((s) => group.has(s))) for (const s of group) widened.add(s);
  }
  return widened;
}

export interface VerifyOptions {
  /** The drug's own names (e.g. ingredient), ignored when judging relevance. */
  ignoreWords?: string[];
}

export function verifySummary(
  raw: RawSummary,
  label: SummaryLabel,
  { ignoreWords = [] }: VerifyOptions = {},
): VerifiedSummary {
  const headings = raw.sections.map((s) => s.heading);
  if (headings.join('|') !== HEADINGS.join('|')) {
    throw new SummaryFormatError(`Unexpected headings: ${headings.join(', ')}`);
  }
  const sectionText = new Map(label.sections.map((s) => [s.name, normalize(s.text)]));
  const ignore = new Set(ignoreWords.flatMap((w) => normalize(w).split(/[^a-z]+/)));

  /** The section containing the quote: the named one first, else any other. */
  const locate = (quote: Citation): SummarySectionName | null => {
    const q = normalize(quote.text);
    if (q.length < MIN_QUOTE_CHARS) return null;
    if (sectionText.get(quote.labelSection)?.includes(q)) return quote.labelSection;
    for (const [name, text] of sectionText) if (text.includes(q)) return name;
    return null;
  };

  /** A real quote only supports a sentence if they share a meaningful word. */
  const relevant = (sentence: string, quote: string) => {
    const quoteStems = stems(quote, ignore);
    for (const s of withSynonyms(stems(sentence, ignore))) if (quoteStems.has(s)) return true;
    return false;
  };

  let sentenceCount = 0;
  let uncitedCount = 0;
  let removedAdvice = 0;
  const sections = raw.sections.map(({ heading, sentences }) => ({
    heading,
    sentences: sentences.flatMap((sentence): VerifiedSentence[] => {
      if (ADVICE.test(sentence.text)) {
        removedAdvice++;
        return [];
      }
      if (NO_SUPPORT.test(sentence.text.trim()) && !sentence.quotes.length) {
        return [{ text: sentence.text, citations: [], uncited: false, noSupport: true }];
      }
      // Only claims count toward the ratio; "doesn't say" gaps are not claims.
      sentenceCount++;
      const citations = sentence.quotes.flatMap((quote) => {
        const found = locate(quote);
        return found && relevant(sentence.text, quote.text)
          ? [{ labelSection: found, text: quote.text.trim() }]
          : [];
      });
      const uncited = citations.length === 0;
      if (uncited) uncitedCount++;
      return [{ text: sentence.text, citations, uncited }];
    }),
  }));

  return {
    sections,
    sentenceCount,
    uncitedCount,
    uncitedRatio: sentenceCount ? uncitedCount / sentenceCount : 0,
    removedAdvice,
  };
}
