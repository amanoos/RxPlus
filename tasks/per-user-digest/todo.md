# Tasks: per-user-digest

Plan: [plan.md](plan.md) · Spec: [SPEC-per-user-digest.md](../../SPEC-per-user-digest.md)

Every task also meets the Definition of Done: lint and tests pass, nothing regresses, behavior is checked at runtime, and the docs are updated.

## Phase 1: Data

- [x] **Task 1: Schema and migration 0009** (S)
  - Acceptance: `digests.user_id` is not null, references `users` with delete cascade, and is indexed. The running-digest unique index is per user. `digest_label_versions` has a `(user_id, product_rxcui)` primary key. `0009` starts with the two `DELETE`s.
  - Verify: `npm run db:generate`; the integration setup applies it
  - Files: `src/server/db/schema/digest.ts`, `drizzle/0009_*`
  - Depends on: none

- [x] **Task 2: Scoped digest repository** (M)
  - Acceptance: `forUser(userId)` has `start`, `finish`, `fail`, `running`, `lastSuccessful`, `recent`, `unreadCount`, `markRead`, `seen`, `labelVersions` and `countClaudeCall`. The shared functions are `failInterrupted`, `claudeCallsToday` and `takeawayFor(pmid)`. The medications repository has `usersWithActiveMedications()`.
  - Verify: repository integration tests with two users: disjoint digests and seen, one running each, label versions per user, `takeawayFor` across users, cascade on user removal
  - Files: `src/server/digest/repository.ts` (+ int spec), `src/server/medications/repository.ts`
  - Depends on: 1

### Checkpoint A

- [x] Repository integration tests pass with two users; migration applied to a copy of the dev database

## Phase 2: Runs and routes

- [x] **Task 3: Runner per user** (M)
  - Acceptance:
    - `start(trigger, userId)` works from that user's list and window.
    - `runAll` goes through the users with active medications one at a time, and a failure doesn't stop the rest.
    - `startup` catches up per user.
    - `collectPapers` reuses stored takeaways and sends only the others to the model.
    - `listAllActive` is removed.
  - Verify: runner integration tests (stubbed upstreams) with Alice and Bob; collector unit tests for reuse
  - Files: `src/server/digest/{run,collect-papers,service}.ts`, `run.int.spec.ts`, `collect-papers.spec.ts`
  - Depends on: 2

- [x] **Task 4: Routes and wiring** (S)
  - Acceptance: `digestService(userId)` backs all four routes, with `409` per user and `404` for a foreign digest. The weekly task calls `runAll('schedule')`, and the plugin calls `startup()`.
  - Verify: `digest-api.int.spec.ts` as Alice and Bob
  - Files: `src/server/routes/api/digests/**`, `src/server/tasks/digest/weekly.ts`, `src/server/plugins/digest.ts`, `src/server/tests/digest-api.int.spec.ts`
  - Depends on: 3

### Checkpoint B

- [x] Full unit and integration suites pass; grep finds no `listAllActive`

## Phase 3: Verification

- [x] **Task 5: E2E, docs and coverage** (S)
  - Acceptance: an e2e test where two accounts each run a digest and see only their own drug's items. The README's What's new section describes per-person digests. Coverage on `src/server/digest` is 80% or above.
  - Verify: `npm run e2e`; `npm run test:coverage`
  - Files: `e2e/accounts.spec.ts` or `e2e/digest.spec.ts`, `README.md`
  - Depends on: 4

### Checkpoint C: per-user-digest complete

- [x] Spec success criteria 1–8
- [x] Human review (approved 2026-09-29). Still don't deploy until `per-user-hiding` is done.
