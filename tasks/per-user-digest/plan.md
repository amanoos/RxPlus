# Implementation Plan: per-user-digest

Spec: [SPEC-per-user-digest.md](../../SPEC-per-user-digest.md) · Map: [CAPABILITY-MAP.md](../../CAPABILITY-MAP.md) (initiative multi-user) · Tasks: [todo.md](todo.md) · Previous: [per-user-medications](../per-user-medications/plan.md)

## Overview

This module makes the What's new digest per account: digests, items, unread counts, "already reported", label baselines, catch-up and Run now, all keyed by user. Runs go one user at a time. Paper takeaways are reused across users. The unscoped `listAllActive()` is removed.

## Architecture Decisions

- **Scoped repository, like medications.** `createDigestRepository(db).forUser(userId)` covers everything about one person. The top-level functions are the shared ones: `failInterrupted`, `claudeCallsToday`, `takeawayFor(pmid)`, and `usersWithActiveMedications` (on the medications repository).
- **The runner takes the user per run.** `start(trigger, userId)` does one run. `runAll(trigger)` and `startup()` loop over users and await each run before the next, using the existing background job set.
- **Takeaway reuse lives in the collector.** `collectPapers` gets a `storedTakeaway(pmid)` dependency. Papers with a stored takeaway skip the model, and only the rest go to `writeTakeaways`.
- **Migration 0009:** generated, with the two `DELETE`s added at the top before it's ever applied.

## Dependency Graph

```
1 schema + migration ── 2 scoped repository ── 3 runner per user (+ takeaway reuse, runAll, startup) ── 4 routes + wiring ── 5 e2e, migration on dev copy, docs, coverage
```

## Task List

### Phase 1: Data

- [x] Task 1: `user_id` on digests and label versions; one running digest per user; migration 0009 (starts fresh)
- [x] Task 2: `forUser(userId)` digest repository; shared `takeawayFor`, `claudeCallsToday`, `failInterrupted`; `usersWithActiveMedications`

### Checkpoint A

- [x] Repository integration tests pass with two users; migration applied to a copy of the dev database

### Phase 2: Runs and routes

- [x] Task 3: Runner per user, `runAll`, `startup` per user, takeaway reuse; `listAllActive` removed
- [x] Task 4: Digest routes, weekly task and startup plugin wired; route integration tests as Alice and Bob

### Checkpoint B

- [x] Full unit and integration suites pass; grep finds no `listAllActive`

### Phase 3: Verification

- [x] Task 5: E2E with two accounts' digests; docs; coverage

### Checkpoint C: per-user-digest complete

- [x] Spec success criteria 1–8
- [x] Human review (approved 2026-09-29). Still don't deploy until `per-user-hiding` is done.

## Risks and Mitigations

| Risk                                                           | Impact | Mitigation                                                                          |
| -------------------------------------------------------------- | ------ | ----------------------------------------------------------------------------------- |
| A digest query left unscoped shows one user's drugs to another | High   | Only `forUser` reads digests in the request path; two-user route and runner tests   |
| Sequential runs take longer with more users                    | Low    | A household is a few people; each run is minutes at most and runs in the background |
| A reused takeaway was flagged (uncited, reader-directed)       | Low    | Reuse the stored object as-is, flags included, so the page shows the same warnings  |

## Open Questions

- None blocking.
