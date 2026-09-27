# Tasks: drug-info

Plan: [plan.md](plan.md) · Spec: [SPEC-drug-info.md](../SPEC-drug-info.md)

Every task also meets the Definition of Done: lint and tests pass, no regressions, behavior checked at runtime, docs updated.

## Phase 1: Server

- [x] **Task 1: openFDA `summaryLabel(rxcui)` and `reportedReactions(ingredient)`** (M)
  - Acceptance:
    - `summaryLabel`: newest label with `indications_and_usage`; returns set_id, version, effective date, manufacturer, DailyMed URL and the spec's sections as plain text (HTML stripped, `warnings` used when `warnings_and_cautions` is missing); `null` when none; 7-day cache with a `fresh` option that bypasses it
    - `reportedReactions`: top 10 `{ term, count }` and total reports for an ingredient (exact generic name, upper-cased); 404 → empty; 7-day cache
  - Verify: unit tests with recorded fixtures (lisinopril label, lisinopril FAERS counts and total, no-match)
  - Files: `src/server/openfda/client.ts` (+ spec, fixtures)
  - Depends on: none

- [x] **Task 2: RxClass facts and MedlinePlus link** (M)
  - Acceptance:
    - RxNav client `drugFacts(ingredientRxcui)` → `{ classes (EPC, ATC), mayTreat, mayPrevent, avoidWith }`, de-duplicated and cached 7 days
    - `medlinePlusLink(ingredientRxcui)` from MedlinePlus Connect → `{ title, url }` or `null` (the drug page, not topic pages, preferred), cached 7 days
  - Verify: unit tests with recorded fixtures (lisinopril)
  - Files: `src/server/rxnorm/client.ts` (+ spec, fixtures), `src/server/medlineplus/client.ts` (+ spec, fixtures)
  - Depends on: none

- [x] **Task 3: `GET /api/drugs/:rxcui` and `/reported-reactions`** (S)
  - Acceptance:
    - Facts for an SCD/SBD product: name, strength, form, brand, ingredients, classes, uses, avoid-with, label reference, MedlinePlus link; 422 non-product; 503 upstream down; saved medications don't need RxNav for name/ingredients
    - Reported reactions per ingredient, plus the disclaimer text in the response
  - Verify: route integration tests with stubbed clients
  - Files: `src/server/drug-info/facts.ts`, `src/server/routes/api/drugs/[rxcui]/index.get.ts`, `…/reported-reactions.get.ts`, `src/server/tests/drug-info-api.int.spec.ts`
  - Depends on: 1, 2

- [x] **Task 4: Summary core: prompt, output schema, quote verification** (M)
  - Acceptance:
    - `buildPrompt(label)` (system rules + sections; only label text), the output zod schema (5 headings → sentences → quotes)
    - `verifySummary(raw, label)`: normalized substring match within the named section → citations; uncited flags; `uncitedRatio`; rejects wrong headings or order
  - Verify: unit tests (exact, whitespace/case/quote-mark variants, wrong section, invented quote, empty sections, the 20% threshold)
  - Files: `src/server/drug-info/summary.ts` (+ spec)
  - Depends on: 1

- [x] **Task 5: Ollama provider** (M)
  - Acceptance:
    - `POST {OLLAMA_BASE_URL}/api/chat` with `model`, `messages`, `stream: false`, `format` (JSON schema), `options: { num_ctx, temperature: 0.2 }`, timeout from env; validates the JSON reply; clear errors for unreachable, timeout, invalid JSON, model missing (404)
    - Prompt-size estimate (≈ chars / 3.5) refuses a label that won't fit `num_ctx`
    - Env: `SUMMARY_PROVIDER` (default `ollama`), `OLLAMA_BASE_URL`, `OLLAMA_MODEL` (required when provider is `ollama`), `OLLAMA_NUM_CTX` (16384), `OLLAMA_TIMEOUT_MS` (300000)
  - Verify: unit tests with a mocked fetch; a live smoke test if Ollama is reachable
  - Files: `src/server/drug-info/providers/ollama.ts` (+ spec), `src/server/utils/env.ts` (+ spec), `.env.example`
  - Depends on: 4

- [x] **Task 6: Claude provider** (M)
  - Acceptance:
    - `@anthropic-ai/sdk`; `claude-opus-5`, adaptive thinking, effort `high`, `max_tokens` 16000; sections as plain-text documents with citations; beta `server-side-fallback-2026-07-01` + `fallbacks: "default"`; `stop_reason` checked; text split at the fixed headings, `cited_text` → quotes
    - Only active when `SUMMARY_PROVIDER=claude` and `ANTHROPIC_API_KEY` are set; `AI_DAILY_LIMIT` (default 20) counted from stored rows (enforced in Task 7, where the rows live)
  - Verify: unit tests with a mocked SDK client (request shape, citation mapping, refusal, `max_tokens`)
  - Files: `src/server/drug-info/providers/claude.ts` (+ spec), `package.json`
  - Depends on: 4

