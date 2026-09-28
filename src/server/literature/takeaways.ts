/**
 * One plain-language takeaway per paper, written by AI from its abstract and
 * checked against that abstract (never another paper's).
 */
import { z } from 'zod';

import { createClaudeCited, type CitedBlock, type ClaudeClient } from '../ai/claude';
import { ProviderOutputError } from '../ai/errors';
import { createOllamaJson, type OllamaJson, type OllamaOptions } from '../ai/ollama';
import { ignoreSet, isAdvice, isRelevant, MIN_QUOTE_CHARS, normalizeText } from '../ai/verify';
import type { PaperTakeaway } from '../db/schema';

export interface PaperInput {
  pmid: string;
  abstract: string;
}

export const TAKEAWAY_SYSTEM_PROMPT = `You explain medical research to a patient in plain language.

For each paper (marked "### PMID <id>"), work in two steps:
1. "quote": copy, character for character, the one full sentence from that paper's results or conclusions that states its main finding.
2. "text": rewrite that quote in plain language, as one sentence. Say only what the quote says: no sample sizes, drugs, numbers or other findings that are not in the quote.

Rules:
- Keep the quote's meaning exactly: the same comparison and its direction (more or less, better or worse, higher or lower), the same groups, and whether the difference was significant. Do not reword a finding into a different claim (for example "more cost-effective" is not "cheaper").
- Say who or what was studied when the abstract says so: people (for example "adults with type 2 diabetes"), animals ("in rats"), or cells ("in lab-grown cells"). For a review, start with "This review".
- Describe it as a study ("In this trial, ..."), never as a fact about the reader.
- Use only that paper's abstract. Never add outside knowledge or mix papers.
- Do not give dosing instructions. Do not advise starting, stopping or changing any medication.
- Write one takeaway per paper and use each PMID exactly as given.`;

// Quote before text: the model writes the quote first, then rewrites only that.
export const TakeawaysSchema = z.object({
  takeaways: z.array(z.object({ pmid: z.string(), quote: z.string(), text: z.string().min(1) })),
});
export type RawTakeaways = z.infer<typeof TakeawaysSchema>;

/**
 * What the local model is asked to generate: the PMID must be digits, so the grammar
 * keeps the model from writing a sentence there (qwen2.5:7b did, shifting every field;
 * live digest run 2026-09-28). Parsing still uses the lenient TakeawaysSchema.
 */
export const TakeawaysFormat = z.object({
  takeaways: z.array(
    z.object({
      pmid: z.string().regex(/^[0-9]{1,9}$/),
      quote: z.string(),
      text: z.string().min(1),
    }),
  ),
});

/** The user message: only abstracts, each headed by its PMID. */
export function buildAbstractsMessage(papers: PaperInput[]): string {
  return papers.map((p) => `### PMID ${p.pmid}\n${p.abstract}`).join('\n\n');
}

export interface GeneratedTakeaways {
  raw: RawTakeaways;
  inputTokens?: number;
  outputTokens?: number;
}

export interface SupportItem {
  pmid: string;
  takeaway: string;
  quote: string;
}

export interface TakeawayProvider {
  name: 'ollama' | 'claude';
  model: string;
  generate(papers: PaperInput[]): Promise<GeneratedTakeaways>;
  /**
   * Second pass: does each quote on its own support its takeaway? Optional:
   * Claude's citations already tie the text to its source, so it's skipped there.
   */
  checkSupport?(items: SupportItem[]): Promise<Map<string, boolean>>;
}

export const SUPPORT_SYSTEM_PROMPT = `You check summaries of medical studies against the study's own words.

For each item (marked "### PMID <id>"), decide whether the QUOTE, on its own, supports everything the TAKEAWAY says:
- the population, the drugs or treatments, and which one did better or worse
- every number and the direction of every effect (more or less, higher or lower)
Answer supported = false if the takeaway says anything the quote doesn't state, even if it might be true elsewhere.`;

export const SupportSchema = z.object({
  checks: z.array(z.object({ pmid: z.string(), supported: z.boolean() })),
});

