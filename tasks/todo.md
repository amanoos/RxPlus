# Tasks: interactions

Plan: [plan.md](plan.md) · Spec: [SPEC-interactions.md](../SPEC-interactions.md)

Every task also meets the Definition of Done: lint and tests pass, no regressions, behavior checked at runtime, docs updated.

## Phase 1: Data and server

- [x] **Task 1: openFDA label client** (M)
  - Acceptance:
    - `createOpenFdaClient({ baseUrl, apiKey?, fetch, now })` with `interactionLabel(rxcui)`, which returns `{ setId, manufacturer, effectiveDate, sentences source text (drug_interactions + table, HTML stripped) }` or `null`
    - Queries `openfda.rxcui:<rxcui> AND _exists_:drug_interactions`, sorted `effective_time:desc`, `limit=1`; 404 "no matches" → `null`
    - 5 s timeout without retry, one retry on network/5xx, 7-day cache, `OpenFdaUnavailableError`; optional env `OPENFDA_BASE_URL`, `OPENFDA_API_KEY`
  - Verify: unit tests with recorded fixtures (lisinopril, atorvastatin, no-match); live smoke check
  - Files: `src/server/openfda/client.ts` (+ spec, fixtures), `src/server/openfda/index.ts`, `src/server/utils/env.ts`
  - Depends on: none

- [ ] **Task 2: DDInter schema, migration and CSV parsing** (M)
  - Acceptance:
    - `ddi_drugs`, `ddi_interactions`, `ddi_imports` per spec; migration `0001_*` generated and committed
    - `parseDdinterCsv(text)` handles quoted fields and validates the header; `splitRoute(name)` → `{ base, route }`; `normalizePairs()` orders A < B and keeps the most severe level
  - Verify: unit tests (quoted commas, bad header, dedupe, routes); migration applies to the test DB
  - Files: `src/server/db/schema/interactions.ts`, `src/server/db/schema/index.ts`, `drizzle/0001_*`, `src/server/interactions/ddinter.ts` (+ spec)
  - Depends on: none

- [ ] **Task 3: DDInter importer and `ddi:import` command** (M)
  - Acceptance:
    - Downloads the 14 CSVs (base URL configurable for tests); maps names via a new RxNav `ingredientByName(name)` (`rxcui.json?search=2`, IN preferred), throttled ≤ 10/s, reusing prior mappings
    - Replaces all `ddi_*` rows in one transaction with batched inserts; records a `ddi_imports` row; prints a summary; exits non-zero below 90% mapped (old data kept)
    - `npm run ddi:import` (dev) and `dist/ddi-import.cjs` (esbuild, copied into the Docker image)
  - Verify: integration test with fixture CSVs + stubbed RxNav (replace, idempotence, 90% guard keeps old data)
  - Files: `src/server/interactions/importer.ts` (+ int spec, fixtures), `scripts/ddi-import.ts`, `src/server/rxnorm/client.ts`, `package.json`, `Dockerfile`
  - Depends on: 2

- [ ] **Task 4: Interaction report builder and queries** (M)
  - Acceptance:
    - `buildReport(pairsFromDb, meds, candidate?)` implements the spec's matching rules: per ingredient; route filter by dose form; shared ingredients ignored; max level per pair; sorted Major → Unknown; notCovered
    - The repository fetches DDInter drugs by ingredient RXCUIs and the pairs among them in two queries; `source.importedAt` comes from the latest import
  - Verify: pure unit tests (combination product, topical vs oral, shared ingredient, notCovered, ordering); integration test on seeded tables
  - Files: `src/server/interactions/report.ts` (+ spec), `src/server/interactions/repository.ts` (+ int spec)
  - Depends on: 2

- [ ] **Task 5: Label evidence matching** (M)
  - Acceptance:
    - RxNav client gains `classNames(ingredientRxcui)` (DAILYMED `has_epc`, cached)
    - `matchEvidence(labelText, other: { ingredient, brands, classes })` splits into sentences and returns ≤ 3 verbatim matches using name, brand, class and a small synonym list (NSAID, potassium-sparing diuretic, …)
    - `evidenceFor(a, b)` checks both labels; returns entries with manufacturer, date and DailyMed link; `OpenFdaUnavailableError` → 503 upstream
  - Verify: unit tests on recorded label text (lisinopril ↔ spironolactone by name; atorvastatin ↔ clarithromycin in the table field; class-only phrasing via synonyms)
  - Files: `src/server/interactions/evidence.ts` (+ spec), `src/server/rxnorm/client.ts` (+ spec)
  - Depends on: 1

