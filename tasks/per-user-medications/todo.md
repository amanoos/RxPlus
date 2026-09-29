# Tasks: per-user-medications

Plan: [plan.md](plan.md) · Spec: [SPEC-per-user-medications.md](../../SPEC-per-user-medications.md)

Every task also meets the Definition of Done: lint and tests pass, nothing regresses, behavior is checked at runtime, and the docs are updated.

## Phase 1: Data

- [x] **Task 1: Schema and migration 0008** (S)
  - Acceptance: `medications.user_id` is not null, references `users` with delete cascade, and is indexed. The unique index is `(user_id, rxcui) where stopped_on is null`. `0008` starts with `DELETE FROM "medications";`.
  - Verify: `npm run db:generate`; the integration setup applies it
  - Files: `src/server/db/schema/medications.ts`, `drizzle/0008_*`
  - Depends on: none

- [x] **Task 2: Scoped repository** (S)
  - Acceptance: `forUser(userId)` has `list`, `get`, `create`, `update` and `remove`, all filtered by `user_id`, and `create` sets it. `listAllActive()` returns every user's active rows. Two users can each have the same product active; one user can't have it twice.
  - Verify: repository integration tests with two users, including the cascade on user removal
  - Files: `src/server/medications/repository.ts`, `repository.int.spec.ts`
  - Depends on: 1

### Checkpoint A

- [x] Repository integration tests pass with two users; the migration applies to a copy of the dev database, leaving medications empty and other tables unchanged

## Phase 2: Routes

- [x] **Task 3: Test helper and medication routes** (M)
  - Acceptance: `tests/test-users.ts` seeds users and sets `event.context.user` from `x-test-user`. `medicationsService(userId)` is used by all four medication routes. Another user's id gets `404`.
  - Verify: `medications-api.int.spec.ts` covers two users: separate lists, `404` on a foreign id, and the same product active for both
  - Files: `src/server/tests/test-users.ts`, `src/server/medications/service.ts`, `src/server/routes/api/medications/*.ts`, `src/server/tests/medications-api.int.spec.ts`
  - Depends on: 2

- [x] **Task 4: Other readers** (M)
  - Acceptance: prices and costs, the alternatives' "taken for", the interactions `current`, `check` and `evidence`, and the digest list's `hasActiveMedications` all read only the user's rows. Drug facts use `productByRxcui`, which returns product columns only. The runner uses `listAllActive()`.
  - Verify: each route's integration spec runs as Alice and Bob; the unit specs are updated for the new signatures
  - Files: `src/server/{drug-info/facts,pricing/service,alternatives/service,interactions/service,digest/service,digest/run}.ts`, their routes, `src/server/tests/*-api.int.spec.ts`
  - Depends on: 3

### Checkpoint B

- [x] Every route in the spec's table is tested as Alice and as Bob; the full unit and integration suites pass

## Phase 3: Verification

- [x] **Task 5: E2E, docs and coverage** (S)
  - Acceptance: an e2e test where one account adds a medication and the other sees an empty list and can add the same product. The README describes per-person lists. Coverage on `src/server/medications` is 80% or above.
  - Verify: `npm run e2e`; `npm run test:coverage`
  - Files: `e2e/accounts.spec.ts`, `e2e/helpers.ts`, `README.md`
  - Depends on: 4

### Checkpoint C: per-user-medications complete

- [x] Spec success criteria 1–8
- [x] Human review (approved 2026-09-29). Still don't deploy until `per-user-digest` and `per-user-hiding` are done.