export function buildSupportMessage(items: SupportItem[]): string {
  return items
    .map((i) => `### PMID ${i.pmid}\nTAKEAWAY: ${i.takeaway}\nQUOTE: ${i.quote}`)
    .join('\n\n');
}

/**
 * `checkModel` turns on the support check with that model. Off by default: with
 * qwen2.5:7b the check misjudged faithful rewrites as often as it caught errors
 * (live run 2026-09-27), so its warnings would mislead.
 */
export function createOllamaTakeawayProvider(
  options: OllamaOptions,
  { checkModel }: { checkModel?: string } = {},
): TakeawayProvider {
  const ollama = createOllamaJson(options);
  const checker = checkModel ? createOllamaJson({ ...options, model: checkModel }) : null;
  return {
    name: 'ollama',
    model: ollama.model,
    async generate(papers) {
      const { data, inputTokens, outputTokens } = await ollama.generateJson({
        system: TAKEAWAY_SYSTEM_PROMPT,
        user: buildAbstractsMessage(papers),
        schema: TakeawaysSchema,
        format: TakeawaysFormat,
        inputName: 'abstracts',
      });
      return { raw: data, inputTokens, outputTokens };
    },
    checkSupport: checker ? (items) => checkWith(checker, items) : undefined,
  };
}

async function checkWith(checker: OllamaJson, items: SupportItem[]): Promise<Map<string, boolean>> {
  const { data } = await checker.generateJson({
    system: SUPPORT_SYSTEM_PROMPT,
    user: buildSupportMessage(items),
    schema: SupportSchema,
    inputName: 'takeaways to check',
  });
  const asked = new Set(items.map((i) => i.pmid));
  return new Map(
    data.checks
      .map((c) => [c.pmid.replace(/\D/g, ''), c.supported] as const)
      .filter(([pmid]) => asked.has(pmid)),
  );
}

const CLAUDE_FORMAT = `Format: for each paper, a line "## PMID <id>", then its takeaway on the next line, citing the abstract.`;

export function createClaudeTakeawayProvider({
  apiKey,
  client,
}: {
  apiKey: string;
  client?: ClaudeClient;
}): TakeawayProvider {
  const claude = createClaudeCited({ apiKey, client });
  return {
    name: 'claude',
    model: claude.model,
    async generate(papers) {
      const { blocks, inputTokens, outputTokens } = await claude.generateCited({
        system: `${TAKEAWAY_SYSTEM_PROMPT}\n\n${CLAUDE_FORMAT}`,
        documents: papers.map((p) => ({ title: `PMID ${p.pmid}`, text: p.abstract })),
        instruction: 'Write the takeaways for these papers.',
        task: 'summarize these abstracts',
        output: 'takeaways',
      });
      const raw = parseCitedTakeaways(blocks, papers);
      if (!raw.takeaways.length) {
        throw new ProviderOutputError('Claude’s takeaways did not follow the PMID headings.');
      }
      return { raw, inputTokens, outputTokens };
    },
  };
}

const PMID_LINE = /^#{1,3}\s*PMID\s*(\d+)\s*$/i;

/**
 * Rebuilds takeaways from Claude's cited text: each "## PMID <id>" line opens a
 * takeaway; its text follows, and its first citation becomes the quote.
 */
export function parseCitedTakeaways(blocks: CitedBlock[], papers: PaperInput[]): RawTakeaways {
  const takeaways: RawTakeaways['takeaways'] = [];
  let current: { pmid: string; text: string; quote: string } | undefined;
  const finish = () => {
    const text = current?.text.replace(/\s+/g, ' ').trim();
    if (current && text) takeaways.push({ ...current, text });
    current = undefined;
  };

  for (const block of blocks) {
    const cited = block.citations.find((c) => papers[c.documentIndex]);
    const lines = block.text.split('\n');
    for (const [i, line] of lines.entries()) {
      const heading = PMID_LINE.exec(line.trim());
      if (heading) {
        finish();
        current = { pmid: heading[1], text: '', quote: '' };
      } else if (current) {
        current.text += (i > 0 && current.text ? ' ' : '') + line;
        if (cited && !current.quote) current.quote = cited.citedText;
      }
    }
  }
  finish();
  return { takeaways };
}

