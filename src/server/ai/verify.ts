/**
 * Checks shared by every AI output that quotes a source (label summaries,
 * paper takeaways): quote matching, quote relevance, and the advice filter.
 */

/** Shorter quotes ("ACE", "and cough") can't meaningfully ground a sentence. */
export const MIN_QUOTE_CHARS = 12;

/** Lowercase, straight quotes, plain hyphens, single spaces, no edge punctuation. */
export function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[‘’‚‛′]/g, "'")
    .replace(/[“”„‟″]/g, '"')
    .replace(/[‐-―−]/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/^[\s"'.,;:()-]+|[\s"'.,;:()-]+$/g, '');
}

/** Advice to start, stop or change a medication: removed whatever the model wrote. */
const ADVICE = new RegExp(
  [
    String.raw`\b(stop|start|quit|discontinue|keep) (taking|using)\b`,
    String.raw`\b(do not|don['’]t|never) (take|use|stop)\b`,
    String.raw`\byou (should|must|need to) (not )?(stop|start|take|use|avoid|change|keep)\b`,
    String.raw`\b(increase|decrease|lower|raise|change|skip) (your|the) dose\b`,
    // Reader-directed recommendations, e.g. "it's better not to use very low doses".
    String.raw`\b(better|best|safer) (not )?to (use|take|start|stop|avoid|switch)\b`,
  ].join('|'),
  'i',
);

export const isAdvice = (text: string): boolean => ADVICE.test(text);

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
 * Plain words and the source terms they translate, as stems. A sentence stem in a
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
  const words = normalizeText(text).match(/[a-z]{4,}/g) ?? [];
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

/** Words to leave out of relevance checks, e.g. the drug's own names. */
export function ignoreSet(words: string[]): Set<string> {
  return new Set(words.flatMap((w) => normalizeText(w).split(/[^a-z]+/)).filter(Boolean));
}

/** A real quote only supports a sentence if they share a meaningful word (or synonym). */
export function isRelevant(sentence: string, quote: string, ignore: Set<string>): boolean {
  const quoteStems = stems(quote, ignore);
  for (const s of withSynonyms(stems(sentence, ignore))) if (quoteStems.has(s)) return true;
  return false;
}