- [x] **Task 7: Summary storage, background generation and summary routes** (M)
  - Acceptance:
    - `drug_summaries` table + migration `0002_*`; the repository finds by (rxcui, set_id, version)
    - `POST /api/drugs/:rxcui/summary` → 202 (a `pending` row, then generation in the background with one retry when uncited > 20%); idempotent; 429 over the Claude limit; 503 provider not configured
    - `GET …/summary` → none/pending/ready/failed for the current label; stale `pending` rows (> 10 min) marked failed at startup
  - Verify: integration tests with a stub provider (happy path, retry-then-warning, failure, idempotence, limit)
  - Files: `src/server/db/schema/drug-info.ts`, `drizzle/0002_*`, `src/server/drug-info/{repository,service}.ts`, routes, `src/server/plugins/summaries.ts`, tests
  - Depends on: 3, 5, 6

### Checkpoint A

- [ ] Unit and integration tests pass; migration applies
- [ ] curl: facts, FAERS and summary generation with the stub provider; live `qwen2.5:7b` if reachable

## Phase 2: Client

- [ ] **Task 8: NgRx `drugInfo` feature and API service** (M)
  - Acceptance: entities keyed by rxcui with facts, reactions and summary states; effects for load and start generation; polling every 2 s while pending (≤ 6 min, stops on route leave)
  - Verify: reducer, selector and effect tests (with fake timers for polling)
  - Files: `src/app/features/drug-info/**`, `src/app/store/app.store.ts`
  - Depends on: 7

- [ ] **Task 9: `/drugs/:rxcui` page: facts, FAERS, links** (M)
  - Acceptance: SSR facts (class tags, "Used for" chips, "Avoid if you have"), a FAERS bar list with an always-visible disclaimer, DailyMed and MedlinePlus links; error and loading states
  - Verify: component tests; SSR curl
  - Files: `src/app/pages/(app)/drugs/[rxcui].page.ts` (+ spec), `src/app/features/drug-info/reported-reactions.component.ts` (+ spec)
  - Depends on: 8

- [ ] **Task 10: Summary panel** (M)
  - Acceptance: five sections; citation markers with a popover (quote + label section); uncited sentences with a dotted underline and note; pending (elapsed time), failed (retry), unavailable (reason) states; "Check for a newer label"; footer with model, provider and label date
  - Verify: component tests; browser check
  - Files: `src/app/features/drug-info/summary-panel.component.ts` (+ spec), page
  - Depends on: 9

- [ ] **Task 11: Links from medication cards and interaction results** (S)
  - Acceptance: "About this drug" on each medication card; product names in interaction results link to `/drugs/:rxcui`
  - Verify: component tests; e2e navigation
  - Files: `medication-card.component.ts`, `interaction-list.component.ts` (+ specs)
  - Depends on: 9

### Checkpoint B

- [ ] Browser: page, FAERS disclaimer, summary states, citation popover; 375px and desktop

## Phase 3: Verification

- [ ] **Task 12: E2E with stub Ollama and FAERS** (M)
  - Acceptance: the stub server serves `/api/chat` (a recorded, quote-accurate JSON summary for lisinopril) and FAERS counts; the spec opens a drug page from a medication card, sees the facts, FAERS and disclaimer, generates a summary, and opens a citation
  - Verify: `npm run e2e` (3 repeats stable)
  - Files: `e2e/stub-upstream.ts`, `e2e/drug-info.spec.ts`, fixtures, `playwright.config.ts`
  - Depends on: 11

- [ ] **Task 13: Docker, coverage, README** (S)
  - Acceptance: Compose `extra_hosts: host.docker.internal:host-gateway` and the `OLLAMA_*` env; coverage ≥ 80% on drug-info (server + client); README section on Ollama setup (`OLLAMA_HOST=0.0.0.0`, the model pull, provider switch, the Claude option)
  - Verify: `rxplus-verify` Docker run; `npm run test:coverage`
  - Files: `docker-compose.yml`, `vite.config.ts`, `README.md`, `.env.example`
  - Depends on: 12

### Checkpoint C: drug-info complete

- [ ] Spec success criteria 1–8; live `qwen2.5:7b` summary on the home server with the uncited rate reported
- [ ] Human review, then `SPEC-literature.md`
