# Implementation Plan: accounts

Spec: [SPEC-accounts.md](../../SPEC-accounts.md) · Map: [CAPABILITY-MAP.md](../../CAPABILITY-MAP.md) (initiative multi-user) · Tasks: [todo.md](todo.md) · Previous: [foundation](../foundation/plan.md)

## Overview

This module replaces the single shared password with a `users` table: username and password login, the user's id and a version in the session, a check against the database on every `/api/*` request, and an admin CLI to add, reset, remove and list accounts. The `per-user-*` modules scope their data with `requireUser(event)`.

## Architecture Decisions

- **The session stays a sealed cookie.** It holds `{ userId, version }`. Revocation (a password reset, a removed account) works by comparing `version` with `users.session_version` on each request, so no sessions table is needed.
- **One module folder, `src/server/accounts/`:**
  - `username.ts` holds the pure rules;
  - `repository.ts` holds the SQL (create, find, reset, remove, list);
  - `service.ts` handles login verification (with a dummy hash for unknown users and the rate limits) and session resolution.
  - The routes, the middleware and the CLI all call the service, so the rules live in one place.
- **Keyed rate limiter.** `createRateLimiter` gains a keyed variant, `createKeyedRateLimiter`: per-username buckets plus one global bucket, all in memory.
- **The CLI calls the same repository.** `scripts/user.ts` is bundled by `build:scripts` into `dist/user.cjs` and shipped in the image. Its prompting code is taken from `hash-password.ts`, which is then deleted.
- **Tests that don't go through the middleware stay as they are.** The medications, literature and other route specs call handlers directly. They lose only their now-unused `APP_PASSWORD_HASH` line. `auth-api.spec.ts` moves to the integration project because login now needs the `users` table.
- **Signing out already clears the feature stores.** Every feature reducer resets on `logoutSuccess`, so only the auth slice changes on the client.

## Dependency Graph

```
1 users schema + migration ── 2 username + repository ── 3 keyed rate limiter ─┐
                                                                               ├─ 4 service + session + middleware + routes ── 5 CLI + Docker
                                                                               │
                                                        6 client auth slice + login page + shell ── 7 e2e ── 8 env/docs cleanup + coverage
```

## Task List

### Phase 1: Server

- [x] Task 1: `users` schema and migration
- [x] Task 2: Username rules and user repository
- [x] Task 3: Keyed login rate limiter
- [x] Task 4: Login service, session, middleware, `me`/`login`/`logout`, `requireUser`

### Checkpoint A

- [x] Unit and integration tests pass; the migration applies to a copy of the dev database
- [x] With curl: two users sign in at the same time; a stale version and a pre-upgrade cookie get `401`

### Phase 2: Admin CLI

- [x] Task 5: `scripts/user.ts` (add, reset-password, remove [--yes], list), `npm run user`, Dockerfile, startup "No accounts yet" log

### Checkpoint B

- [x] In dev and in `docker compose exec app`: add, list, reset (the old session gets `401`), remove --yes

### Phase 3: Client

- [x] Task 6: Auth slice with the user, API service, username field on the login page, username in the shell

### Checkpoint C

- [x] Browser: sign in as two users in two browsers, each sees their own name; at 375px and desktop

### Phase 4: Verification

- [x] Task 7: E2E: seeded user, updated `auth.spec.ts`, two-user spec
- [x] Task 8: Remove `APP_PASSWORD_HASH` everywhere; README, `.env.example`, foundation spec auth section; coverage

### Checkpoint D: accounts complete

- [x] Spec success criteria 1–10
- [x] Human review (approved 2026-09-29). Don't deploy until every multi-user module is done.

## Risks and Mitigations

| Risk                                                                 | Impact | Mitigation                                                                                           |
| -------------------------------------------------------------------- | ------ | ---------------------------------------------------------------------------------------------------- |
| Deploying before `per-user-medications`: every account sees one list | High   | Map and spec forbid it; Checkpoint D says so; release both together                                  |
| Lockout after upgrade (no accounts yet, old password gone)           | Med    | Startup log names the exact command; README upgrade steps create the first account before signing in |
| Username enumeration by timing                                       | Med    | Verify a fixed dummy hash for unknown users; integration test compares durations loosely             |
| One extra DB query per API request                                   | Low    | Primary-key lookup; a home server with a handful of users                                            |
| In-memory limits reset on restart                                    | Low    | Same trade-off as today; LAN only                                                                    |

## Open Questions

- None blocking.
