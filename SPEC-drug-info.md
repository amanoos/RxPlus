# Spec: drug-info

Module of [CAPABILITY-MAP.md](CAPABILITY-MAP.md). Depends on: `medications` (and reuses the `interactions` openFDA client). Status: **draft, awaiting review**.
Research basis: [docs/research/free-data-sources.md](docs/research/free-data-sources.md).

## Objective

For each drug the owner takes, or is considering, answer in plain language: **what is it for, how does it work, what are the side effects and warnings, and how well does it work**. Every statement is traceable to its source.

This module introduces the **Claude API** for the first time. Claude writes a plain-language summary of the official FDA label, and every sentence carries a citation to the exact label text it came from. Structured facts (drug class, what it's approved to treat) come straight from RxClass without AI.

**User story:** "I tap _lisinopril 10 MG Oral Tablet_ and see:

- that it treats high blood pressure and heart failure
- that it's an ACE inhibitor
- the common and serious side effects in plain English
- a short note on what the clinical studies showed

Each sentence has a small source marker that shows the exact FDA label wording and links to DailyMed."

## Data sources

| Content                     | Source                                                                                                                                                                                                                          | AI?                             |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------- |
| Drug class                  | RxClass: FDA EPC (`has_epc`), ATC                                                                                                                                                                                               | No                              |
| Approved/known uses         | RxClass MED-RT `may_treat` (plus `may_prevent`)                                                                                                                                                                                 | No                              |
| Conditions to avoid it with | RxClass MED-RT `ci_with`                                                                                                                                                                                                        | No                              |
| Plain-language summary      | openFDA drug label sections: `indications_and_usage`, `boxed_warning`, `contraindications`, `warnings_and_cautions` (or `warnings`), `adverse_reactions`, `clinical_studies`, `mechanism_of_action`, `information_for_patients` | **Yes**: Claude, with citations |
| Consumer page               | MedlinePlus Connect (link only; content is licensed)                                                                                                                                                                            | No                              |
| Full label                  | DailyMed link (by `set_id`)                                                                                                                                                                                                     | No                              |

The label is the newest one for the product that has `indications_and_usage`, found with an openFDA query (`openfda.rxcui:<rxcui> AND _exists_:indications_and_usage`, sorted by `effective_time:desc`). Size measured on 2026-09-27: lisinopril ≈ 7.2k tokens of relevant sections, atorvastatin ≈ 9.8k, spironolactone ≈ 3.7k.

## AI summary (Claude API)

- **SDK:** `@anthropic-ai/sdk`, server-side only. The key is `ANTHROPIC_API_KEY` (optional env). Without it, the page shows the structured facts and links, plus "AI summary unavailable: no API key configured".
- **Model:** `claude-opus-5` (default; see open question 1), adaptive thinking, `output_config.effort: "high"`, `max_tokens: 16000`, not streamed (the result is stored, not shown live).
- **Citations:** each label section is sent as its own plain-text `document` block (`title` = the section name) with `citations: { enabled: true }`. The response's text blocks carry `citations[]` with `cited_text` and a character location. Citations can't be combined with structured-output (JSON) mode, so the output layout is fixed by the prompt: exactly these `## ` headings in this order:
  1. What it's for
  2. How it works
  3. Common side effects
  4. Serious warnings
  5. How well it works

  The server splits the text into sections at those headings and keeps each sentence's citations.

- **Prompt rules** (system prompt, stable and cached):
  - plain language at about an 8th-grade reading level
  - use only the provided documents
  - no advice to start, stop or change a medication
  - no dosing instructions
  - say "The label doesn't say" when a section has no support
  - "How well it works" reports only what the clinical-studies section states, including numbers when given
- **Refusals:** enable the server-side refusal fallback (`betas: ["server-side-fallback-2026-07-01"]`, `fallbacks: "default"`). Always check `stop_reason`. A final `refusal` or `max_tokens` is stored as a failed generation, with a retry option.
- **Grounding check (server):** any sentence without a citation is marked _uncited_ and shown with a visible "not linked to the label" note, never silently. If more than 20% of sentences are uncited, the summary is rejected and regenerated once, then stored with a warning.
- **Cost control:**
  - one summary per **(product RXCUI, label set_id, label version)**, stored in Postgres and reused until the FDA label changes
  - estimated $0.10–0.20 per summary on Claude Opus 5
  - the stored `usage` is shown on a small "Cost so far" line in Settings (later) and logged
  - at most 20 generations per day (configurable, `AI_DAILY_LIMIT`), to cap spend

## Data model (Drizzle, `src/server/db/schema/drug-info.ts`)

```ts
drugSummaries = pgTable(
  'drug_summaries',
  {
    id: uuid().primaryKey().defaultRandom(),
    rxcui: text().notNull(), // SCD/SBD product
    labelSetId: text().notNull(),
    labelVersion: text().notNull(), // openFDA "version"
    labelEffectiveDate: date(),
    status: text({ enum: ['pending', 'ready', 'failed'] }).notNull(),
    sections: jsonb().$type<SummarySection[]>(), // [{ heading, sentences: [{ text, citations: [{ section, citedText }] }] }]
    uncitedCount: integer(),
    model: text(),
    inputTokens: integer(),
    outputTokens: integer(),
    error: text(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex().on(t.rxcui, t.labelSetId, t.labelVersion)],
);
```

## API (session required)

| Method and path                  | Purpose                                                                                                                      | Response                                                      |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| `GET /api/drugs/:rxcui`          | Structured facts: name, class, uses, "avoid with" conditions, label reference (set_id, date, DailyMed URL), MedlinePlus link | 200; 422 non-product; 503 if RxNav/openFDA down               |
| `GET /api/drugs/:rxcui/summary`  | Stored summary for the product's **current** label                                                                           | 200 `ready`/`pending`/`failed`; 404 `none` if never generated |
| `POST /api/drugs/:rxcui/summary` | Start generation (idempotent: if `pending` or `ready` for the current label, returns it)                                     | 202 `pending`; 429 over the daily limit; 503 no API key       |

Generation runs **in the server process after the 202** (a background promise, like the digest job later), so page loads never wait on the model. The client polls `GET …/summary` every 2 s while `pending` (for at most 3 minutes).

## UI

- **`/drugs/:rxcui` page (SSR for the facts):**
  - header: name, strength, form, class tags
  - "Used for" chips (MED-RT)
  - "Avoid if you have" list
  - the AI summary panel, with its five sections
  - links: "FDA label on DailyMed", "MedlinePlus: plain-language guide"
- **Summary panel:**
  - shows "Summarizing the FDA label…" while pending
  - each cited sentence gets a small superscript marker; hovering, or tapping on mobile, shows the quoted label text and its section
  - uncited sentences get a dotted underline and a note
  - footer: "Summary written by AI (Claude) from the FDA label dated <date>. Check anything important with your pharmacist."
- **Links in:** each medication card ("About this drug") and each side of an interaction result.
- **Checking the label:** "Check for a newer label" re-fetches the label (7-day cache bypassed) and regenerates only if the label version changed.

## State (NgRx)

`drugInfo` feature, keyed by RXCUI:

- `facts` (loaded/error)
- `summary` (none/pending/ready/failed)
- effects: load facts, load summary, start generation, and polling (`timer` + `takeWhile` pending; cancelled on route leave)

## Testing

- **Unit:**
  - openFDA `summaryLabel(rxcui)` (newest label with indications, section extraction)
  - RxClass uses/avoid-with mapping
  - the summarizer's request building (documents with citations enabled, stable system prompt), with the Anthropic client mocked
  - response parsing: headings → sections, citations → sentences, uncited detection, the 20% rule, refusal / `max_tokens` handling
  - NgRx feature and components
- **Integration (test DB):** summary repository (unique per label version); generation state machine with a mocked Claude client; daily limit; route handlers.
- **E2E (stub upstream + stub Claude):** the stand-in server gains a minimal `/v1/messages` endpoint returning a recorded, cited response (`ANTHROPIC_BASE_URL` points at it). The spec opens a drug page, sees the facts, generates a summary, and shows a citation popover.
- **One manual live check** against the real API (costs about $0.20) at the checkpoint, with your approval.
- **Coverage:** ≥ 80% lines on `src/server/drug-info`, `src/app/features/drug-info`.

## Boundaries

- **Always:**
  - cite every AI sentence or mark it uncited
  - store and reuse summaries per label version
  - check `stop_reason`
  - show "written by AI" plus the label date
  - keep the API key server-side
- **Ask first:**
  - changing the model or effort
  - raising `AI_DAILY_LIMIT`
  - sending anything other than FDA label text to the model
  - adding FAERS report counts (see open question 2)
- **Never:**
  - AI-generated dosing or "should I stop" advice
  - AI changing interaction severity
  - sending personal notes or the medication list to the model (only public label text)
  - calling Claude from the browser
  - logging the API key

## Success criteria

1. `/drugs/314076` renders on the server with name, class ("Angiotensin Converting Enzyme Inhibitor"), "Used for" (e.g. Hypertension, Heart Failure) and DailyMed/MedlinePlus links, without waiting on AI.
2. The first visit starts one generation; the summary appears within about 60 s, with all five sections. Every sentence has a citation or a visible "uncited" note; citations show verbatim label text.
3. A second visit, or a visit after a restart, serves the stored summary instantly with no API call (verified from logs/usage).
4. A new label version triggers a fresh summary only via "Check for a newer label" or when the label is re-fetched after the 7-day cache.
5. No API key → facts and links still work, with a clear message. Daily limit reached → 429 with a clear message. Refusal or failure → "Summary unavailable. Retry" and nothing half-written is stored.
6. The model receives only label text (verified in the request-building test): no notes, no medication list.
7. Lint, unit, integration and e2e tests pass; coverage targets are met.

## Open questions (need your answer)

1. **Model:** keep **Claude Opus 5** (best quality; about $0.10–0.20 per drug per label version, reused until the label changes), or use a cheaper model such as **Claude Sonnet 5** ($2/$10 per million tokens, about 40% of the cost)? _Recommendation: Opus 5. With about 10 medications and summaries reused until the label changes, the total is a few dollars._
2. **FAERS "most reported side effects"** (FDA adverse-event report counts)? They're reports, not rates, and easily misread. _Recommendation: not in this module. Use the label's adverse-reactions section, which has trial frequencies._
3. **Daily generation cap** of 20 summaries a day: OK? _Recommendation: yes (at most about $4/day worst case)._
4. **Anthropic API key:** you'll need one in `.env` (`ANTHROPIC_API_KEY`) for real summaries. Development and tests use a stub, so it's only needed for the checkpoint live check and on your server.
