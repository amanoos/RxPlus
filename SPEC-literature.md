# Spec: literature

Module of [CAPABILITY-MAP.md](CAPABILITY-MAP.md). Depends on: `medications`, and reuses `drug-info` (drug page, AI providers, quote verification). Status: **approved 2026-09-27**.
Research basis: [docs/research/free-data-sources.md](docs/research/free-data-sources.md) (§5 PubMed, §6 ClinicalTrials.gov), plus the queries measured below.

## Objective

For each drug, show the **research behind it**: up to 10 key papers with the strongest evidence, and a short list of clinical trials. Each paper gets a one-line plain-language takeaway written by AI from its abstract, backed by a verified quote.

**User story:** "On the _lisinopril 10 MG Oral Tablet_ page I open **Research** and see:

- a few systematic reviews and meta-analyses, then randomized trials, each with its title, journal, year and study type
- one plain line per paper saying what it found, with the abstract sentence it's based on
- links to PubMed (and the free full text when there is one)
- up to 5 trials: completed ones with posted results, and ones recruiting now
- a Hide button on a paper I don't find useful; the next best paper takes its place"

Out of scope here: **new** papers and trials week to week (the `digest` module), alternatives, pricing, and full-text reading.

## Data sources (verified 2026-09-27)

| Content            | Source                                                                                                          | Key               |
| ------------------ | --------------------------------------------------------------------------------------------------------------- | ----------------- |
| Paper search       | PubMed E-utilities `esearch.fcgi` (`db=pubmed`, `retmode=json`, `sort=relevance`)                               | Optional NCBI key |
| Paper details      | `esummary.fcgi` (JSON): title, `source` (journal), `pubdate`, `pubtype[]`, `articleids` (DOI, PMC)              | Optional          |
| Abstracts (for AI) | `efetch.fcgi` (`retmode=xml`): `<AbstractText Label=…>` sections                                                | Optional          |
| Trials             | ClinicalTrials.gov API v2 `GET /api/v2/studies`, `query.intr=<ingredient>`, `fields=` subset, `countTotal=true` | None              |

### Paper selection, per ingredient

Two tiers, both requiring an abstract (`hasabstract`):

1. **Reviews:** `<ingredient>[tiab] AND (meta-analysis[pt] OR systematic review[pt])`, relevance order, **at most 4**.
2. **Randomized trials:** `<ingredient>[majr] AND randomized controlled trial[pt]`, relevance order, filling the list **up to 10**.

Measured: with the drug as a MeSH major topic, lisinopril has only **1** review, but **30** when the drug is in the title or abstract. Reviews usually cover the whole class (e.g. "ACE inhibitor-induced cough compared with placebo"). Randomized trials: lisinopril 295, atorvastatin 311, spironolactone 566. Relevance order puts class-level and off-topic reviews high sometimes (e.g. postpartum hypertension); **Hide** handles those.

A candidate pool of up to **20** per tier is fetched and stored, so hiding a paper promotes the next one without a new search. A paper found by both tiers is listed once, as a review.

### Trials, per ingredient

`query.intr=<ingredient>` with `sort=LastUpdatePostDate:desc`, keeping at most **5**:

- up to 3 **completed with posted results** (`filter.overallStatus=COMPLETED`, `aggFilters=results:with`; 37 for lisinopril)
- then **recruiting** (`filter.overallStatus=RECRUITING`) up to 5 total

Fields: NCT ID, brief title, status, phase(s), has results, start date, last update. Link: `https://clinicaltrials.gov/study/<NCT>`. No AI on trials.

### Limits and caching

- NCBI: 3 requests/s without a key, 10/s with `NCBI_API_KEY`. Calls are spaced (≥ 350 ms, or 110 ms with a key), with a `tool=rxplus` parameter and an optional `NCBI_EMAIL` (NCBI asks for both).
- Upstream calls use the shared `getJson` helper (timeout, one retry on network errors and 5xx, 429 treated as unavailable).
- A list is refreshed when it's **older than 30 days** and the drug page is opened, or with **"Check for new research"**. Refreshing keeps existing takeaways and hidden papers.

## AI takeaways

