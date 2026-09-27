# Tasks: medications

Plan: [plan.md](plan.md) · Spec: [SPEC-medications.md](../SPEC-medications.md)

Every task also meets the Definition of Done: lint and tests pass, no regressions, behavior checked at runtime, docs updated.

## Phase 1: Server

- [x] **Task 1: RxNav client with timeout, retry, cache and fixtures** (M)
  - Acceptance:
    - `createRxNavClient({ baseUrl, fetch, now })` exposes `search(q)` (filters the cached Prescribe display-name list, ~13.6k names, case-insensitive), `products(name)`, `product(rxcui)` (properties first; skips the other calls for non-products); defaults from `RXNAV_BASE_URL` (optional env, default `https://rxnav.nlm.nih.gov/REST`)
    - 5-second timeout, one retry on network error (not on 4xx), TTL cache (search 24 hours, product 7 days); failures throw `RxNavUnavailableError`
    - Mapping handles single-ingredient, combination and branded products; `product()` returns `null` for non-SCD/SBD or unknown RXCUIs
  - Verify: unit tests on recorded fixtures (lisinopril, a combination product, a branded product, empty results), fake timers for the timeout/retry/cache
  - Files: `src/server/rxnorm/client.ts`, `src/server/rxnorm/client.spec.ts`, `src/server/rxnorm/fixtures/*.json`, `src/server/utils/env.ts`
  - Depends on: none

- [x] **Task 2: RxNorm search and products proxy routes** (S)
  - Acceptance:
    - `GET /api/rxnorm/search?q=` (2–100 characters) and `GET /api/rxnorm/products?name=` return mapped results; 400 on bad input; 503 with a generic message when RxNav is unavailable
    - Both require a session (existing middleware)
  - Verify: route tests in `src/server/tests/` with a stubbed client
  - Files: `src/server/routes/api/rxnorm/search.get.ts`, `src/server/routes/api/rxnorm/products.get.ts`, `src/server/rxnorm/index.ts` (shared instance), `src/server/tests/rxnorm-api.spec.ts`
  - Depends on: 1

- [ ] **Task 3: Medications schema, first migration and repository** (M)
  - Acceptance:
    - `medications` table per spec, with a partial unique index on `rxcui` where `stopped_on is null`
    - `drizzle/0000_*.sql` generated and committed; the drizzle config points at the schema index
    - The repository offers `list()` (active first, then stopped, newest first), `create()`, `update()`, `remove()`; a unique violation maps to a `DuplicateActiveMedicationError`
  - Verify: integration tests against `rxplus_test` (migrations applied in setup); `npm run db:migrate` against the dev DB
  - Files: `src/server/db/schema/medications.ts`, `src/server/db/schema/index.ts`, `drizzle/`, `src/server/medications/repository.ts`, `src/server/medications/repository.int.spec.ts`
  - Depends on: none

- [ ] **Task 4: Medications API (list, create with re-verify, update, delete)** (M)
  - Acceptance:
    - Routes per spec with zod validation: `POST` accepts only `{ rxcui, notes?, startedOn? }` and stores RxNav's details; 422 for non-SCD/SBD; 409 duplicate; 503 RxNav down
    - `PATCH` updates notes/startedOn/stoppedOn (restart = `stoppedOn: null`, 409 if that creates a duplicate); `DELETE` returns 204/404
    - Notes max 1000 characters; dates `YYYY-MM-DD`, `stoppedOn` not before `startedOn`
  - Verify: route tests with a stubbed RxNav client and the test DB
  - Files: `src/server/routes/api/medications/{index.get,index.post,[id].patch,[id].delete}.ts`, `src/server/medications/service.ts`, `src/server/tests/medications-api.int.spec.ts`
  - Depends on: 1, 3

### Checkpoint A

- [ ] Unit and integration tests pass; migration applies to the dev DB
- [ ] Manual curl run of search → products → add → duplicate 409 → stop → delete

## Phase 2: Client

