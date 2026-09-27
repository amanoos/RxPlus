// @vitest-environment node
import type { SummaryLabel } from '../openfda/client';
import {
  buildLabelMessage,
  estimateTokens,
  HEADINGS,
  MAX_UNCITED_RATIO,
  RawSummarySchema,
  rawSummaryJsonSchema,
  SummaryFormatError,
  SYSTEM_PROMPT,
  verifySummary,
  type RawSummary,
} from './summary';

const label: SummaryLabel = {
  rxcui: '314076',
  setId: 'set',
  version: '2',
  manufacturer: 'Maker',
  effectiveDate: '2026-09-10',
  dailyMedUrl: 'https://dailymed.nlm.nih.gov/dailymed/lookup.cfm?setid=set',
  sections: [
    {
      name: 'indications_and_usage',
      text: 'Lisinopril tablets are an angiotensin converting enzyme (ACE) inhibitor indicated for the treatment of hypertension in adult patients.',
    },
    {
      name: 'adverse_reactions',
      text: 'The most common adverse reactions (incidence >5%) are headache, dizziness and cough.',
    },
  ],
};

const summary = (
  overrides: Partial<
    Record<(typeof HEADINGS)[number], RawSummary['sections'][number]['sentences']>
  > = {},
): RawSummary => ({
  sections: HEADINGS.map((heading) => ({
    heading,
    sentences: overrides[heading] ?? [{ text: 'The label doesn’t say.', quotes: [] }],
  })),
});

describe('prompt', () => {
  it('sends only label text, with each section named', () => {
    const message = buildLabelMessage(label);
    expect(message).toContain('### indications_and_usage');
    expect(message).toContain('treatment of hypertension');
    expect(message).toContain('### adverse_reactions');
    expect(SYSTEM_PROMPT).toMatch(/only the label sections/i);
    expect(SYSTEM_PROMPT).toMatch(/exact words/i);
    expect(SYSTEM_PROMPT).toMatch(/do not give dosing/i);
  });

  it('estimates tokens conservatively', () => {
    expect(estimateTokens('x'.repeat(3500))).toBe(1000);
  });

  it('exposes a JSON schema for structured output', () => {
    const schema = rawSummaryJsonSchema() as { properties?: Record<string, unknown> };
    expect(schema.properties).toHaveProperty('sections');
  });
});

describe('verifySummary', () => {
  it('turns exact label quotes into citations', () => {
    const verified = verifySummary(
      summary({
        "What it's for": [
          {
            text: 'It treats high blood pressure in adults.',
            quotes: [
              {
                labelSection: 'indications_and_usage',
                text: 'indicated for the treatment of hypertension in adult patients',
              },
            ],
          },
        ],
      }),
      label,
    );
    const sentence = verified.sections[0].sentences[0];
    expect(sentence.uncited).toBe(false);
    expect(sentence.citations).toEqual([
      {
        labelSection: 'indications_and_usage',
        text: 'indicated for the treatment of hypertension in adult patients',
      },
    ]);
    expect(verified.uncitedCount).toBe(0);
  });

  it('tolerates case, whitespace, curly quotes and dashes', () => {
    const verified = verifySummary(
      summary({
        'Common side effects': [
          {
            text: 'Headache, dizziness and cough are common.',
            quotes: [
              {
                labelSection: 'adverse_reactions',
                text: 'The most  common adverse reactions (INCIDENCE >5%) are headache, dizziness and cough',
              },
            ],
          },
        ],
      }),
      label,
    );
    expect(verified.sections[2].sentences[0].uncited).toBe(false);
  });

  it('corrects a quote attributed to the wrong section', () => {
    const verified = verifySummary(
      summary({
        'Common side effects': [
          {
            text: 'It can cause a cough.',
            quotes: [
              { labelSection: 'indications_and_usage', text: 'headache, dizziness and cough' },
            ],
          },
        ],
      }),
      label,
    );
    expect(verified.sections[2].sentences[0].citations[0].labelSection).toBe('adverse_reactions');
  });

  it('marks invented or trivial quotes as uncited', () => {
    const verified = verifySummary(
      summary({
        'How it works': [
          {
            text: 'It relaxes blood vessels.',
            quotes: [{ labelSection: 'indications_and_usage', text: 'relaxes blood vessels' }],
          },
          {
            text: 'It is an ACE inhibitor.',
            quotes: [{ labelSection: 'indications_and_usage', text: 'ACE' }],
          },
        ],
      }),
      label,
    );
    expect(verified.sections[1].sentences.map((s) => s.uncited)).toEqual([true, true]);
    expect(verified.uncitedCount).toBe(2);
  });

  it("doesn't count honest 'the label doesn't say' sentences as uncited", () => {
    const verified = verifySummary(summary(), label);
    expect(verified.uncitedCount).toBe(0);
    expect(verified.sections[4].sentences[0]).toMatchObject({ uncited: false, noSupport: true });
  });

  it('computes the uncited ratio against the threshold', () => {
    const cited = {
      text: 'It treats high blood pressure.',
      quotes: [
        {
          labelSection: 'indications_and_usage' as const,
          text: 'treatment of hypertension in adult patients',
        },
      ],
    };
    const uncited = { text: 'It is very safe.', quotes: [] };
    const verified = verifySummary(
      summary({ "What it's for": [cited, cited, cited, cited, uncited] }),
      label,
    );
    expect(verified.uncitedRatio).toBeCloseTo(0.2);
    expect(verified.uncitedRatio <= MAX_UNCITED_RATIO).toBe(true);
  });

  it('rejects missing or reordered headings', () => {
    const bad = summary();
    bad.sections.reverse();
    expect(() => verifySummary(bad, label)).toThrowError(SummaryFormatError);
    expect(() => RawSummarySchema.parse({ sections: [] })).toThrow();
  });
});
