# Tasks: per-user-hiding

Plan: [plan.md](plan.md) · Spec: [SPEC-per-user-hiding.md](../../SPEC-per-user-hiding.md)

Every task also meets the Definition of Done: lint and tests pass, nothing regresses, behavior is checked at runtime, and the docs are updated.

## Phase 1: Data

- [x] **Task 1: Schema and migration 0010** (S)
  - Acceptance: `literature_hidden (user_id → users on delete cascade, ingredient_rxcui, pmid, hidden_at)` with the primary key `(user_id, ingredient_rxcui, pmid)`. `literature_papers.hidden_at` is dropped. `alternative_hidden.user_id` is not null with delete cascade, and the primary key is `(user_id, ingredient_rxcui, hidden_rxcui)`. `0010` clears `alternative_hidden` first.
  - Verify: `npm run db:generate` reports no drift after the edit; the integration setup applies it
  - Files: `src/server/db/schema/{literature,alternatives}.ts`, `drizzle/0010_*`
  - Depends on: none

- [x] **Task 2: Repositories take the user** (M)
  - Acceptance: `shownPapers(ingredient, userId)`, `hiddenPapers(ingredient, userId)` and `setHidden(userId, ingredient, pmid, hidden)`, which returns false for a non-candidate. Alternatives `hide`, `unhide` and `hidden` take `userId` first.
  - Verify: repository integration tests with two users, hides surviving `saveFetched`, and the cascade on user removal
  - Files: `src/server/literature/repository.ts`, `src/server/alternatives/repository.ts` (+ int specs)
  - Depends on: 1

### Checkpoint A

- [x] Repository integration tests pass with two users

## Phase 2: Routes

- [x] **Task 3: Services and routes** (M)
  - Acceptance: `literatureService(userId)` covers get, refresh, startTakeaways and setHidden. The alternatives service passes its user to the hide calls. The five literature routes pass `requireUser(event).id`.
  - Verify: `literature-api` and `alternatives-api` integration specs as Alice and Bob
  - Files: `src/server/literature/service.ts`, `src/server/alternatives/service.ts`, `src/server/routes/api/drugs/[rxcui]/literature/*.ts`, `src/server/routes/api/literature/**`, `src/server/tests/{literature,alternatives}-api.int.spec.ts`
  - Depends on: 2

### Checkpoint B

- [x] Full unit and integration suites pass

## Phase 3: Verification

- [x] **Task 4: E2E, docs and coverage** (S)
  - Acceptance: e2e tests where one account hides a paper and an alternative and the other still sees both. The README describes personal hides. Coverage on literature and alternatives is 80% or above.
  - Verify: `npm run e2e`; `npm run test:coverage`
  - Files: `e2e/{literature,alternatives}.spec.ts`, `README.md`
  - Depends on: 3

- [x] **Task 5: Release rehearsal** (S)
  - Acceptance: on a copy of the real database, with a separately tagged image:
    - `migrate.cjs` applies `0007`–`0010`
    - `user.cjs add` creates two accounts
    - both sign in over HTTP
    - lists and digests are empty, and research, alternatives and interaction data remain
  - Verify: the commands and their output, recorded in the report
  - Files: none
  - Depends on: 4

### Checkpoint C: per-user-hiding and the multi-user initiative complete

- [x] Spec success criteria 1–7
- [x] Human review (approved 2026-09-29); then the README upgrade checklist can be followed
