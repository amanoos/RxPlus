# Tasks: foundation

Plan: [plan.md](plan.md) · Spec: [SPEC-foundation.md](../SPEC-foundation.md)

Every task also meets the Definition of Done: lint and tests pass, no regressions, behavior checked at runtime, docs updated.

## Phase 1: Scaffold

- [x] **Task 1: Scaffold the Analog app, add tooling and set LF line endings** (M, mostly generated files)
  - Acceptance:
    - `npm create analog@latest` output sits at the repo root, and all package versions are pinned exactly
    - `.gitattributes` sets `* text=auto eol=lf`; `.nvmrc` holds `24`; ESLint (angular-eslint) and Prettier are configured, with `lint`, `format`, `test`, `test:watch` scripts
    - The spec's Project Structure and Tech Stack are updated if the scaffold differs
  - Verify: `npm run lint && npm test && npm run build`; `npm run dev` serves the default page
  - Files: scaffold output, `package.json`, `.gitattributes`, `.nvmrc`, `eslint.config.js`, `.prettierrc`, `SPEC-foundation.md`
  - Depends on: none

- [ ] **Task 2: Add PrimeNG + Tailwind v4 with the Aura theme and dark mode** (S)
  - Acceptance:
    - `providePrimeNG` uses the Aura preset, CSS layers are ordered so Tailwind utilities can override PrimeNG, and `tailwindcss-primeui` is loaded
    - Dark mode follows `prefers-color-scheme` for both PrimeNG and Tailwind
    - The index page renders a `p-button` inside a Tailwind flex layout
  - Verify: `npm run build`; view-source on `/` shows the server-rendered button; toggling the OS theme switches colors
  - Files: `vite.config.ts`, `src/styles.css`, `src/app/app.config.ts`, `src/app/pages/index.page.ts`
  - Depends on: 1

- [ ] **Task 3: Validate env config and fail fast** (S)
  - Acceptance:
    - A zod schema covers `DATABASE_URL`, `APP_PASSWORD_HASH`, `SESSION_SECRET` (at least 32 characters), `COOKIE_SECURE`, `PORT`, `TZ`, and is parsed once at server startup via a Nitro plugin
    - A missing or invalid value makes the process exit with a message naming the variable, and the value itself is never printed
    - `.env.example` is committed with placeholder values
  - Verify: unit tests for valid, missing and short-secret cases; `npm run dev` with an empty `.env` prints a readable error
  - Files: `src/server/utils/env.ts`, `src/server/plugins/env.ts`, `src/server/utils/env.spec.ts`, `.env.example`
  - Depends on: 1

### Checkpoint A

- [ ] `npm run lint && npm test && npm run build` pass
- [ ] SSR-rendered PrimeNG + Tailwind page works in both themes
- [ ] Human review

## Phase 2: Data

- [ ] **Task 4: Drizzle client, dev Postgres and `/api/health`** (M)
  - Acceptance:
    - `docker-compose.yml` has a `db` service (`postgres:18`, named volume, `pg_isready` healthcheck, `TZ`) with no host port; `docker-compose.dev.yml` exposes `5432` to localhost; a `test` profile creates `rxplus_test`
    - `src/server/db/client.ts` exports one Drizzle instance on a shared `pg` Pool; `drizzle.config.ts` and the `db:generate` / `db:migrate` scripts exist
    - `GET /api/health` returns `200 {status:"ok",db:"ok"}`, or `503 {status:"degraded",db:"down"}` when `SELECT 1` fails
  - Verify: integration test against `rxplus_test` for 200; unit test with a failing client for 503; manually, `curl` before and after `docker compose stop db`
  - Files: `docker-compose.yml`, `docker-compose.dev.yml`, `drizzle.config.ts`, `src/server/db/client.ts`, `src/server/routes/api/health.get.ts` (+ spec)
  - Depends on: 3

## Phase 3: Auth slice

- [ ] **Task 5: Password hashing util and `hash-password` script** (S)
  - Acceptance:
    - `hashPassword` and `verifyPassword` use `node:crypto` scrypt with a random salt, stored as `scrypt$<N>$<salt>$<hash>`; verification uses `timingSafeEqual`
    - `npm run hash-password` prompts without echoing the password and prints the hash to paste into `.env`
  - Verify: unit tests for round trip, wrong password, tampered hash and malformed string
  - Files: `src/server/utils/password.ts`, `src/server/utils/password.spec.ts`, `scripts/hash-password.ts`, `package.json`
  - Depends on: 3

