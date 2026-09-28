# Tasks: alternatives

Plan: [plan.md](plan.md) · Spec: [SPEC-alternatives.md](../SPEC-alternatives.md)

Every task also meets the Definition of Done: lint and tests pass, no regressions, behavior checked at runtime, docs updated.

## Phase 1: Server

- [x] **Task 1: RxNav extensions** (M)
  - Acceptance:
    - `drugFacts` also returns `uses: { id, name }[]` (MED-RT `may_treat` with disease ids); existing fields unchanged
    - `epcClass(ingredientRxcui)` → `{ id, name } | null`; `classMembers(epcId)` and `diseaseMembers(diseaseId)` → ingredient concepts, with salt forms mapped to their ingredient and metabolites/duplicates removed; `moreSpecificDiseases(diseaseId)`-style lookup for the cleaning rule (MED-RT diseases whose name contains the condition's)
    - `usProduct(ingredientRxcui)` → representative single-ingredient product (oral tablet/capsule first) or `null` when none is prescribable in the US
    - requests paced ≤ 20/s; results cached 30 days
  - Verify: unit tests with recorded fixtures (ACE inhibitor EPC members, hypertension and pulmonary-hypertension members, lisinopril uses, availability for a US and a non-US ingredient)
  - Files: `src/server/rxnorm/client.ts` (+ spec, fixtures)
  - Depends on: none

- [ ] **Task 2: Drugs@FDA facts and label indications** (S)
  - Acceptance:
    - `approvalFacts(ingredientName)` → `{ firstApproved: 'YYYY-MM-DD' | null, genericAvailable: boolean }` from `drugsfda.json` (earliest ORIG NDA approval containing the ingredient; ANDA with the ingredient alone); exact "<name>" / "<name> <salt>" matching (enalapril ≠ enalaprilat)
    - `indications(ingredientName)` → newest label's `indications_and_usage` text or `null`
    - paced ≤ 4/s; cached 30 days; the API key is used and redacted as today
  - Verify: unit tests with recorded fixtures (lisinopril, enalapril, aprocitentan, sacubitril combination-only, bosentan and hydralazine labels)
  - Files: `src/server/openfda/client.ts` (+ spec, fixtures)
  - Depends on: none

- [ ] **Task 3: Schema, migration 0004 and repository** (M)
  - Acceptance: `medications.taken_for_id/name`; `alternative_lists`, `alternative_drugs`, `alternative_hidden` as in the spec; repository: claim/complete/fail a list build (one at a time per key), save drugs, read lists, stale check, hide/unhide/hidden per ingredient, `failInterrupted`
  - Verify: integration tests (migration, one build at a time, save/replace, hidden)
  - Files: `src/server/db/schema/{alternatives,medications}.ts`, `drizzle/0004_*`, `src/server/alternatives/repository.ts` (+ int spec)
  - Depends on: none

- [ ] **Task 4: List builder** (M)
  - Acceptance:
    - class list: EPC members → available ingredients → facts (class, first approval, generic, product)
    - condition list: disease members → available ingredients → cleaning rule (drugs also listed for a more specific form kept only if their label indications mention the condition outside that form) → EPC class per drug → facts
    - one failed ingredient is left out and counted; background job with status; built lists reused for 30 days; startup plugin fails interrupted builds
    - pure `cleanCondition()` and `groupAlternatives()` (new within 5 years, same class, other classes by class, the viewed drug and its class removed)
  - Verify: unit tests for the pure functions with recorded hypertension data (hydralazine and nitroglycerin kept; bosentan and sildenafil dropped; aprocitentan new); integration test of a build with stubbed clients (partial failure counted, reuse)
  - Files: `src/server/alternatives/{builder,group,clean}.ts` (+ specs), `src/server/plugins/summaries.ts`
  - Depends on: 1, 2, 3

- [ ] **Task 5: Routes and "Taken for"** (M)
  - Acceptance:
    - `GET /api/drugs/:rxcui/alternatives?condition=` per ingredient: uses (for the chooser), the chosen condition (medication `takenFor`, else the query), groups, list statuses, `builtAt`, skipped count, hidden; starts missing builds
    - `POST /api/drugs/:rxcui/alternatives/refresh` → 202; `POST|DELETE /api/alternatives/:ingredient/hidden/:rxcui` → 204
    - `PATCH /api/medications/:id` accepts `takenFor: { id, name } | null`; responses include it
  - Verify: route integration tests with stubbed clients (first visit pending then ready, condition from medication vs query, hide/unhide, refresh, takenFor validation)
  - Files: `src/server/alternatives/service.ts`, `src/server/routes/api/drugs/[rxcui]/alternatives/*.ts`, `src/server/routes/api/alternatives/[ingredient]/hidden/[rxcui].{post,delete}.ts`, medications service/route, tests
  - Depends on: 4

### Checkpoint A

- [ ] Unit and integration tests pass; migration applies
- [ ] Live: lisinopril for hypertension (build time, counts per group, noise check) and for heart failure

## Phase 2: Client

- [ ] **Task 6: "Taken for" on medications** (S)
  - Acceptance: the edit dialog has a "Taken for" select filled from the drug's known uses (loaded from `/api/drugs/:rxcui`), with "Not set"; the card shows "For: <condition>"; NgRx medications update carries `takenFor`
  - Verify: component and store tests
  - Files: `edit-medication-dialog.component.ts`, `medication-card.component.ts`, `medication.ts`, medications store (+ specs)
  - Depends on: 5

- [ ] **Task 7: NgRx `alternatives` feature and API service** (M)
  - Acceptance: entries keyed by product RXCUI + condition; load, choose condition (saves `takenFor` when the product is on the list, else per visit), refresh, poll every 2 s while any list is building (≤ 5 min, stops on leave, browser only), hide/unhide optimistic with rollback
  - Verify: reducer, selector and effect tests
  - Files: `src/app/features/alternatives/**`, `src/app/store/app.store.ts`
  - Depends on: 5

- [ ] **Task 8: Alternatives section** (M)
  - Acceptance: after Research; the always-visible note; condition chooser (buttons from the drug's uses) and "For <condition> (change)"; groups "New for …", "Same class (…)", "Other classes for …" (collapsible per class, with counts); rows with link, "New (year)", first approved, generic, Hide; "Show hidden"; building / failed / skipped states; footer with sources, date, "Check for new approvals"; per ingredient for combinations
  - Verify: component tests; browser check
  - Files: `src/app/features/alternatives/*.component.ts` (+ specs), drug page
  - Depends on: 7

### Checkpoint B

- [ ] Browser: chooser, groups, links, hide/undo, building state; 375px and desktop

## Phase 3: Verification

- [ ] **Task 9: E2E with stub RxClass, Drugs@FDA and labels** (M)
  - Acceptance: the stub serves class/disease members, availability, Drugs@FDA and label fixtures; the spec sets "Taken for" on lisinopril, sees the three groups (aprocitentan new; ACE inhibitors; other classes without bosentan), opens an alternative's page, hides one and undoes it
  - Verify: `npm run e2e` (3 repeats stable)
  - Files: `e2e/stub-upstream.ts`, `e2e/alternatives.spec.ts`, fixtures
  - Depends on: 8

- [ ] **Task 10: Coverage, README, `.env.example`** (S)
  - Acceptance: coverage ≥ 80% on `src/server/alternatives`, `src/app/features/alternatives`; README section on Alternatives (sources, "Taken for", cleaning, not a recommendation); env docs if anything new
  - Verify: `npm run test:coverage`; production build
  - Files: `vite.config.ts`, `README.md`
  - Depends on: 9

### Checkpoint C: alternatives complete

- [ ] Spec success criteria 1–8; live counts reported
- [ ] Human review, then `SPEC-digest.md`
