# Spec: accounts

Module of [CAPABILITY-MAP.md](CAPABILITY-MAP.md), initiative **multi-user**. Status: **done, approved 2026-09-29**.

## Objective

Let several people use one RxPlus server, each signing in with their own username and password. This module replaces the single shared password (`APP_PASSWORD_HASH`) with a `users` table and puts the signed-in user's id in the session, so the `per-user-*` modules can scope data to them.

**Users:**

- **Account holders** (household members on the home network) sign in, see who they're signed in as, and sign out.
- **The admin** (whoever runs the server) adds, lists and removes accounts and resets passwords from the command line. There is no sign-up page and no admin role in the app.

Success means that two people can sign in at the same time from different browsers, each session knows which user it belongs to, and a password reset or account removal signs that person out everywhere.

Out of scope here: scoping any data to the user (done by the `per-user-*` modules), password change from inside the app, email, password recovery, 2FA, and roles.

## Tech Stack

Unchanged from [SPEC-foundation.md](SPEC-foundation.md). There are no new dependencies:

- **Passwords:** hashed with the existing `node:crypto` scrypt helpers (`src/server/utils/password.ts`).
- **Sessions:** h3 sealed sessions, as today.
- **Admin command:** a Node script bundled with esbuild, like `migrate` and `ddi-import`.

## Configuration

| Var                 | Change                                                                                                                                                                                          |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `APP_PASSWORD_HASH` | **Removed.** No longer required or read. If it's still set, the server starts normally and logs one line saying it is ignored. It's removed from `.env.example`, the README and the e2e config. |
| `SESSION_SECRET`    | Unchanged. Existing sessions (`{ authenticated: true }` with no user) are rejected, so everyone signs in again after the upgrade.                                                               |

## Commands

```
Unit tests:        npm test
Integration:       npm run db:test:up && npm run test:int
E2E:               npm run e2e
Lint / format:     npm run lint && npm run format:check
Migration:         npm run db:generate            # after editing src/server/db/schema/users.ts
Accounts (dev):    npm run user -- add <username>            # prompts for the password twice
                   npm run user -- reset-password <username>
                   npm run user -- remove <username> [--yes]
                   npm run user -- list
Accounts (Docker): docker compose exec app node dist/user.cjs add <username>
```

`npm run user` runs `build:scripts` (which now also bundles `scripts/user.ts`) and then `node --env-file-if-exists=.env dist/user.cjs`, the same way `ddi:import` does. The Dockerfile copies `dist/user.cjs` next to `migrate.cjs`.

## Project Structure

```
src/server/db/schema/users.ts           → users table (new)
src/server/db/schema/index.ts           → re-exports users
drizzle/0007_create_users.sql           → generated migration (number as generated)
src/server/accounts/                    → new module folder
  username.ts                           → normalize + validate usernames
  repository.ts                         → find/create/reset/remove/list users
  service.ts                            → login check (constant-time on unknown users), session check
src/server/utils/session.ts             → AuthSession becomes { userId, version }
src/server/utils/rate-limit.ts          → keyed limiter (per username) + global cap
src/server/middleware/auth.ts           → validates the session against the users table
src/server/routes/api/auth/login.post.ts   → { username, password }
src/server/routes/api/auth/me.get.ts       → returns the user
src/server/utils/auth-user.ts           → requireUser(event) for later modules
scripts/user.ts                         → admin CLI (replaces scripts/hash-password.ts)
src/app/core/auth/                      → NgRx auth slice holds the user
src/app/pages/login.page.ts             → username + password fields
src/app/pages/(app).page.ts             → shell shows the signed-in username
e2e/global-setup.ts                     → seeds the e2e user
```

## Behavior

**Data**

- `users`: `id uuid pk default random`, `username text not null unique`, `password_hash text not null`, `session_version integer not null default 1`, `created_at`, `updated_at`.
- Usernames are trimmed and lowercased before they're stored or looked up. They must be 3–32 characters from `a–z 0–9 . _ -`, and start with a letter or digit. They are case-insensitive: `Alice` signs in as `alice`.
- Passwords must be at least 12 characters, the same rule as `hash-password` today. They're stored only as the scrypt hash.