/**
 * A takeaway describes a study; one that speaks to the reader ("your heart") or
 * recommends ("doctors should") is kept but marked, so the page can say it
 * isn't about the reader (owner's decision, 2026-09-28). The local model does
 * this despite the prompt (live digest run).
 */
const READER_DIRECTED = /\b(you|your|yours|yourself)\b|\bshould\b/i;

export const isReaderDirected = (text: string): boolean => READER_DIRECTED.test(text);

export interface VerifiedTakeaways {
  byPmid: Map<string, PaperTakeaway>;
  verifiedCount: number;
  uncitedCount: number;
  /** Takeaways dropped for advising to start, stop or change a medication. */
  removedAdvice: number;
}

/**
 * Keeps one takeaway per requested paper. A takeaway counts as cited only when
 * its quote appears in that paper's own abstract and shares a meaningful word
 * with it; unknown PMIDs and advice are dropped.
 */
export function verifyTakeaways(
  raw: RawTakeaways,
  papers: PaperInput[],
  { ignoreWords = [] }: { ignoreWords?: string[] } = {},
): VerifiedTakeaways {
  const abstracts = new Map(papers.map((p) => [p.pmid, normalizeText(p.abstract)]));
  const ignore = ignoreSet(ignoreWords);
  const byPmid = new Map<string, PaperTakeaway>();
  let removedAdvice = 0;

  /** The one requested paper whose abstract contains the quote, when the PMID is wrong. */
  const byQuote = (quote: string): string | undefined => {
    const q = normalizeText(quote);
    if (q.length < MIN_QUOTE_CHARS) return undefined;
    const found = [...abstracts].filter(([, abstract]) => abstract.includes(q));
    return found.length === 1 ? found[0][0] : undefined;
  };

  for (const entry of raw.takeaways) {
    const { pmid, text } = entry;
    let { quote } = entry;
    const digits = /^\D*(\d{1,9})\D*$/.exec(pmid)?.[1] ?? '';
    let id = abstracts.has(digits) ? digits : (byQuote(quote) ?? '');
    // Fields shifted by one (the abstract sentence where the PMID belongs): use it as the quote.
    if (!id && byQuote(pmid)) {
      id = byQuote(pmid)!;
      quote = pmid;
    }
    const abstract = abstracts.get(id);
    if (!abstract || byPmid.has(id)) continue;
    if (isAdvice(text)) {
      removedAdvice++;
      continue;
    }
    const q = normalizeText(quote);
    const verified =
      q.length >= MIN_QUOTE_CHARS && abstract.includes(q) && isRelevant(text, quote, ignore);
    byPmid.set(id, {
      text: text.trim(),
      quote: verified ? quote.trim() : null,
      uncited: !verified,
      ...(isReaderDirected(text) ? { readerDirected: true } : {}),
    });
  }

  const values = [...byPmid.values()];
  const uncitedCount = values.filter((t) => t.uncited).length;
  return { byPmid, verifiedCount: values.length - uncitedCount, uncitedCount, removedAdvice };
}

/**
 * Asks whether each linked takeaway's quote supports it, and records the answer.
 * A quote from the right abstract can still be misread (e.g. which drug ranked
 * first), so this is a second, stricter check. A failed check leaves `supported`
 * null rather than failing the takeaways.
 */
export async function checkTakeawaySupport(
  byPmid: Map<string, PaperTakeaway>,
  provider: TakeawayProvider,
): Promise<void> {
  const items = [...byPmid]
    .filter(([, t]) => !t.uncited && t.quote)
    .map(([pmid, t]) => ({ pmid, takeaway: t.text, quote: t.quote! }));
  if (!provider.checkSupport || !items.length) return;
  try {
    const answers = await provider.checkSupport(items);
    for (const { pmid } of items) {
      const takeaway = byPmid.get(pmid)!;
      takeaway.supported = answers.get(pmid) ?? null;
    }
  } catch (error) {
    console.warn(`[takeaways] support check failed: ${(error as Error).message}`);
    for (const { pmid } of items) byPmid.get(pmid)!.supported = null;
  }
}
