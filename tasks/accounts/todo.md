# Tasks: accounts

Plan: [plan.md](plan.md) · Spec: [SPEC-accounts.md](../../SPEC-accounts.md)

Every task also meets the Definition of Done: lint and tests pass, nothing regresses, behavior is checked at runtime, and the docs are updated.

## Phase 1: Server

- [x] **Task 1: `users` schema and migration** (S)
  - Acceptance: the `users` table has `id`, `username` (unique), `password_hash`, `session_version` (default 1), `created_at` and `updated_at`. It's exported from the schema index. The migration is generated and committed.
  - Verify: `npm run db:generate`; the migration applies in the integration setup (`runMigrations`)
  - Files: `src/server/db/schema/users.ts`, `src/server/db/schema/index.ts`, `drizzle/0007_*`
  - Depends on: none

- [x] **Task 2: Username rules and user repository** (S)
  - Acceptance: `normalizeUsername` (trims, lowercases, 3–32 characters of `a–z 0–9 . _ -`, starts with a letter or digit). The repository has `create` (throws a typed error when the name exists), `findByUsername`, `findById`, `resetPassword` (new hash, `session_version + 1`), `remove`, and `list` (usernames and creation dates only).
  - Verify: unit tests for `normalizeUsername`; integration tests for the repository against `rxplus_test`
  - Files: `src/server/accounts/{username,repository}.ts` (+ specs)
  - Depends on: 1

- [x] **Task 3: Keyed login rate limiter** (S)
  - Acceptance: `createKeyedRateLimiter({ max, windowMs, globalMax })`. It blocks a key after 5 failures in 15 minutes, blocks everyone after 20 failures in total, and on success resets only that key. It replaces the single `loginLimiter`.
  - Verify: unit tests with an injected clock
  - Files: `src/server/utils/rate-limit.ts` (+ spec)
  - Depends on: none

- [x] **Task 4: Login service, session, middleware and routes** (M)
  - Acceptance:
    - `verifyLogin` returns the user. Unknown users are checked against a dummy hash. It returns `401` "Invalid username or password." and `429` from the limiter.
    - `AuthSession` is `{ userId, version }`.
    - The middleware resolves the user and sets `event.context.user`. It returns `401` when the user is missing, the version is stale, or there's no `userId`.
    - `requireUser(event)` returns the user or throws.
    - `login` takes `{ username, password }`, `me` returns `{ authenticated, user }`, and `logout` clears only this session.
  - Verify: `auth-api.spec.ts` moves to `auth-api.int.spec.ts` (integration project) and covers spec criteria 3–8 at the API level
  - Files: `src/server/accounts/service.ts` (+ spec), `src/server/utils/{session,auth-user}.ts`, `src/server/middleware/auth.ts`, `src/server/routes/api/auth/{login.post,me.get}.ts`, `src/server/tests/auth-api.int.spec.ts`
  - Depends on: 2, 3

### Checkpoint A

- [x] Unit and integration tests pass; the migration applies to a copy of the dev database
- [x] With curl: two users sign in at the same time; a stale version and a pre-upgrade cookie get `401`

## Phase 2: Admin CLI

- [x] **Task 5: Admin CLI and Docker** (M)
  - Acceptance:
    - `add` prompts twice without echoing, or reads one line from a pipe, and requires 12 or more characters.
    - `reset-password` works the same way and increments the version.
    - `remove` asks for the username to be typed, or skips the prompt with `--yes`.
    - `list` prints usernames and dates.
    - Errors exit non-zero with readable messages. Passwords and hashes are never printed.
    - `npm run user -- …` works in dev. `build:scripts` bundles `dist/user.cjs`, and the Dockerfile copies it.
    - With no accounts, the server logs one "No accounts yet" line at startup.
    - `scripts/hash-password.ts` and its npm script are removed.
  - Verify: unit tests for argument parsing; manual run in dev and in `docker compose exec app`
  - Files: `scripts/user.ts`, `scripts/hash-password.ts` (deleted), `package.json`, `Dockerfile`, `src/server/plugins/accounts.ts`
  - Depends on: 4

### Checkpoint B

- [x] In dev and in `docker compose exec app`: add, list, reset (the old session gets `401`), remove --yes

## Phase 3: Client

- [x] **Task 6: Auth slice, login page and shell** (M)
  - Acceptance:
    - The API service posts `{ username, password }` and maps `me` to the user.
    - The `auth` state has `user`; `loginSuccess` and `sessionChecked` set it and `logoutSuccess` clears it.
    - The login page has Username and Password fields (with autocomplete attributes), and both are required.
    - The shell shows the username next to Logout, and in the drawer on narrow screens.
  - Verify: reducer, effect, API service, login page and shell component tests; browser check
  - Files: `src/app/core/auth/{auth-api.service,auth.actions,auth.reducer,auth.selectors,auth.effects}.ts` (+ specs), `src/app/pages/login.page.ts` (+ spec), shell component
  - Depends on: 4

### Checkpoint C

- [x] Browser: sign in as two users in two browsers, each sees their own name; at 375px and desktop

## Phase 4: Verification

- [x] **Task 7: E2E** (S)
  - Acceptance: `global-setup` seeds one user through the repository. `helpers.ts` signs in with a username. `auth.spec.ts` is updated. A new two-user spec uses two contexts, each signed in and each showing its own name.
  - Verify: `npm run e2e` passes 3 times in a row
  - Files: `e2e/{global-setup,helpers,auth.spec,accounts.spec}.ts`, `playwright.config.ts`
  - Depends on: 5, 6

- [x] **Task 8: Remove `APP_PASSWORD_HASH`; docs; coverage** (S)
  - Acceptance:
    - `APP_PASSWORD_HASH` is out of `env.ts` (a leftover value is ignored and logged once), `.env.example`, the README, `playwright.config.ts` and the integration specs.
    - The README covers creating the first account, upgrade steps and the CLI.
    - The auth section of `SPEC-foundation.md` points to `SPEC-accounts.md`.
    - Coverage is 80% or more on `src/server/accounts`, `session.ts`, `rate-limit.ts` and the auth store.
  - Verify: `npm run test:coverage`; production build; `grep -r APP_PASSWORD_HASH` finds only the ignore notice
  - Files: `src/server/utils/env.ts` (+ spec), `.env.example`, `README.md`, `SPEC-foundation.md`, `src/server/tests/*.int.spec.ts`, `vite.config.ts`
  - Depends on: 7

### Checkpoint D: accounts complete

- [x] Spec success criteria 1–10
- [x] Human review (approved 2026-09-29). Don't deploy until every multi-user module is done.
