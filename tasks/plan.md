# Implementation Plan: medications

Spec: [SPEC-medications.md](../SPEC-medications.md) · Map: [CAPABILITY-MAP.md](../CAPABILITY-MAP.md) · Tasks: [todo.md](todo.md) · Previous: [foundation](foundation/plan.md)

## Overview

Let the owner add, list, stop, restart and delete prescriptions, each resolved to an RxNorm product (SCD/SBD) through a server-side RxNav proxy, stored in Postgres (first real Drizzle migration), managed in an `@ngrx/entity` store, and rendered with SSR on `/medications`.

## Architecture Decisions

- **One RxNav client on the server** (`src/server/rxnorm/client.ts`) owns base URL, 5-second timeout, one retry on network errors, TTL cache and response mapping. Routes and the repository never call `fetch` directly. It's an injectable `fetch` so tests use recorded fixtures.
- **Save means re-verify:** `POST /api/medications` takes only `rxcui`. The server fetches the concept's properties, ingredients, dose form, brand and strength from RxNav and stores that snapshot. The client can't forge drug data.
- **Unique active product** is enforced in the database (partial unique index on `rxcui` where `stopped_on is null`) and mapped to 409, not just checked in code.
- **SSR list without flash:** the page dispatches `load` on init; the SSR render waits for the HTTP call (cookie forwarded by `forwardCookieInterceptor`). Angular's HTTP transfer cache (enabled by `provideClientHydration`) should hand the response to the browser, so the list doesn't refetch or flash. Verified in Task 6; if the URLs differ between server and client, fall back to Analog's page `load` (`.server.ts`).
- **Stub RxNav for e2e:** Playwright starts a tiny fixture server and points `RXNAV_BASE_URL` at it, so e2e never depends on NLM.

## Dependency Graph

```
1 RxNav client ── 2 RxNorm proxy routes ──────────────┐
3 Schema + migration + repository ── 4 Medications API ┤
                                                        ├─ 5 NgRx store ── 6 List page (SSR) ── 7 Add dialog ── 8 Edit/stop/delete
                                                        │                                                           │
                                                        └─────────────────────────── 9 E2E (stub RxNav) ────────────┘
                                                                                     10 Docker migration + coverage + docs
```

## Task List

### Phase 1: Server

- [x] Task 1: RxNav client with timeout, retry, cache and fixtures
- [x] Task 2: RxNorm search and products proxy routes
- [x] Task 3: Medications schema, first migration and repository
- [x] Task 4: Medications API (list, create with re-verify, update, delete)

### Checkpoint A

- [x] Unit + integration tests pass; `npm run db:migrate` applies `0000_*`
- [x] curl: search `lisin`, list products, add, 409 on duplicate, stop, delete

### Phase 2: Client

- [x] Task 5: NgRx medications feature (`@ngrx/entity`) and API service
- [x] Task 6: `/medications` list page with SSR, stopped section and empty state
- [x] Task 7: Add-medication dialog (autocomplete, product pick, notes/date)
- [ ] Task 8: Edit notes/start date, stop, restart, delete with confirmation

### Checkpoint B

- [ ] Manual in browser: full add/stop/restart/delete flow at 375px and 1280px, light and dark; no hydration warnings; RxNav-down message

### Phase 3: Verification

- [ ] Task 9: E2E against a stub RxNav
- [ ] Task 10: Migration in Docker, coverage targets, docs

### Checkpoint C: medications complete

- [ ] Spec success criteria 1–8 verified
- [ ] Human review, then `SPEC-interactions.md` (needs the interaction data-source decision)

## Risks and Mitigations

| Risk                                                                           | Impact | Mitigation                                                                                  |
| ------------------------------------------------------------------------------ | ------ | ------------------------------------------------------------------------------------------- |
| RxNav slow or down                                                             | Med    | Timeout + retry + cache; 503 with a friendly message; list/edit never depend on RxNav       |
| RxNav response shape surprises (missing groups, multi-ingredient strength)     | Med    | Map defensively from recorded fixtures of several drug types (single, combination, branded) |
| SSR transfer cache misses (server/client URL mismatch) → flash or double fetch | Med    | Check in Task 6; fallback to Analog server `load`                                           |
| Partial unique index not expressible in Drizzle                                | Low    | Drizzle supports `uniqueIndex().on().where(sql…)`; otherwise a hand-written migration       |
| Dev DB not running for integration tests                                       | Low    | `npm run db:test:up` in the task steps                                                      |

## Open Questions

None. All spec questions resolved on 2026-09-27.
