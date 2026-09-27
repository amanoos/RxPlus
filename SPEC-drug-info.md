# Spec: drug-info

Module of [CAPABILITY-MAP.md](CAPABILITY-MAP.md). Depends on: `medications` (and reuses the `interactions` openFDA client). Status: **draft, awaiting review**.
Research basis: [docs/research/free-data-sources.md](docs/research/free-data-sources.md).

## Objective

For each drug the owner takes, or is considering, answer in plain language: **what is it for, how does it work, what are the side effects and warnings, and how well does it work**. Every statement is traceable to its source.

This module introduces AI summaries:

- **Summary:** an AI model writes a plain-language summary of the official FDA label. By default it's a **local model on the home server via Ollama** (no cost, no data leaves the LAN); **Claude Opus 5** is optional when an API key is configured. Every sentence is tied to a verbatim quote from the label, checked by the server.
- **Structured facts:** drug class, what it's used for, and conditions to avoid it with come straight from RxClass, without AI.
- **Reported side effects:** FDA adverse-event report counts (FAERS), shown with a clear disclaimer.

**User story:** "I tap _lisinopril 10 MG Oral Tablet_ and see:

- that it treats high blood pressure and heart failure
- that it's an ACE inhibitor
- the common and serious side effects in plain English
- a short note on what the clinical studies showed
- what side effects people most often report to the FDA

Each summary sentence has a small source marker that shows the exact FDA label wording and links to DailyMed."

## Data sources

| Content                     | Source                                                                                                                                                                                                                          | AI?                                                       |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| Drug class                  | RxClass: FDA EPC (`has_epc`), ATC                                                                                                                                                                                               | No                                                        |
| Approved/known uses         | RxClass MED-RT `may_treat` (plus `may_prevent`)                                                                                                                                                                                 | No                                                        |
| Conditions to avoid it with | RxClass MED-RT `ci_with`                                                                                                                                                                                                        | No                                                        |
| Plain-language summary      | openFDA drug label sections: `indications_and_usage`, `boxed_warning`, `contraindications`, `warnings_and_cautions` (or `warnings`), `adverse_reactions`, `clinical_studies`, `mechanism_of_action`, `information_for_patients` | **Yes**: Ollama (default) or Claude, with verified quotes |
| Reported side effects       | openFDA FAERS `drug/event.json`, counted by `patient.reaction.reactionmeddrapt.exact` for the ingredient; top 10 plus total reports                                                                                             | No                                                        |
| Consumer page               | MedlinePlus Connect (link only; content is licensed)                                                                                                                                                                            | No                                                        |
| Full label                  | DailyMed link (by `set_id`)                                                                                                                                                                                                     | No                                                        |

The label is the newest one for the product that has `indications_and_usage`, found with an openFDA query (`openfda.rxcui:<rxcui> AND _exists_:indications_and_usage`, sorted by `effective_time:desc`). Size measured on 2026-09-27: lisinopril ≈ 7.2k tokens of relevant sections, atorvastatin ≈ 9.8k, spironolactone ≈ 3.7k.

## AI summary

### Output (the same for both providers)

Five sections, in order:

1. What it's for
2. How it works
3. Common side effects
4. Serious warnings
5. How well it works

Each section is a list of **sentences**, and each sentence carries one or more **quotes**, each `{ labelSection, text }`. The server **verifies every quote**: after normalizing whitespace, case and quote marks, the quote must appear in the named label section. Verified quotes become citations. A sentence with no verified quote is marked _uncited_ and shown with a visible "not linked to the label" note, never silently. If more than 20% of sentences are uncited, the summary is regenerated once, then stored with a warning.

### Prompt rules (shared, stable system prompt)

- plain language at about an 8th-grade reading level
- use only the provided label sections
- no advice to start, stop or change a medication
- no dosing instructions
- "The label doesn't say" when a section has no support
- "How well it works" reports only what the clinical-studies section states, including numbers when given
- every sentence must quote the exact label words it's based on

### Provider: Ollama (default)

- **Configuration:**
  - `OLLAMA_BASE_URL`: default `http://host.docker.internal:11434` in Docker (Compose adds `extra_hosts: host.docker.internal:host-gateway`), `http://localhost:11434` in dev
  - `OLLAMA_MODEL`: required, e.g. the model you run on the home server's NVIDIA GPU
