# Tasks: literature

Plan: [plan.md](plan.md) · Spec: [SPEC-literature.md](../SPEC-literature.md)

Every task also meets the Definition of Done: lint and tests pass, no regressions, behavior checked at runtime, docs updated.

## Phase 1: Server

- [x] **Task 1: PubMed client** (M)
  - Acceptance:
    - `searchPapers(ingredient)` runs both tiers (exact `term` strings from the spec, `hasabstract`, relevance order, 20 each) and returns PMIDs per tier, de-duplicated (a PMID in both tiers stays a review)
    - `paperDetails(pmids)` from esummary: title, journal, year (from `pubdate`), pub types, DOI, PMC id
    - `abstracts(pmids)` from efetch XML: labeled sections joined as "LABEL: text", entities decoded, missing → skipped
    - requests serialized with 400 ms spacing (110 ms with `NCBI_API_KEY`), a 429 retried after 1 s then 2 s; `tool=rxplus`, optional `email`; key redacted from logs; `PUBMED_BASE_URL`, `NCBI_API_KEY`, `NCBI_EMAIL` in env
    - `upstream.ts` gains a text fetch helper with the same timeout/retry rules
  - Verify: unit tests with recorded fixtures (lisinopril esearch ×2, esummary, efetch with structured and plain abstracts, no results)
  - Files: `src/server/pubmed/{client,index}.ts` (+ spec, fixtures), `src/server/utils/upstream.ts`, `src/server/utils/env.ts` (+ specs)
  - Depends on: none

- [x] **Task 2: ClinicalTrials.gov client** (S)
  - Acceptance: `trials(ingredient)` → up to 3 completed with results, then recruiting, up to 5 total; mapped `{ nctId, title, status, phases, hasResults, startDate, lastUpdate }`; `CTGOV_BASE_URL` in env; 7-day cache
  - Verify: unit tests with recorded fixtures (lisinopril completed-with-results, recruiting, none)
  - Files: `src/server/ctgov/{client,index}.ts` (+ spec, fixtures), `src/server/utils/env.ts`
  - Depends on: none

- [x] **Task 3: Schema, migration 0003 and repository** (M)
  - Acceptance:
    - `literature_lists`, `literature_papers`, `literature_trials` as in the spec; migration `0003_create_literature`
    - repository: save a fetched list (upsert papers keeping `takeaway` and `hiddenAt`; replace trials), shown papers (first 10 not hidden, ≤ 4 reviews, by tier and rank), hidden papers, hide/unhide, takeaway state (claim/complete/fail), `failInterrupted`
  - Verify: integration tests (upsert keeps takeaways and hidden state, selection rules, hide promotes the next candidate)
  - Files: `src/server/db/schema/literature.ts`, `drizzle/0003_*`, `src/server/literature/repository.ts` (+ int spec)
  - Depends on: none

- [x] **Task 4: Literature service and routes** (M)
  - Acceptance:
    - `GET /api/drugs/:rxcui/literature`: per ingredient, first use fetches and stores (PubMed + CT.gov), stored lists served immediately, lists older than 30 days served then refreshed in the background; PubMed down with nothing stored → 503; stored + down → served with a `stale` note
    - `POST /api/drugs/:rxcui/literature/refresh`: re-search now, keeping takeaways and hidden state
    - `POST|DELETE /api/literature/:ingredient/papers/:pmid/hide` → 204
    - response: per ingredient `{ ingredient, papers[≤10], hiddenCount, trials[≤5], fetchedAt, takeaways: { status, provider, model, error } }`; abstracts never included
  - Verify: route integration tests with stubbed clients (first fetch, reuse, stale refresh, outage, hide/unhide, combination product)
  - Files: `src/server/literature/service.ts`, `src/server/routes/api/drugs/[rxcui]/literature/*.ts`, `src/server/routes/api/literature/[ingredient]/papers/[pmid]/hide.{post,delete}.ts`, `src/server/tests/literature-api.int.spec.ts`
  - Depends on: 1, 2, 3

- [x] **Task 5: Provider refactor** (M)
  - Acceptance:
    - Ollama: generic `generateJson({ system, user, schema, zod })` with the same size check, timeout and error mapping; the summary provider uses it
    - Claude: generic `generateCited({ system, documents, instruction })` returning text blocks with citations; the summary parser uses it
    - quote-verification helpers (normalize, stems, synonyms, relevance, advice filter) moved to `src/server/ai/verify.ts`
    - drug-info unit, integration and e2e tests pass without changes to their assertions
  - Verify: `npm test`, `npm run test:int`, drug-info e2e spec
  - Files: `src/server/ai/{verify,ollama,claude}.ts` (+ specs), `src/server/drug-info/providers/*`, `src/server/drug-info/summary.ts`
  - Depends on: none

