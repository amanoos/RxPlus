# Spec: per-user-digest

Module of [CAPABILITY-MAP.md](CAPABILITY-MAP.md), initiative **multi-user**. Depends on: `per-user-medications`, `digest`. Status: **done, approved 2026-09-29**.

## Objective

Give each account its own weekly **What's new** digest, built only from that person's active medications, so no one learns from the digest which drugs someone else takes. Everything about the digest that is really about a person becomes per user: the digests, the unread count, "already reported", the label versions last seen, the catch-up after downtime, and "Run now". What's about the drug stays shared: papers, trials, approvals, labels, and the takeaway written for a paper.

**User story:** "Alice takes lisinopril, Bob takes metformin. On Monday each opens What's new and sees news about their own drug only. Bob's unread badge doesn't count Alice's items, and Alice pressing Run now doesn't touch Bob's digest."

Success means that no digest, item, count or run status of one user is ever visible to or changed by another, and that the unscoped `listAllActive()` from `per-user-medications` is gone.

Out of scope: per-user hidden papers and alternatives (`per-user-hiding`), a digest shared by a household, and email or push delivery.

## Tech Stack

Unchanged. There are no new dependencies. Drizzle migration `0009`, the scoped medications repository (`forUser`) and `requireUser(event)`.

## Commands

```
Unit tests:     npm test
Integration:    npm run db:test:up && npm run test:int
E2E:            npm run e2e
Lint / format:  npm run lint && npm run format:check
Migration:      npm run db:generate      # then add the DELETE lines described below, before it is ever applied
```

## Project Structure

```
src/server/db/schema/digest.ts           → digests.user_id; digest_label_versions keyed by (user_id, product_rxcui)
drizzle/0009_digest_per_user.sql         → generated; starts by clearing digests and label versions (see Data)
src/server/digest/repository.ts          → createDigestRepository(db).forUser(userId) + shared helpers (takeaway reuse, Claude count)
src/server/digest/run.ts                 → runs for one user; runAll() and startup() loop over users one at a time
src/server/digest/service.ts             → digestService(userId); the runner reads each user's list with forUser
src/server/digest/collect-papers.ts      → reuses a stored takeaway for a PMID before asking a model
src/server/tasks/digest/weekly.ts        → runAll('schedule')
src/server/plugins/digest.ts             → startup() per user
src/server/medications/repository.ts     → listAllActive() removed
src/server/tests/digest-api.int.spec.ts  → two users
src/server/digest/*.int.spec.ts          → two users
e2e/digest.spec.ts, e2e/accounts.spec.ts → each account sees only its own digest
```

## Behavior

**Data**

- `digests.user_id uuid not null references users(id) on delete cascade`, indexed. Items already cascade from their digest.
- "One run at a time" becomes **one running digest per user**: a unique index on `user_id where status = 'running'`.
- `digest_label_versions` gains `user_id`, with the primary key `(user_id, product_rxcui)`. Each user's first check of a product is their own baseline, so one user's run can't hide a label change from another.
- **Migration `0009` starts fresh.** It runs `DELETE FROM "digest_label_versions";` and `DELETE FROM "digests";` (items cascade), then changes the columns. Those lines are added to the generated file before it's applied anywhere. The existing digests belong to nobody, and the owner chose to start fresh.

**Repository**

- `createDigestRepository(db).forUser(userId)` has `start`, `finish`, `fail`, `running`, `lastSuccessful`, `recent`, `unreadCount`, `markRead`, `seen` and `labelVersions`. Every query filters by `user_id`, and inserts set it.
- `seen(kind, ids)` means "already reported **to this user**". Alice's digest reporting a PMID doesn't stop Bob's.
- The shared parts stay unscoped:
  - `failInterrupted()` at startup;
  - `claudeCallsToday()`, since the Claude cap (`AI_DAILY_LIMIT`) stays server-wide;
  - `takeawayFor(pmid)`: the newest stored takeaway with text for that paper in anyone's digest. It's about the paper, not the person, so it's shared like the literature pages. It returns only the takeaway.

**Runs**

- `runner.start(trigger, userId)` builds one user's digest from `medications.forUser(userId).list()`, over that user's window: from their last successful digest, or the past week for their first. It returns `null` when that user already has one running.
- `runner.runAll(trigger)` is used by the weekly task. It runs every user with at least one active medication, **one after another**, so PubMed, ClinicalTrials.gov and openFDA see the same pacing as today, multiplied by the number of people rather than overlapping. A user whose run fails gets a failed digest; the others still run.
- `runner.startup()` marks interrupted runs as failed (for all users), then catches up each user whose last successful digest is more than a week old, one at a time.
- **Takeaways:** before asking a model about a paper, `collectPapers` reuses `takeawayFor(pmid)`. Only papers with no stored takeaway go to the model, and only those count toward the Claude cap. The second person to take a drug doesn't pay for the same takeaways again.
- `listAllActive()` is removed from the medications repository, and nothing reads every user's list any more.