**Login and session**

- `POST /api/auth/login` takes `{ username, password }` (zod: username ≤ 64 characters and password ≤ 1024 before normalizing).
  - On a match, it stores `{ userId, version }` in the sealed session cookie (same cookie options as today) and returns `204`.
  - On a wrong password **or an unknown username**, it returns `401` with the same message, "Invalid username or password." An unknown username is still checked against a fixed dummy hash, so the response time doesn't reveal which usernames exist.
- **Rate limit:** 5 failures within 15 minutes for one username blocks that username with `429`. A global cap of 20 failures within 15 minutes, across all usernames, blocks every login with `429`. That stops guessing across many usernames. A successful login clears that username's failures only. The counters stay in memory (single process).
- **Session check:** the middleware loads the user by `userId` on every `/api/*` request except the public ones, which one indexed query covers. It returns `401` if:
  - the user no longer exists;
  - `version` differs from `session_version`, meaning the password was reset or the user signed out everywhere;
  - the session has no `userId` (a pre-upgrade session).

  On success it sets `event.context.user = { id, username }`.

- `requireUser(event)` returns `event.context.user` or throws `401`. Later modules scope their queries with it.
- `GET /api/auth/me` returns `200 { authenticated: true, user: { id, username } }`, or `401`.
- `POST /api/auth/logout` clears this browser's session and returns `204`. It doesn't touch `session_version`, so other devices stay signed in.
- The page guard is unchanged: it redirects to `/login?next=<path>` when `me` returns `401`.

**Admin CLI (`scripts/user.ts`)**

| Command                     | Effect                                                                                                                                                                 |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `add <username>`            | Validates the username, prompts for the password twice without echoing (or reads one line from a pipe), creates the user. Exits 1 if the username is taken or invalid. |
| `reset-password <username>` | Sets a new password and increments `session_version`, which signs that user out everywhere.                                                                            |
| `remove <username> [--yes]` | Asks `Type the username to confirm` (skipped with `--yes`), then deletes the user. The rows the `per-user-*` modules add are removed through `on delete cascade`.      |
| `list`                      | Prints each username and its creation date. Never prints hashes.                                                                                                       |

It exits non-zero with a readable message if the database is unreachable or the arguments are wrong. It never logs passwords or hashes.

- **At startup**, if the `users` table is empty, the server logs one line: `No accounts yet. Create one with: docker compose exec app node dist/user.cjs add <username>`. The login page itself stays generic.

**UI**

- The login page has **Username** (`autocomplete="username"`) and **Password** (`autocomplete="current-password"`) fields. Sign in is disabled until both are filled.
- **NgRx:** `auth` state gains `user: { id, username } | null`. `loginSuccess` and `sessionChecked` carry it, and `logoutSuccess` clears it along with the other feature slices (medications, digest, ...), so the next account never sees the previous one's data.
- The shell's top bar shows the signed-in username next to Logout. In the drawer on narrow screens, it shows above Logout.

## Code Style

This follows [SPEC-foundation.md](SPEC-foundation.md). Server code works like `literature/` and `digest/`: a repository for SQL, pure helpers for rules, and thin routes that validate with zod.

```ts
// src/server/accounts/username.ts
/** Lowercase, trimmed; null when it breaks the rules (3–32 of a–z 0–9 . _ -, starts alphanumeric). */
export function normalizeUsername(input: string): string | null {
  const name = input.trim().toLowerCase();
  return /^[a-z0-9][a-z0-9._-]{2,31}$/.test(name) ? name : null;
}
```

```ts
// src/server/routes/api/auth/login.post.ts (shape)
const LoginBody = z.object({
  username: z.string().min(1).max(64),
  password: z.string().min(1).max(1024),
});

export default defineEventHandler(async (event) => {
  const { username, password } = await readValidatedBody(event, LoginBody.parse);
  const user = await accounts.verifyLogin(username, password); // throws 401 / 429
  await (await authSession(event)).update({ userId: user.id, version: user.sessionVersion });
  return sendNoContent(event);
});
```

