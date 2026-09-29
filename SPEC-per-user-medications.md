# Spec: per-user-medications

Module of [CAPABILITY-MAP.md](CAPABILITY-MAP.md), initiative **multi-user**. Depends on: `accounts`, `medications`. Status: **done, approved 2026-09-29**.

## Objective

Give each account its own medication list. Every medication belongs to exactly one user, and every place in the app that reads "my medications" reads only the signed-in user's rows. This covers the medication list, the dashboard, drug pages, prices and costs, the alternatives' "taken for", and the interaction checks. Existing medications are cleared, since the owner chose to start fresh.

**User story:** "Alice adds lisinopril; Bob signs in on his phone and his list is empty. Bob adds lisinopril too, and neither sees the other's notes, copay or stop date."

Success means that no API response built from medications ever includes another user's rows, and that one user can't read, change or delete another user's medication by guessing its id. It gets `404` instead.

Out of scope: per-user digests (`per-user-digest`), per-user hidden papers and alternatives (`per-user-hiding`), and any sharing of a list between accounts.

## Tech Stack

Unchanged. There are no new dependencies. Drizzle migration `0008`, scoped repositories, and `requireUser(event)` from [SPEC-accounts.md](SPEC-accounts.md).

## Commands

```
Unit tests:     npm test
Integration:    npm run db:test:up && npm run test:int
E2E:            npm run e2e
Lint / format:  npm run lint && npm run format:check
Migration:      npm run db:generate      # then add the DELETE line described below, before it is ever applied
```

## Project Structure

```
src/server/db/schema/medications.ts      → user_id column, FK to users (on delete cascade), per-user unique index
drizzle/0008_medications_per_user.sql    → generated; starts by deleting existing rows (see Data)
src/server/medications/repository.ts     → createMedicationsRepository(db).forUser(userId) + listAllActive() for the digest runner
src/server/medications/service.ts        → medicationsService(userId)
src/server/routes/api/medications/*.ts   → pass requireUser(event).id
src/server/drug-info/facts.ts            → product lookup through productByRxcui (no user data)
src/server/pricing/service.ts            → prices(rxcui, userId), costs(userId)
src/server/alternatives/service.ts       → the saved medication's "taken for" read for userId
src/server/interactions/service.ts       → current(userId), check(rxcui, userId), evidence(query, userId)
src/server/digest/service.ts             → hasActiveMedications for userId
src/server/digest/run.ts                 → listAllActive() (unchanged behavior until per-user-digest)
src/server/routes/api/**                 → each of the routes above passes requireUser(event).id
src/server/tests/*.int.spec.ts           → a seeded user; isolation cases with a second user
e2e/medications.spec.ts, e2e/accounts.spec.ts → two users with separate lists
```

## Behavior

**Data**

- `medications.user_id uuid not null references users(id) on delete cascade`, with an index on `user_id`.
- The unique index `medications_active_rxcui_idx` becomes `(user_id, rxcui) where stopped_on is null`. Alice and Bob can both have lisinopril 10 mg active, but neither can have it twice.
- **Migration `0008` starts fresh.** It runs `DELETE FROM medications;`, then adds the column. That line is added to the generated file before the migration is applied anywhere. Adding a `NOT NULL` column fails on existing rows, and the owner chose to start fresh. Shared caches keyed by drug stay as they are: summaries, papers, trials, alternatives lists, prices and the interaction database.
- **The digest tables are left as they are here.** Their items don't reference `medications`. `per-user-digest` handles them.

**Repository**

- `createMedicationsRepository(db).forUser(userId)` returns the current API: `list`, `get`, `create`, `update` and `remove`. Every query in it is filtered by `user_id`, and `create` sets it. Nothing in the request path can reach an unscoped read.
- `productByRxcui(rxcui)` returns the RxNorm columns of any saved row with that RXCUI (name, strength, form, ingredients), never notes, dates, copays or the owner. Drug facts use it to skip an RxNav call.
- `listAllActive()` returns every user's active medications. It exists only for the weekly digest runner until `per-user-digest` replaces it, and it's named so a reviewer can see that.

**Routes and services** (each gets the user from `requireUser(event)`):