- [ ] **Task 5: NgRx medications feature (`@ngrx/entity`) and API service** (M)
  - Acceptance:
    - Entity adapter sorted active first; actions and effects for load/add/update/remove with user-facing error messages (409, 422, 503)
    - Selectors `selectActive`, `selectStopped`, `selectLoaded`, `selectSaving`, `selectError`; registered in `provideAppStore`
  - Verify: reducer, selector and effect unit tests; `MedicationsApi` tests with `HttpTestingController`
  - Files: `src/app/features/medications/store/*`, `src/app/features/medications/medications-api.service.ts` (+ specs), `src/app/store/app.store.ts`
  - Depends on: 4

- [ ] **Task 6: `/medications` list page with SSR, stopped section and empty state** (M)
  - Acceptance:
    - Cards show name, strength, form, brand, started date and notes; "Stopped" is a collapsible section; empty state with an "Add medication" button
    - The SSR HTML already contains the list; no refetch flash on hydration (transfer cache, or Analog `load` as a fallback)
  - Verify: component tests; curl the SSR HTML with a session for the medication name; browser check for no double request and no hydration warnings
  - Files: `src/app/pages/(app)/medications.page.ts`, `src/app/features/medications/medication-card.component.ts` (+ specs)
  - Depends on: 5

- [ ] **Task 7: Add-medication dialog** (M)
  - Acceptance:
    - A PrimeNG Dialog with AutoComplete (300 ms debounce, 2+ characters) → product list (generics first) → optional start date and notes → Save dispatches `add`; closes on success, shows the 409/503 message on failure
    - RxNav-down message "Drug lookup is unavailable right now"; keyboard-operable
  - Verify: component tests with a stubbed API; manual browser run
  - Files: `src/app/features/medications/add-medication-dialog.component.ts` (+ spec), `src/app/features/medications/rxnorm-api.service.ts` (+ spec), `medications.page.ts`
  - Depends on: 6

- [ ] **Task 8: Edit notes/start date, stop, restart, delete with confirmation** (M)
  - Acceptance:
    - Per-card actions: Edit (notes, start date), Stop (date defaults to today, editable), Restart, Delete (PrimeNG ConfirmDialog)
    - The store updates in place; errors surface as messages
  - Verify: component tests; manual browser run
  - Files: `src/app/features/medications/medication-card.component.ts`, `src/app/features/medications/edit-medication-dialog.component.ts` (+ specs), `medications.page.ts`
  - Depends on: 7

### Checkpoint B

- [ ] Full flow in the browser at 375px and 1280px, light and dark; no hydration warnings; RxNav-down message shown with the list still usable

## Phase 3: Verification

- [ ] **Task 9: E2E against a stub RxNav** (M)
  - Acceptance:
    - Playwright starts a fixture server serving the recorded RxNav responses; the app's `RXNAV_BASE_URL` points at it
    - Specs: add a medication via search → product; duplicate shows the message; stop → appears under Stopped → restart; delete with confirmation; reload keeps the data
  - Verify: `npm run e2e` passes (5 repeats stable)
  - Files: `playwright.config.ts`, `e2e/stub-rxnav.ts`, `e2e/medications.spec.ts`
  - Depends on: 8

- [ ] **Task 10: Migration in Docker, coverage and docs** (S)
  - Acceptance:
    - `docker compose up -d --build` logs `[migrate] database is up to date`, and the medications flow works in the container
    - Coverage at least 80% on `src/server/rxnorm`, `src/server/medications`, `src/app/features/medications` (added to the coverage config)
    - README updated (RxNav note, `RXNAV_BASE_URL`)
  - Verify: Docker run under the `rxplus-verify` project, then removed; `npm run test:coverage`
  - Files: `vite.config.ts`, `README.md`, `.env.example`
  - Depends on: 9

### Checkpoint C: medications complete

- [ ] Spec success criteria 1–8 verified
- [ ] Human review, then `SPEC-interactions.md`
