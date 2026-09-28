# Tasks: pricing

Plan: [plan.md](plan.md) · Spec: [SPEC-pricing.md](../SPEC-pricing.md)

Every task also meets the Definition of Done: lint and tests pass, no regressions, behavior checked at runtime, docs updated.

## Phase 1: Server

- [x] **Task 1: Cost Plus client and RxNav NDCs** (S)
  - Acceptance: `costPlus.items(ingredient)` → `{ ndc, strength, form, brandGeneric, unitPrice, unitBillingPrice, url }[]` (dollar strings parsed, empty results → [], errors → `CostPlusUnavailableError`, 24 h cache, calls spaced); RxNav `ndcs(rxcui)` → 11-digit NDCs (7 days)
  - Verify: unit tests with recorded fixtures
  - Files: `src/server/costplus/{client,index}.ts` (+ spec, fixtures), `src/server/rxnorm/client.ts`, `src/server/utils/env.ts`
  - Depends on: none

- [x] **Task 2: Migration 0006 and medication cost fields** (S)
  - Acceptance: `units_per_month` (default 30), `copay_cents`, `copay_units`; PATCH accepts `unitsPerMonth` (> 0, ≤ 1000, 0.5 steps) and `copay: { amountCents, units } | null`; responses include them
  - Verify: integration tests
  - Files: `src/server/db/schema/medications.ts`, `drizzle/0006_*`, `src/server/medications/service.ts` (+ tests), client medication type
  - Depends on: none

- [x] **Task 3: Pricing math, service and routes** (M)
  - Acceptance: math (cash, insured, difference, totals, rounding); `GET /api/drugs/:rxcui/prices` (match by NDC, not sold, 503); `GET /api/costs` (active medications, per-item figures and reasons, totals, missing counts)
  - Verify: unit tests for math; route integration tests with stubbed clients
  - Files: `src/server/pricing/{math,service}.ts` (+ specs), `src/server/routes/api/drugs/[rxcui]/prices.get.ts`, `src/server/routes/api/costs.get.ts`, tests
  - Depends on: 1, 2

### Checkpoint A

- [x] Unit and integration tests pass; migration applies
- [x] Live: prices for current medications (matches, not-sold cases)

## Phase 2: Client

- [x] **Task 4: NgRx pricing feature and API service** (S)
  - Acceptance: load prices per product, load costs; reload after a medication update
  - Verify: reducer, selector and effect tests
  - Files: `src/app/features/pricing/**`, `src/app/store/app.store.ts`
  - Depends on: 3

- [ ] **Task 5: Drug page Prices section and cost fields in the edit dialog** (M)
  - Acceptance: Prices section (per unit, monthly, fee note, link, as-of, not sold, unavailable; for a listed medication: units, copay, comparison, Edit); edit dialog gains units per month and copay
  - Verify: component tests
  - Files: `src/app/features/pricing/prices-section.component.ts`, drug page, `edit-medication-dialog.component.ts` (+ specs)
  - Depends on: 4

- [ ] **Task 6: Costs page and navigation** (M)
  - Acceptance: `/costs` with rows (cards below 768px), cheaper option, totals, missing counts, note, Edit; "Costs" in the navigation
  - Verify: component tests; browser check
  - Files: `src/app/pages/(app)/costs.page.ts` (+ spec), `app-shell.component.ts`
  - Depends on: 5

### Checkpoint B

- [ ] Browser: Prices section, edit fields, Costs page totals; 375px and desktop

## Phase 3: Verification

- [ ] **Task 7: E2E with a Cost Plus stub** (S)
  - Acceptance: the stub serves Cost Plus and RxNav NDCs; the spec sets units and a copay and sees the Prices section and Costs totals
  - Verify: `npm run e2e` (3 repeats stable)
  - Files: `e2e/stub-upstream.ts`, `e2e/pricing.spec.ts`, `playwright.config.ts`
  - Depends on: 6

- [ ] **Task 8: Coverage, README** (S)
  - Acceptance: coverage ≥ 80% on `src/server/costplus`, `src/server/pricing`, `src/app/features/pricing`; README section
  - Verify: `npm run test:coverage`; production build
  - Files: `vite.config.ts`, `README.md`
  - Depends on: 7

### Checkpoint C: pricing complete

- [ ] Spec success criteria 1–5
- [ ] Human review