- **Request:** Ollama's HTTP API `POST /api/chat` with `stream: false` and `format` = the JSON schema of the output above (structured outputs), so the reply is validated JSON. Each label section is sent in the user message under a `### <section>` header.
- **Context window:** `options.num_ctx` is set explicitly (default 16384, `OLLAMA_NUM_CTX`). Ollama's small default window would otherwise silently cut off the label. Before sending, the server estimates the prompt size and refuses with a clear error rather than truncating.
- **Settings:** `options.temperature: 0.2`, for faithful rather than creative wording.
- **Timeout:** 5 minutes (`OLLAMA_TIMEOUT_MS`). The response is validated with zod; invalid JSON counts as a failed attempt.
- **Cost:** none; no daily cap.

### Provider: Claude (optional)

- **Enabled when:** `SUMMARY_PROVIDER=claude` and `ANTHROPIC_API_KEY` are both set. The SDK is `@anthropic-ai/sdk`, server-side only.
- **Model:** `claude-opus-5`, adaptive thinking, `output_config.effort: "high"`, `max_tokens: 16000`, not streamed.
- **Citations:** each label section is a plain-text `document` block with `citations: { enabled: true }`. The response's `cited_text` values become the sentence quotes and go through the same server verification. Citations can't be combined with structured-output (JSON) mode, so the section headings are fixed by the prompt (`## What it's for`, …).
- **Refusals:** the server-side refusal fallback is enabled (`betas: ["server-side-fallback-2026-07-01"]`, `fallbacks: "default"`). `stop_reason` is always checked; a final `refusal` or `max_tokens` counts as a failure.
- **Cost:** about $0.10–0.20 per summary. The daily cap applies only to Claude (`AI_DAILY_LIMIT`, default 20). Token usage is stored.

### Provider selection

- `SUMMARY_PROVIDER` is `ollama` (default) or `claude`.
- If the selected provider isn't configured or reachable, the page shows the facts, links and FAERS, plus "AI summary unavailable: <reason>".
- No automatic cross-provider fallback. That keeps the provider predictable and avoids surprise spend.

### Storage and reuse

- One summary per **(product RXCUI, label set_id, label version)**, stored in Postgres and reused until the FDA label changes.
- The provider and model name are stored with it and shown in the footer.

## Reported side effects (FAERS)