- **One call per ingredient list**, not per paper: the model receives the abstracts of the listed papers without a takeaway (≈ 3–5k tokens for 10) and returns, for each PMID, one plain-language sentence plus the exact abstract words it's based on. One call is much faster on the local model than ten.
- **Output schema:** `{ takeaways: [{ pmid, text, quote }] }` (zod → Ollama `format`; Claude: each abstract as a plain-text document with citations, one `## PMID <id>` line per takeaway).
- **Verification**, reusing drug-info's checks: the quote must appear in that paper's abstract (normalized) and be relevant to the sentence (shared word stems plus synonyms); otherwise the takeaway is shown as "not linked to the abstract". Advice to start, stop or change a medication is removed. Takeaways for PMIDs not in the request are dropped.
- **Prompt rules:** plain language; say what the study found, including the population and main result, with numbers if the abstract gives them; no advice; describe a study as a study ("In a trial of 200 adults…"), never as a fact about the reader.
- **Provider** comes from drug-info's `SUMMARY_PROVIDER` / `OLLAMA_*` / `ANTHROPIC_API_KEY`; Claude calls count toward the same `AI_DAILY_LIMIT`.
- **Background generation**, like drug summaries: opening Research starts it when papers lack takeaways; the page polls every 2 s while pending (up to 12 minutes). A restart marks pending work as failed. Failed → "Try again".
- The generic part of the providers is extracted for reuse: `generate({ system, user, schema })` (Ollama) and documents-with-citations (Claude). The drug-info summary keeps its behavior and tests.
- **Only abstract text** (plus PMIDs) goes to the model: no notes, no medication list.

## Data model (Drizzle, `src/server/db/schema/literature.ts`, migration `0003_*`)

```ts
literatureLists = pgTable('literature_lists', {
  ingredientRxcui: text().primaryKey(),
  ingredientName: text().notNull(),
  fetchedAt: timestamp({ withTimezone: true }).notNull(),
  takeawayStatus: text({ enum: ['none', 'pending', 'ready', 'failed'] }).notNull(),
  provider: text(),
  model: text(),
  error: text(),
  startedAt: timestamp({ withTimezone: true }), // counts toward the Claude daily limit
  inputTokens: integer(),
  outputTokens: integer(),
});

literaturePapers = pgTable(
  'literature_papers',
  {
    ingredientRxcui: text().notNull(),
    pmid: text().notNull(),
    tier: text({ enum: ['review', 'rct'] }).notNull(),
    rank: integer().notNull(), // within the tier, from the search order
    title: text().notNull(),
    journal: text(),
    year: integer(),
    pubTypes: jsonb().$type<string[]>(),
    doi: text(),
    pmcid: text(),
    abstract: text().notNull(), // input for the AI only; not shown in full
    takeaway: jsonb().$type<{ text: string; quote: string | null; uncited: boolean }>(),
    hiddenAt: timestamp({ withTimezone: true }),
  },
  (t) => [primaryKey({ columns: [t.ingredientRxcui, t.pmid] })],
);

literatureTrials = pgTable(
  'literature_trials',
  {
    ingredientRxcui: text().notNull(),
    nctId: text().notNull(),
    title: text().notNull(),
    status: text().notNull(),
    phases: jsonb().$type<string[]>(),
    hasResults: boolean().notNull(),
    startDate: text(),
    lastUpdate: text(),
    rank: integer().notNull(),
  },
  (t) => [primaryKey({ columns: [t.ingredientRxcui, t.nctId] })],
);
```

The shown list is the first 10 not-hidden papers: reviews first (at most 4), then randomized trials, each by rank.

## API (session required)

| Method and path                                                          | Purpose                                                                 | Response                                       |
| ------------------------------------------------------------------------ | ----------------------------------------------------------------------- | ---------------------------------------------- |
| `GET /api/drugs/:rxcui/literature`                                       | Papers (≤ 10) and trials (≤ 5) per ingredient, plus the takeaway status | 200; 503 if PubMed is down and nothing stored  |
| `POST /api/drugs/:rxcui/literature/refresh`                              | Re-run the searches now ("Check for new research")                      | 200 with the new lists; 503 if down            |
| `POST /api/drugs/:rxcui/literature/takeaways`                            | Start takeaway generation for papers that lack one                      | 202 pending; 429 Claude limit; 503 no provider |
| `POST /api/literature/:ingredient/papers/:pmid/hide` and `DELETE …/hide` | Hide or unhide a paper                                                  | 204                                            |

The GET fetches and stores the lists on first use (a few seconds: esearch ×2, esummary, efetch and 2 trial calls per ingredient). A stored list is served immediately; a stale one (> 30 days) is served, then refreshed in the background.

## UI