- [x] **Task 6: Takeaway core** (M)
  - Acceptance:
    - prompt rules from the spec; the user message has only `### PMID <id>` + abstract per paper
    - zod schema `{ takeaways: [{ pmid, text, quote }] }`; Claude variant parsed from `## PMID <id>` blocks with citations mapped by document index
    - verification per paper: quote found in that paper's abstract and relevant, else uncited; unknown PMIDs and duplicates dropped; advice removed
  - Verify: unit tests (request contains only abstracts and PMIDs; cross-paper quote → uncited; unknown PMID dropped; advice removed; Claude parsing)
  - Files: `src/server/literature/takeaways.ts` (+ spec)
  - Depends on: 5

- [x] **Task 7: Takeaway generation** (M)
  - Acceptance:
    - `POST /api/drugs/:rxcui/literature/takeaways` → 202; one background call per ingredient for shown papers lacking a takeaway; results stored per paper; status on the list row; idempotent while pending
    - Claude daily limit counts starts in `drug_summaries` and `literature_lists` together (429); no provider → 503
    - startup plugin also marks pending takeaway work failed
  - Verify: integration tests with a stub provider (happy path, partial verification, failure and retry, idempotence, shared limit)
  - Files: `src/server/literature/service.ts`, route, `src/server/plugins/summaries.ts`, `src/server/drug-info/repository.ts` (shared count), tests
  - Depends on: 4, 6

### Checkpoint A

- [x] Unit and integration tests pass; migration applies
- [x] curl: lisinopril lists from live PubMed and ClinicalTrials.gov; takeaways with a stub provider, then live with `qwen2.5:7b` (2026-09-27: lists 2.5 s first, 11 ms stored; takeaways 4:38, 8/10 linked; one linked takeaway misread its quote → support check added, rerun 5:00, 3 supported / 5 not / 2 not linked; tighter prompt rerun 4:28, 8/10 linked with close paraphrases, but the 7B check misjudged ≥ 4 of 5 → check off unless `OLLAMA_CHECK_MODEL` is set)

## Phase 2: Client

- [x] **Task 8: NgRx `literature` feature and API service** (M)
  - Acceptance: entries keyed by product RXCUI (lists per ingredient, takeaway state); effects: load, refresh, start takeaways automatically when missing (browser only), poll every 2 s while pending (≤ 12 min, stops on leave), hide/unhide optimistic with rollback
  - Verify: reducer, selector and effect tests (fake timers for polling, rollback on error)
  - Files: `src/app/features/literature/**`, `src/app/store/app.store.ts`
  - Depends on: 7

- [x] **Task 9: Research section: papers** (M)
  - Acceptance: on `/drugs/:rxcui` below the summary, one block per ingredient; each paper: type badge, title → PubMed, journal · year, "Free full text" when PMC; takeaway with its quote shown inline below it ("In the study: '…'"); a note when the quote doesn't back up all of it (`supported: false`); unverified takeaways marked; pending (elapsed), failed (retry), unavailable (reason) states; loading and error states that never block the page
  - Verify: component tests; browser check
  - Files: `src/app/features/literature/research-section.component.ts`, `paper-list.component.ts` (+ specs), drug page
  - Depends on: 8

- [x] **Task 10: Hide, trials, footer and refresh** (S)
  - Acceptance: Hide button per paper and "Show hidden (n)" with Unhide; trials list (NCT id, title → ClinicalTrials.gov, status tag, phase); footer with sources, date, AI model; "Check for new research"
  - Verify: component tests; browser check
  - Files: `trial-list.component.ts`, `paper-list.component.ts`, `research-section.component.ts` (+ specs)
  - Depends on: 9

- [x] **Task 10b: Summary panel "Show quotes" toggle** (S)
  - Acceptance: a toggle on the drug summary panel shows every sentence's quote inline below it (markers and popovers stay); remembered per session
  - Verify: component tests; browser check
  - Files: `src/app/features/drug-info/summary-panel.component.ts` (+ spec)
  - Depends on: none

### Checkpoint B

- [x] Browser: Research section states, takeaways, hide/undo, trials; 375px and desktop

## Phase 3: Verification

- [x] **Task 11: E2E with stub PubMed, ClinicalTrials.gov and Ollama** (M)
  - Acceptance: the stub serves esearch (by tier), esummary, efetch, CT.gov studies and an Ollama takeaway reply (chosen by the request's system prompt); the spec opens Research, sees papers and trials, a verified takeaway with its source, hides a paper and sees the next one, and undoes it
  - Verify: `npm run e2e` (3 repeats stable)
  - Files: `e2e/stub-upstream.ts`, `e2e/literature.spec.ts`, fixtures, `playwright.config.ts`
  - Depends on: 10

- [x] **Task 12: Coverage, README, `.env.example`** (S)
  - Acceptance: coverage ≥ 80% on `src/server/literature`, `src/server/pubmed`, `src/server/ctgov`, `src/app/features/literature`; README section on Research (sources, how papers are chosen, takeaways, NCBI key); env table and `.env.example` updated
  - Verify: `npm run test:coverage`; production build
  - Files: `vite.config.ts`, `README.md`, `.env.example`
  - Depends on: 11

### Checkpoint C: literature complete

- [ ] Spec success criteria 1–8; live takeaways with the verified rate reported
- [ ] Human review, then `SPEC-alternatives.md`