- `GET https://api.fda.gov/drug/event.json?search=patient.drug.openfda.generic_name.exact:"<INGREDIENT>"&count=patient.reaction.reactionmeddrapt.exact&limit=10`
- The total report count comes from the same search with `limit=1`.
- Combination products are counted per ingredient.
- Cached 7 days, using the existing openFDA client; the key is optional.
- **Disclaimer, always shown:** "Reports submitted to the FDA by patients and professionals. A report doesn't prove the drug caused the reaction, and counts aren't how often it happens. See the label's side effects for frequencies from clinical trials."

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
    provider: text({ enum: ['ollama', 'claude'] }).notNull(),
    model: text().notNull(),
    sections: jsonb().$type<SummarySection[]>(), // [{ heading, sentences: [{ text, citations: [{ labelSection, text }], uncited }] }]
    uncitedCount: integer(),
    inputTokens: integer(),
    outputTokens: integer(),
    error: text(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex().on(t.rxcui, t.labelSetId, t.labelVersion)],
);
```

## API (session required)

| Method and path                            | Purpose                                                                                                                      | Response                                                                 |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `GET /api/drugs/:rxcui`                    | Structured facts: name, class, uses, "avoid with" conditions, label reference (set_id, date, DailyMed URL), MedlinePlus link | 200; 422 non-product; 503 if RxNav/openFDA down                          |
| `GET /api/drugs/:rxcui/reported-reactions` | FAERS top reactions per ingredient and total reports                                                                         | 200; 503 if openFDA down                                                 |
| `GET /api/drugs/:rxcui/summary`            | Stored summary for the product's **current** label                                                                           | 200 `ready`/`pending`/`failed`; 404 `none`                               |
| `POST /api/drugs/:rxcui/summary`           | Start generation; idempotent for the current label                                                                           | 202 `pending`; 429 over the Claude daily limit; 503 provider unavailable |

Generation runs **in the server process after the 202**, so page loads never wait on the model. The client polls `GET …/summary` every 2 s while `pending` (at most 6 minutes, to allow for the local model).

## UI

- **`/drugs/:rxcui` page (SSR for the facts):**
  - header: name, strength, form, class tags
  - "Used for" chips
  - "Avoid if you have" list
  - the AI summary panel
  - the "Reported to the FDA" panel
  - links: "FDA label on DailyMed" and "MedlinePlus"
- **Summary panel:**
  - "Summarizing the FDA label…" with elapsed time while pending
  - each sentence gets superscript source markers; hovering or tapping shows the quoted label text and section
  - uncited sentences get a dotted underline and a note
  - footer: "Summary written by AI (<model>, <local | Claude>) from the FDA label dated <date>. Check anything important with your pharmacist."
- **Reported-to-the-FDA panel:**
  - top reactions as a simple horizontal bar list, with counts and the total number of reports
  - the disclaimer above, always visible (not in a tooltip)
- **Links in:** each medication card ("About this drug") and each side of an interaction result.
- **Refreshing:** "Check for a newer label" regenerates only if the label version changed.

## State (NgRx)

`drugInfo` feature, keyed by RXCUI:

- `facts`, `reactions`, `summary` (none/pending/ready/failed)
- effects: load each; start generation; poll while pending (`timer` + `takeWhile`; cancelled on route leave)

## Testing

- **Unit:**
  - openFDA `summaryLabel(rxcui)` (newest label with indications, section extraction) and `reportedReactions(ingredient)`
  - RxClass uses/avoid-with mapping
  - prompt building (only label text, shared rules); Ollama request (`format` schema, `num_ctx`, timeout); Claude request (documents with citations, fallbacks); both with mocked clients
  - quote verification (normalization, wrong section, invented quote → uncited), the 20% rule, invalid JSON, refusal / `max_tokens`
  - NgRx feature and components (citation popover, uncited styling, disclaimer)
- **Integration (test DB):** summary repository (unique per label version); generation state machine with a stub provider; Claude daily limit; route handlers.
- **E2E:** the stand-in server gains a minimal Ollama `/api/chat` endpoint returning a recorded JSON summary, and a FAERS fixture. The spec opens a drug page, sees the facts, FAERS panel and disclaimer, generates a summary, and shows a citation popover.
- **Live checks at the checkpoint:** one summary with your Ollama model on the home server (free). Claude only if you add a key and approve (about $0.20).
- **Coverage:** ≥ 80% lines on `src/server/drug-info`, `src/app/features/drug-info`.

## Boundaries

- **Always:**
  - verify every quote against the label, or mark the sentence uncited
  - store and reuse summaries per label version
  - show "written by AI" with the model and label date
  - show the FAERS disclaimer
  - set `num_ctx` explicitly
- **Ask first:**
  - changing the default provider, model or effort
  - raising `AI_DAILY_LIMIT`
  - sending anything other than FDA label text to a model
- **Never:**
  - AI-generated dosing or "should I stop" advice
  - AI changing interaction severity
  - sending personal notes or the medication list to a model
  - calling a model from the browser
  - logging API keys
  - presenting FAERS counts as frequencies

## Success criteria

1. `/drugs/314076` renders on the server with name, class ("Angiotensin Converting Enzyme Inhibitor"), "Used for" (e.g. Hypertension, Heart Failure), DailyMed/MedlinePlus links and the FAERS panel with its disclaimer, without waiting on AI.
2. With Ollama configured, the first visit starts one generation. The summary appears with all five sections, and at least 80% of sentences carry verified quotes, which show verbatim label text.
3. A second visit, or a visit after a restart, serves the stored summary instantly with no model call.
4. A new label version triggers a fresh summary only via "Check for a newer label" or when the label is re-fetched after the 7-day cache.
5. Provider unreachable or not configured: facts, FAERS and links still work, with a clear message. Claude over the daily limit: 429 with a message. Invalid output or refusal: "Summary unavailable. Retry", and nothing half-written is stored.
6. The model receives only label text (request-building tests): no notes, no medication list.
7. `num_ctx` covers the largest measured label (≈10k tokens), and a label too large for the window fails clearly instead of being truncated.
8. Lint, unit, integration and e2e tests pass; coverage targets are met.

## Resolved decisions (2026-09-27)

1. **Providers:** Ollama by default (home server, NVIDIA GPU, model already installed); Claude Opus 5 optional when `ANTHROPIC_API_KEY` is set and `SUMMARY_PROVIDER=claude`.
2. **FAERS:** included, with the disclaimer above.
3. **Daily cap:** only for Claude (default 20/day); none for the local model.
4. **Anthropic key:** not yet. Build and test with stubs; Claude stays off until a key is added.

## Open questions

1. **Ollama model tag:** which model should summaries use (the output of `ollama list` on the home server)? This sets the `OLLAMA_MODEL` default in `.env.example`, and informs `num_ctx` and the timeout.
2. **Where does Ollama run relative to Docker?** On the Ubuntu host itself (the app reaches it at `host.docker.internal:11434`, with Ollama listening on `0.0.0.0` or the docker bridge), or in its own container? _Recommendation: keep your existing host install and use `host.docker.internal`._