## Testing Strategy

- **Unit (Vitest):**
  - `normalizeUsername`: valid and invalid names, case folding, trimming
  - the keyed rate limiter: per-username block, global cap, reset on success
  - the auth reducer: `user` set on login and check, cleared on logout
  - effects and the API service: the new login body and `me` shape
  - the login page: both fields required
  - env: `APP_PASSWORD_HASH` no longer required
- **Integration (Vitest + `rxplus_test` Postgres):**
  - `auth/*` routes: login with the right and wrong password; an unknown user gets the same `401`; `429` per username and globally; `me` returns the user; logout
  - the middleware rejects a removed user, a stale `session_version` and a pre-upgrade session
  - the CLI's repository functions: add (and add a duplicate), reset (the old session gets `401`), remove, list
  - every existing `*.int.spec.ts` signs in as a seeded test user instead of with `APP_PASSWORD_HASH`
- **E2E (Playwright):**
  - `global-setup` seeds one user
  - `auth.spec.ts` covers: redirect when signed out; a wrong password shows the error; username plus password lands on the dashboard with the username shown in the top bar; logout
  - one new spec: two browser contexts signed in as two users both stay signed in, and each shows its own username
- **Coverage:** 80% lines on `src/server/accounts`, `src/server/utils/session.ts` and `rate-limit.ts`, and on the auth store, the same bar as foundation.

## Boundaries

- **Always:**
  - run `npm run lint && npm test && npm run test:int` before calling a task done
  - normalize usernames in one place (`normalizeUsername`)
  - compare passwords only through `verifyPassword`
  - commit the generated migration with the schema change
  - update `.env.example`, the README and [SPEC-foundation.md](SPEC-foundation.md)'s auth section when behavior changes
- **Ask first:**
  - adding a dependency (for example an auth library)
  - adding an in-app admin page, roles, sign-up or password recovery
  - storing sessions in the database instead of the sealed cookie
  - exposing the app beyond the LAN
- **Never:**
  - log or print passwords, hashes, session contents or usernames of failed logins
  - reveal whether a username exists (message, status or timing)
  - deploy this module before the other multi-user modules are done (see CAPABILITY-MAP.md)
  - edit applied migrations by hand

## Success Criteria

1. After an upgrade with an empty `users` table, the app starts, logs the "No accounts yet" line, and `/login` shows the username and password fields.
2. `docker compose exec app node dist/user.cjs add alice` creates `alice`. `add alice` again exits 1 with "already exists", and `list` shows `alice` without a hash.
3. `alice`, typed as `Alice`, signs in and lands on the dashboard with "alice" in the top bar. `GET /api/auth/me` returns `{ authenticated: true, user: { id, username: "alice" } }`.
4. A wrong password and an unknown username both return `401` "Invalid username or password.", with response times within the same range (the dummy hash is checked).
5. The 6th failure for `alice` within 15 minutes returns `429` for `alice`, while `bob` can still sign in. The 21st failure across all usernames returns `429` for everyone.
6. `alice` and `bob` stay signed in at the same time in two browsers. Logging `alice` out in one browser leaves her other browser signed in.
7. `reset-password alice` makes all of Alice's existing sessions return `401` on their next request, and the new password works. `remove alice` (confirmed) does the same, and she can't sign in again.
8. A session cookie from before the upgrade returns `401`, and the page redirects to `/login`.
9. `APP_PASSWORD_HASH` is gone from `env.ts`, `.env.example`, the README and `playwright.config.ts`. `scripts/hash-password.ts` is replaced by `scripts/user.ts`.
10. `npm run lint`, `npm test`, `npm run test:int` and `npm run e2e` pass, and the coverage targets are met.

## Resolved Decisions (2026-09-28)

1. **Minimum password length:** 12 characters, as today.
2. **Removing an account:** `remove <username>` asks for the username to be typed; `remove <username> --yes` skips the prompt for scripting.

## Open Questions

None.
