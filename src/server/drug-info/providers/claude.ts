/**
 * Label summaries from Claude with citations (see ai/claude.ts): each label
 * section is a document, and the cited text becomes the sentence quotes. The
 * headings are fixed by the prompt and parsed here.
 */
import { createClaudeCited, type CitedBlock, type ClaudeClient } from '../../ai/claude';
import type { SummaryLabel } from '../../openfda/client';
import { HEADINGS, RawSummarySchema, SYSTEM_PROMPT, type RawSummary } from '../summary';
import { ProviderOutputError, type SummaryProvider } from './provider';

export { CLAUDE_MODEL, type ClaudeClient } from '../../ai/claude';

const CLAUDE_FORMAT = `Format:
- Start each section with a Markdown heading line, exactly: ${HEADINGS.map((h) => `"## ${h}"`).join(', ')}.
- Under each heading, write short sentences, one per line. Cite the label for every sentence.`;

const NO_SUPPORT_SENTENCE = 'The label doesn’t say.';

export function createClaudeProvider({
  apiKey,
  client,
}: {
  apiKey: string;
  client?: ClaudeClient;
}): SummaryProvider {
  const claude = createClaudeCited({ apiKey, client });
  return {
    name: 'claude',
    model: claude.model,
    async generate(label: SummaryLabel) {
      const { blocks, inputTokens, outputTokens } = await claude.generateCited({
        system: `${SYSTEM_PROMPT}\n\n${CLAUDE_FORMAT}`,
        documents: label.sections.map((section) => ({ title: section.name, text: section.text })),
        instruction: 'Summarize this FDA drug label.',
        task: 'summarize this label',
        output: 'summary',
      });
      const parsed = RawSummarySchema.safeParse(parseCitedText(blocks, label));
      if (!parsed.success) {
        throw new ProviderOutputError('Claude’s summary did not follow the section headings.');
      }
      return { raw: parsed.data, inputTokens, outputTokens };
    },
  };
}

type Quote = RawSummary['sections'][number]['sentences'][number]['quotes'][number];

const HEADING_LINE = /^#{1,3}\s*(.+?)\s*$/;
const plain = (s: string) => s.toLowerCase().replace(/[‘’]/g, "'").trim();

/**
 * Rebuilds the five sections from the response's text blocks. A cited block's
 * quotes attach to every sentence it contributes text to.
 */
export function parseCitedText(blocks: CitedBlock[], label: SummaryLabel): RawSummary {
  const sections = new Map<string, RawSummary['sections'][number]['sentences']>();
  let current: RawSummary['sections'][number]['sentences'] | undefined;
  let sentence: { text: string; quotes: Quote[] } | undefined;

  const finish = () => {
    const text = sentence?.text
      .replace(/\s+/g, ' ')
      .replace(/^[-*•]\s*/, '')
      .trim();
    if (current && sentence && text) current.push({ text, quotes: dedupe(sentence.quotes) });
    sentence = undefined;
  };

  for (const block of blocks) {
    const quotes: Quote[] = block.citations.flatMap((c) => {
      const section = label.sections[c.documentIndex];
      return section ? [{ labelSection: section.name, text: c.citedText }] : [];
    });

    // Split into lines, then sentences; a heading line opens a new section.
    const lines = block.text.split('\n');
    lines.forEach((line, i) => {
      const heading = HEADING_LINE.exec(line.trim());
      const known = heading && HEADINGS.find((h) => plain(h) === plain(heading[1]));
      if (known) {
        finish();
        current = [];
        sections.set(known, current);
      } else {
        for (const part of line.split(/(?<=[.!?])\s+/)) {
          if (!part.trim()) continue;
          sentence ??= { text: '', quotes: [] };
          sentence.text += part;
          sentence.quotes.push(...quotes);
          if (/[.!?]\s*$/.test(part)) finish();
          else sentence.text += ' ';
        }
      }
      if (i < lines.length - 1) finish(); // a line break ends a sentence
    });
  }
  finish();

  return {
    sections: HEADINGS.flatMap((heading) => {
      const sentences = sections.get(heading);
      if (!sentences) return [];
      return [
        {
          heading,
          sentences: sentences.length ? sentences : [{ text: NO_SUPPORT_SENTENCE, quotes: [] }],
        },
      ];
    }),
  };
}

function dedupe(quotes: Quote[]): Quote[] {
  const seen = new Set<string>();
  return quotes.filter((q) => {
    const key = `${q.labelSection}|${q.text}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