- [ ] **Task 6: Auth API routes, session, rate limiter and middleware** (M)
  - Acceptance:
    - `POST /api/auth/login` (zod body) returns 204 and sets a sealed `httpOnly`, `sameSite=lax` cookie with a 30-day max age and `secure` from env; 401 with a generic message on failure; 429 on the sixth failure within 15 minutes
    - `POST /api/auth/logout` returns 204 and clears the session; `GET /api/auth/me` returns 200 or 401
    - The middleware returns 401 for every `/api/*` except `auth/login` and `health`
  - Verify: integration tests for each status code and the cookie flags; the rate limiter unit-tested with a fake clock
  - Files: `src/server/utils/session.ts`, `src/server/utils/rate-limit.ts` (+ spec), `src/server/routes/api/auth/{login.post,logout.post,me.get}.ts`, `src/server/middleware/auth.ts`
  - Depends on: 4, 5

- [ ] **Task 7: NgRx root store and `auth` feature** (M)
  - Acceptance:
    - `provideStore`, `provideEffects`, and `provideStoreDevtools` only in dev mode
    - The `auth` feature has status `unknown | authenticated | anonymous` plus `error`; actions `login`, `loginSuccess`, `loginFailure`, `logout`, `logoutSuccess`, `sessionChecked`
    - Effects call the API through an `AuthApi` service, map 401 and 429 to user-facing messages, and navigate on success
  - Verify: unit tests for the reducer, selectors and effects (`provideMockActions`, `HttpTestingController`); a production build contains no devtools
  - Files: `src/app/store/app.store.ts`, `src/app/core/auth/{auth.actions,auth.reducer,auth.effects,auth.selectors,auth-api.service}.ts` (+ specs)
  - Depends on: 6

- [ ] **Task 8: Login page (prerendered) and auth guard** (M)
  - Acceptance:
    - `/login` matches the spec's code-style example and is listed in Analog `prerender.routes`
    - The guard on the `(app)` layout checks the session during SSR (forwarding the request cookie) and in the browser, and redirects to `/login?next=<path>`
    - After login the app navigates to `next` only if it's a same-origin relative path; otherwise to `/`
  - Verify: unit test for the `next` sanitizer; build output contains `login/index.html`; manual pass of Checkpoint B flows, including a hard refresh while signed in
  - Files: `src/app/pages/login.page.ts`, `src/app/pages/(app).page.ts`, `src/app/core/auth/auth.guard.ts`, `src/app/core/auth/safe-next.ts` (+ spec), `vite.config.ts`
  - Depends on: 2, 7

### Checkpoint B

- [ ] All unit and integration tests pass
- [ ] Manual login, logout and redirect flows work; health returns 200 and 503
- [ ] No hydration warnings in the browser console
- [ ] Human review

## Phase 4: Shell and E2E

- [ ] **Task 9: Responsive app shell with placeholder pages and logout** (M)
  - Acceptance:
    - The `(app)` layout has a top bar with the name and a menu (Dashboard, Medications, Interactions, Digest, Logout); below 768px the menu becomes a PrimeNG Drawer opened by a button
    - Placeholder pages exist for `/`, `/medications`, `/interactions`, `/digest`
    - No horizontal scroll at 375px or 1280px; landmarks and focus order are keyboard-usable
  - Verify: manual check at both widths in the browser pane; Logout dispatches `logout` and lands on `/login`
  - Files: `src/app/pages/(app).page.ts`, `src/app/core/layout/app-shell.component.ts`, `src/app/pages/(app)/{index,medications,interactions,digest}.page.ts`
  - Depends on: 8

- [ ] **Task 10: Playwright e2e (3 specs)** (S)
  - Acceptance:
    - Playwright runs against the built SSR server with the test DB and a known test password hash in `.env.test` (a test-only value, committed as an example)
    - Specs: redirect-to-login; wrong-then-right password reaching the dashboard; logout
  - Verify: `npm run e2e` passes locally
  - Files: `playwright.config.ts`, `e2e/auth.spec.ts`, `.env.test.example`, `package.json`
  - Depends on: 9

## Phase 5: Deploy

- [ ] **Task 11: Production Dockerfile, Compose app service and migrate-on-start** (M)
  - Acceptance:
    - Multi-stage `Dockerfile` (node:24 build, node:24-slim runtime), runs as non-root, `TZ` set; the `app` service `depends_on: db: service_healthy`, exposes `3000`, uses `.env`
    - The entrypoint runs `scripts/migrate.ts` (compiled; runtime migrator; exits 0 with "no migrations" if there's no journal; non-zero on failure) and then starts the server
    - A README "Deploy" section explains setup: `cp .env.example .env`, `npm run hash-password`, `docker compose up -d --build`
  - Verify: `docker compose up -d --build` locally serves login on `:3000`; logs are clean; a broken `DATABASE_URL` makes the container exit non-zero; then repeat on the Ubuntu server (Success Criterion 1)
  - Files: `Dockerfile`, `.dockerignore`, `docker-compose.yml`, `scripts/migrate.ts`, `README.md`
  - Depends on: 4, 9

### Checkpoint C: foundation complete

- [ ] Spec Success Criteria 1–8 all verified
- [ ] Coverage at least 80% on `src/server/utils`, `src/app/core/auth` and the auth store
- [ ] Human review, then write `SPEC-medications.md`