- [ ] **Task 6: Interactions API routes** (M)
  - Acceptance:
    - `GET /api/interactions/check?rxcui=` (re-resolves via RxNav; 422 non-product; 503 RxNav down; 409 `no-data` before any import), `GET /api/interactions/current`, `GET /api/interactions/evidence?a=&b=` (503 if openFDA is down)
    - zod validation; session required (existing middleware)
  - Verify: route integration tests with the test DB, stubbed RxNav and openFDA
  - Files: `src/server/routes/api/interactions/{check,current,evidence}.get.ts`, `src/server/interactions/service.ts`, `src/server/tests/interactions-api.int.spec.ts`
  - Depends on: 3, 4, 5

### Checkpoint A

- [ ] Real `npm run ddi:import` against the live DDInter + RxNav into the test DB: ≥ 95% mapped; a second run gives the same counts
- [ ] curl on the built server: spironolactone vs lisinopril → Major + label sentence; atorvastatin → Unknown; notCovered example

## Phase 2: Client

- [ ] **Task 7: NgRx interactions feature and API service** (M)
  - Acceptance:
    - State `current`, `candidate`, `evidence` by pair key, loading/error; effects load `current` on medication load/add/update/remove success; `checkCandidate(rxcui)`, `loadEvidence(a, b)`
  - Verify: reducer, selector and effect tests; `InteractionsApi` tests
  - Files: `src/app/features/interactions/**` (+ specs), `src/app/store/app.store.ts`
  - Depends on: 6

- [ ] **Task 8: Extract `ProductPickerComponent` from the add dialog** (M)
  - Acceptance:
    - The drug search → product radio list moves into a reusable component with an `rxcui` output; the add dialog uses it with identical behavior (existing tests adapted, still green)
  - Verify: component tests; existing medications e2e still passes
  - Files: `src/app/features/medications/product-picker.component.ts` (+ spec), `add-medication-dialog.component.ts` (+ spec)
  - Depends on: none

- [ ] **Task 9: `/interactions` page** (M)
  - Acceptance:
    - "Check a new prescription" (picker → report) and "Between your current medications" (SSR); severity tags (Major red, Moderate orange, Minor blue, Unknown gray, "Listed, severity not rated"); expandable evidence with verbatim quotes and DailyMed links; notCovered message; attribution footer with import date and disclaimer; no-data state explaining `ddi:import`
  - Verify: component tests; browser check
  - Files: `src/app/pages/(app)/interactions.page.ts` (+ spec), `src/app/features/interactions/interaction-list.component.ts` (+ spec)
  - Depends on: 7, 8

- [ ] **Task 10: Add-dialog warning and dashboard summary** (S)
  - Acceptance:
    - After a product is picked in the add dialog, a compact warning lists interacting current meds with severity and a details link; _Add_ stays enabled
    - The dashboard shows "N Major interactions between your current medications" (or none) linking to `/interactions`
  - Verify: component tests; browser check
  - Files: `add-medication-dialog.component.ts` (+ spec), `src/app/pages/(app)/index.page.ts` (+ spec)
  - Depends on: 9

### Checkpoint B

- [ ] Browser: check flow, current pairs, evidence, add-dialog warning, dashboard; 375px and 1280px; openFDA-down message

## Phase 3: Verification

- [ ] **Task 11: E2E with stub DDInter, RxNav and openFDA** (M)
  - Acceptance:
    - The stub server serves small DDInter CSVs and openFDA label fixtures; global setup runs the importer against the stub
    - Specs: check spironolactone vs active lisinopril (Major + label sentence); add-dialog warning; current pairs
  - Verify: `npm run e2e` (5 repeats stable)
  - Files: `e2e/stub-rxnav.ts` (renamed stub server if needed), `e2e/global-setup.ts`, `e2e/interactions.spec.ts`, fixtures
  - Depends on: 10

- [ ] **Task 12: Docker import run, coverage, docs** (S)
  - Acceptance:
    - `docker compose run --rm app node dist/ddi-import.cjs` imports in the container; the app shows interactions
    - Coverage ≥ 80% on `src/server/interactions`, `src/server/openfda`, `src/app/features/interactions`
    - README: DDInter import, attribution, openFDA key note
  - Verify: `rxplus-verify` Docker run (then removed); `npm run test:coverage`
  - Files: `vite.config.ts`, `README.md`, `.env.example`
  - Depends on: 11

### Checkpoint C: interactions complete

- [ ] Spec success criteria 1–8
- [ ] Human review, then `SPEC-drug-info.md`