**Routes** (each reads `requireUser(event)`):

| Route                           | Scoped to the user                                                                    |
| ------------------------------- | ------------------------------------------------------------------------------------- |
| `GET /api/digests`              | the user's digests, their running digest, `hasActiveMedications`; `nextRun` is shared |
| `GET /api/digests/unread-count` | unread items in the user's digests                                                    |
| `POST /api/digests/run`         | starts the user's run; `409` only when **their** run is already going                 |
| `POST /api/digests/:id/read`    | marks the user's digest read; another user's id → `404`                               |

**Client**

- No behavior changes. The digest store already resets on `logoutSuccess`. The unread badge and polling read the scoped routes.

## Code Style

This follows [SPEC-foundation.md](SPEC-foundation.md) and the scoped repository in [SPEC-per-user-medications.md](SPEC-per-user-medications.md).

```ts
// src/server/digest/run.ts (shape)
async function runAll(trigger: Digest['trigger']): Promise<void> {
  // One user at a time: upstream APIs see today's pacing, not N runs at once.
  for (const userId of await deps.usersWithActiveMedications()) {
    const digest = await start(trigger, userId);
    if (digest) await settle(digest.id);
  }
}
```

## Testing Strategy

- **Integration (repository):**
  - two users' digests, items, unread counts and `seen` are disjoint
  - one running digest per user, so two users can run at the same time
  - label versions are kept per user
  - `takeawayFor` returns another user's stored takeaway for the same PMID, and nothing else of that digest
  - removing a user cascades their digests
  - migration `0009` applied to a copy of the dev database leaves `digests` and `digest_label_versions` empty with the new columns, and every other table's row count unchanged
- **Integration (runner, stubbed upstreams):**
  - Alice's run reports only her drugs, and Bob's only his
  - a PMID already reported to Alice is still reported to Bob
  - Bob's takeaway for a paper Alice already has is reused, with no model call and no Claude count
  - `runAll` runs users one after another and skips users with no active medications
  - one user's failure doesn't stop the next
  - `startup` catches up each user separately
- **Integration (routes):** each digest route called as Alice and as Bob. Run-now `409` is per user, and `read` on a foreign id returns `404`.
- **Unit:** existing collector and service tests are updated to the new signatures.
- **E2E:** two accounts each press **Run now** and see only items about their own medication. The unread badge counts only their own items.
- **Coverage:** `src/server/digest` stays at 80% or above.

## Boundaries

- **Always:**
  - scope every digest query in the request path with `forUser(requireUser(event).id)`
  - answer another user's digest id with `404`
  - keep runs sequential across users
- **Ask first:**
  - running users in parallel
  - sharing anything more than the takeaway text across users
  - changing the Claude cap to per user
  - keeping the existing digests instead of clearing them
- **Never:**
  - include another user's drug, digest item or unread count in a response or a log line
  - let one user's Run now start or block another user's run
  - apply migration `0009` to the real database before a backup
  - deploy before `per-user-hiding` is done too

## Success Criteria

1. After the upgrade, the digest list is empty for every account, and papers, trials, alternatives, summaries and the interaction data are unchanged.
2. With Alice on lisinopril and Bob on metformin, each account's Run now produces a digest with items about their own drug only.
3. Bob's unread badge and digest list never include Alice's items. Marking Alice's digest read as Bob returns `404`.
4. Alice and Bob can each have a run going at the same time. A second Run now by the same user returns `409`.
5. A paper reported to Alice is still reported to Bob the first time his digest finds it, with Alice's stored takeaway and no new model call.
6. The weekly task produces one digest per user with active medications, run one after another. A failure for one user leaves the others' digests ready.
7. After downtime longer than a week, startup catches up each user.
8. `listAllActive` no longer exists. Lint, unit, integration and e2e pass, and coverage on `src/server/digest` is 80% or above.

## Resolved Decisions (2026-09-29)

1. **Accounts with no active medications are skipped** by the weekly task and the startup catch-up. Run now still works for them.
2. **Takeaways are reused across accounts** for the same paper (`takeawayFor(pmid)`): the text is about the paper and reveals nothing about who else takes the drug.

## Open Questions

None.