- **"Research" section** on `/drugs/:rxcui`, below the summary panel; for combination products, one sub-section per ingredient.
- **Papers:** type badge (Meta-analysis, Systematic review, Randomized trial), title (links to `https://pubmed.ncbi.nlm.nih.gov/<pmid>/`), journal and year, "Free full text" link when there is a PMC id; the takeaway with a source marker opening the quoted abstract sentence (same popover as the summary); "not linked to the abstract" styling for unverified ones; a **Hide** button (with "Show hidden (n)" to undo).
- **Takeaway states:** "Writing takeaways… m:ss" while pending, failed with Try again, unavailable with the reason.
- **Trials:** NCT ID, title (links to ClinicalTrials.gov), status tag (Completed · results posted / Recruiting), phase.
- **Footer:** "Papers from PubMed, trials from ClinicalTrials.gov, found <date>. Takeaways written by AI (<model>, <local | Claude>) from the abstracts. Check anything important with your pharmacist." and **"Check for new research"**.
- Loading and error states; the rest of the drug page never waits on literature.

## State (NgRx)

`literature` feature keyed by product RXCUI: lists per ingredient, takeaway status, hidden papers. Effects: load when the Research section opens, refresh, start takeaways (automatic when missing, like summaries), poll while pending (stops on route leave), hide/unhide (optimistic, rolled back on error).

## Configuration

| Variable                            | Purpose                                                                                      |
| ----------------------------------- | -------------------------------------------------------------------------------------------- |
| `NCBI_API_KEY`                      | Optional, free from an NCBI account. Raises the limit from 3 to 10 requests/s. Never logged. |
| `NCBI_EMAIL`                        | Optional. Sent as `email=` with `tool=rxplus`, as NCBI requests.                             |
| `PUBMED_BASE_URL`, `CTGOV_BASE_URL` | Optional; the e2e tests point them at the stub server.                                       |

## Testing

- **Unit:**
  - PubMed client: both tier queries (exact `term`), esummary mapping (pub types, year from `pubdate`, DOI/PMC), efetch abstract parsing (labeled sections joined), request spacing, key redaction
  - ClinicalTrials.gov client: query params, field mapping, the completed-with-results / recruiting mix
  - selection: tiers, dedupe, cap of 4 reviews and 10 total, hidden papers skipped
  - takeaway prompt (only abstracts and PMIDs), verification against the right abstract, unknown PMIDs dropped, advice removed
  - provider refactor: drug-info summary tests unchanged and passing
  - NgRx feature and components
- **Integration (test DB):** repository (upsert keeps takeaways and hidden state), first fetch and stored reuse, stale refresh, takeaway generation with a stub provider, Claude limit shared with summaries, hide/unhide.
- **E2E:** the stub server gains esearch/esummary/efetch and ClinicalTrials.gov fixtures, and an Ollama reply for takeaways. The spec opens Research, sees papers and trials, a takeaway with its source, hides a paper and sees the next one.
- **Live check at the checkpoint:** lisinopril takeaways with `qwen2.5:7b`, reporting the verified rate and time.
- **Coverage:** ≥ 80% lines on `src/server/literature`, `src/app/features/literature`.

## Boundaries

- **Always:** link every paper and trial to its source; verify every takeaway's quote against that paper's abstract, or mark it; show "written by AI" with the model; space NCBI requests; store and reuse lists.
- **Ask first:** changing the selection rules or the list sizes; sending full texts or anything besides abstracts to a model.
- **Never:** show whole abstracts on the page (link out instead); AI ranking or choosing papers; dosing or start/stop advice; sending notes or the medication list to a model; logging API keys.

## Success criteria

1. Opening Research for lisinopril shows up to 10 papers (reviews first, at most 4) and up to 5 trials within a few seconds on first use, and instantly afterwards.
2. Every paper links to PubMed; papers with a PMC id link to the free full text; every trial links to ClinicalTrials.gov.
3. With Ollama configured, takeaways are generated in one background call; at least 80% carry a verified abstract quote, and unverified ones are marked.
4. Hiding a paper replaces it with the next candidate without a new search, survives reloads, and can be undone.
5. A combination product shows a list per ingredient.
6. PubMed or ClinicalTrials.gov down: stored lists still show, with a note; nothing stored → a clear message, and the rest of the drug page works.
7. The model receives only abstracts and PMIDs (request-building tests).
8. Lint, unit, integration and e2e tests pass; coverage targets are met; the drug-info summary behaves as before.

## Resolved decisions (2026-09-27)

1. Strongest evidence first: reviews (≤ 4), then randomized trials, to 10.
2. Trials as a separate list of up to 5 (completed with results, then recruiting).
3. One-line AI takeaway per paper from its abstract, quote-verified. This sends **PubMed abstracts** to the model (drug-info's boundary covered only label text); approved as part of this choice.
4. Automatic list with Hide (and undo); no pinning.

## Open questions

- None blocking. An NCBI API key is optional; without one the first fetch per ingredient is a little slower.