| Route                                                            | Scoped to the user                                                                                                                                               |
| ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET/POST /api/medications`, `PATCH/DELETE /api/medications/:id` | list, add, edit, delete; another user's id → `404 Medication not found.`                                                                                         |
| `GET /api/drugs/:rxcui`                                          | nothing user-specific: drug facts are shared. A saved product's RxNorm data is reused to skip RxNav through `productByRxcui`, which returns product columns only |
| `GET /api/drugs/:rxcui/prices`, `GET /api/costs`                 | the user's units, copay and active medications                                                                                                                   |
| `GET /api/drugs/:rxcui/alternatives`                             | "taken for" from the user's saved medication; the alternatives list stays shared                                                                                 |
| `GET /api/interactions/current`, `/check`, `/evidence`           | the user's active medications only                                                                                                                               |
| `GET /api/digests`                                               | `hasActiveMedications` for the user; the digests themselves are unchanged until `per-user-digest`                                                                |

- **Duplicates:** adding a product that's already on your active list still gives `409` with the same message. The same product on someone else's list is not a duplicate.
- **Removing an account** deletes its medications through the cascade. `remove` in the CLI already says "and their data".

**Client**

- No behavior changes. The medications store already resets on `logoutSuccess`, so the next account starts with an empty store and loads its own list.

## Code Style

This follows [SPEC-foundation.md](SPEC-foundation.md). Routes stay thin: they read the user and pass the id down.

```ts
// src/server/routes/api/medications/index.get.ts
export default defineEventHandler((event) => medicationsService(requireUser(event).id).list());
```

```ts
// src/server/medications/repository.ts (shape)
export function createMedicationsRepository(db: Db) {
  return {
    forUser(userId: string) {
      const mine = eq(medications.userId, userId);
      return {
        list: () => db.select().from(medications).where(mine).orderBy(/* as today */),
        get: async (id: string) =>
          (
            await db
              .select()
              .from(medications)
              .where(and(mine, eq(medications.id, id)))
          )[0] ?? null,
        // create sets userId; update/remove filter by (userId, id) …
      };
    },
    /** Every user's active medications: the weekly digest runner only, until per-user-digest. */
    listAllActive: () => db.select().from(medications).where(isNull(medications.stoppedOn)),
  };
}
```

## Testing Strategy

- **Integration (repository, `rxplus_test`):**
  - the lists of two users are disjoint
  - `get`, `update` and `remove` with another user's id return null or false and change nothing
  - the same product can be active for both users; a duplicate for one user throws
  - removing a user cascades to their medications
  - `listAllActive` returns both users' active rows
- **Integration (routes):** every route in the table above, called as Alice and as Bob:
  - responses contain only the caller's rows
  - `PATCH` and `DELETE` on another user's id return `404`
  - `/api/costs` totals only the caller's medications
  - `/api/interactions/current` pairs only the caller's medications
- **Migration:** applied to a copy of the dev database, it leaves `medications` empty with `user_id` present, and every other table's row count is unchanged.
- **Unit:** the service and route tests that use stub repositories are updated to the new signatures. No behavior changes for a single user.
- **E2E:** one new spec. Account A adds a medication. Account B, in a second context, sees an empty list and an empty dashboard, then adds the same product without a duplicate error. A still sees only their own.
- **Coverage:** `src/server/medications` stays at 80% or above.

## Boundaries

- **Always:**
  - scope every medications query in the request path with `forUser(requireUser(event).id)`
  - answer another user's id with `404`, never `403`, so ids don't reveal that a row exists
  - run lint, unit, integration and e2e before calling a task done
- **Ask first:**
  - any other use of `listAllActive` besides the digest runner
  - sharing a list between accounts
  - keeping or migrating the existing medications instead of clearing them
- **Never:**
  - return or log another user's medications, notes or copays
  - apply migration `0008` to the real database before the owner has a backup (the Update steps in the README take one first)
  - deploy before `per-user-digest` and `per-user-hiding` are done too

## Success Criteria

1. After the upgrade, the medication list is empty for every account, and all other stored data (summaries, research, alternatives, digests, the interaction data) is still there.
2. Alice adds lisinopril 10 mg. Bob's Medications page, dashboard, Costs page and Interactions page show none of Alice's medications.
3. Bob adds the same product with his own notes and copay without a duplicate error. Each sees only their own notes, copay and totals.
4. `PATCH` or `DELETE /api/medications/<Alice's id>` as Bob returns `404`, and Alice's row is unchanged.
5. The interaction check for a new drug, as Bob, compares it only against Bob's active medications.
6. A drug page opened by Bob shows his own figures only. Its Prices section reads Bob's medications (the scoped `/api/medications`) and `/api/drugs/:rxcui/prices`, and "taken for" comes from the scoped alternatives route. The drug facts route returns no user data.
7. `remove alice --yes` deletes her medications, and Bob's are untouched.
8. Lint, unit, integration and e2e tests pass; coverage on `src/server/medications` is 80% or above.

## Resolved Decisions (2026-09-29)

1. **`per-user-interactions` is folded into this module**: the interaction routes are scoped here, and the map no longer lists it.
2. **Deploy only after all four modules** (`accounts`, `per-user-medications`, `per-user-digest`, `per-user-hiding`) are done. The digest runner's `listAllActive()` is acceptable meanwhile because nothing is deployed.

## Open Questions

None.
