/**
 * One plain-language takeaway per paper, written by AI from its abstract and
 * checked against that abstract (never another paper's).
 */
import { z } from 'zod';

import { createClaudeCited, type CitedBlock, type ClaudeClient } from '../ai/claude';
import { ProviderOutputError } from '../ai/errors';
import { createOllamaJson, type OllamaOptions } from '../ai/ollama';
import { ignoreSet, isAdvice, isRelevant, MIN_QUOTE_CHARS, normalizeText } from '../ai/verify';
import type { PaperTakeaway } from '../db/schema';

export interface PaperInput {
  pmid: string;
  abstract: string;
}

export const TAKEAWAY_SYSTEM_PROMPT = `You explain medical research to a patient in plain language.

For each paper (marked "### PMID <id>"), write one takeaway:
- One sentence (two at most) saying what the study found: who was studied and the main result, with numbers when the abstract gives them.
- Describe it as a study ("In a trial of 200 adults with high blood pressure, ..."), never as a fact about the reader.
- Use only that paper's abstract. Never add outside knowledge or mix papers.
- Give the exact words from that abstract the takeaway is based on ("quote"), copied character for character. Prefer a sentence from the results or conclusions.
- Do not give dosing instructions. Do not advise starting, stopping or changing any medication.
- Write one takeaway per paper and use each PMID exactly as given.`;

export const TakeawaysSchema = z.object({
  takeaways: z.array(z.object({ pmid: z.string(), text: z.string().min(1), quote: z.string() })),
});
export type RawTakeaways = z.infer<typeof TakeawaysSchema>;

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

export function createOllamaTakeawayProvider(options: OllamaOptions): TakeawayProvider {
  const ollama = createOllamaJson(options);
  return {
    name: 'ollama',
    model: ollama.model,
    async generate(papers) {
      const { data, inputTokens, outputTokens } = await ollama.generateJson({
        system: TAKEAWAY_SYSTEM_PROMPT,
        user: buildAbstractsMessage(papers),
        schema: TakeawaysSchema,
        inputName: 'abstracts',
      });
      return { raw: data, inputTokens, outputTokens };
    },
    async checkSupport(items) {
      const { data } = await ollama.generateJson({
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
    },
  };
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

  for (const { pmid, text, quote } of raw.takeaways) {
    const id = pmid.replace(/\D/g, '');
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
    });
  }

  const values = [...byPmid.values()];
  const uncitedCount = values.filter((t) => t.uncited).length;
  return { byPmid, verifiedCount: values.length - uncitedCount, uncitedCount, removedAdvice };
}
