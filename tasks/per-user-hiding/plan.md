# Implementation Plan: per-user-hiding

Spec: [SPEC-per-user-hiding.md](../../SPEC-per-user-hiding.md) · Map: [CAPABILITY-MAP.md](../../CAPABILITY-MAP.md) (initiative multi-user) · Tasks: [todo.md](todo.md) · Previous: [per-user-digest](../per-user-digest/plan.md)

## Overview

This module moves paper hides into a per-user `literature_hidden` table and adds `user_id` to `alternative_hidden`. The literature and alternatives services then take the signed-in user. It ends with a release rehearsal of the whole multi-user upgrade on a copy of the real database.

## Architecture Decisions

- **Paper hides get their own table.** The shared paper rows keep their takeaways; each user's shown set is "candidates minus my hides", run through the same `selectShown`.
- **Services take the user per call.** `literatureService(userId)` and the existing `alternativesService(userId)` scope the view, refresh, takeaways and hide calls.
- **Migration 0010:** generated. A `DELETE FROM "alternative_hidden";` goes first so the not-null column can be added. No hidden papers are copied: there are none.

## Dependency Graph

```
1 schema + migration ── 2 repositories ── 3 services + routes ── 4 e2e, docs, coverage ── 5 release rehearsal
```

## Task List

### Phase 1: Data

- [x] Task 1: `literature_hidden`, `alternative_hidden.user_id`, migration 0010
- [x] Task 2: Literature and alternatives repositories take the user

### Checkpoint A

- [x] Repository integration tests pass with two users

### Phase 2: Routes

- [x] Task 3: `literatureService(userId)`, the alternatives hide calls, routes; route tests as Alice and Bob

### Checkpoint B

- [x] Full unit and integration suites pass

### Phase 3: Verification

- [x] Task 4: E2E hide as one account, still shown to the other; docs; coverage
- [x] Task 5: Release rehearsal on a copy of the real database with the built image

### Checkpoint C: per-user-hiding and the multi-user initiative complete

- [x] Spec success criteria 1–7
- [x] Human review (approved 2026-09-29); then the README upgrade checklist can be followed

## Risks and Mitigations

| Risk                                                | Impact | Mitigation                                                                       |
| --------------------------------------------------- | ------ | -------------------------------------------------------------------------------- |
| A hide read without the user shows or hides for all | High   | The repositories require `userId`; two-user repository and route tests           |
| The rehearsal touches the live stack                | High   | A separately tagged image on the test database container; the live one untouched |

## Open Questions

- None blocking.
