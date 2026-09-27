# Spec: foundation

Module of [CAPABILITY-MAP.md](CAPABILITY-MAP.md). Status: **draft, awaiting review**.

## Objective

Stand up the runnable skeleton that every other module builds on: an Analog (Angular) app with SSR, the PrimeNG + Tailwind UI shell, NgRx wiring, a PostgreSQL connection with a migration pipeline, single-user login, and a Docker Compose deployment for the home server.

No drug features are part of this module. When it's done, the owner can deploy to the home server, log in, and see an empty, responsive app shell with navigation to placeholder pages for the later modules.

**User:** the owner only (single user). This is also a learning project, so the full stack is used on purpose. Each tool is used where it earns its place:

- **SSR** renders the authenticated pages on the server.
- **SSG** pre-renders only the public `/login` page, since everything else is private and changes often.
- **NgRx** handles app-level state (session now, medications later) with store, effects and devtools.

## Tech Stack

Scaffolded with `create-analog@2.7.5` (template `latest`). All versions are pinned exactly in `package.json` (`.npmrc` has `save-exact=true`).

| Concern        | Choice                                                                                  |
| -------------- | --------------------------------------------------------------------------------------- |
| Runtime        | Node.js 24 LTS (dev: 24.19.0)                                                           |
| Meta-framework | AnalogJS 2.7.5 on Vite 8 (file-based routing, SSR, Nitro server routes)                 |
| UI framework   | Angular 22.2 (standalone components, signals, zoneless by default), TypeScript 6.0      |
| Components     | PrimeNG 22.1 with the Aura theme preset (`@primeuix/themes`); PrimeUI Community License |
| Styling        | Tailwind CSS 4.3 (`@tailwindcss/vite`) + `tailwindcss-primeui`                          |
| State          | `@ngrx/store`, `@ngrx/effects`, `@ngrx/store-devtools` (dev only)                       |
| Database       | PostgreSQL 18 (Docker), `drizzle-orm` + `pg`, `drizzle-kit`                             |
| Auth           | h3 sealed sessions (`useSession`) + `node:crypto` scrypt password hash; no auth library |
| Tests          | Vitest 4.1 + jsdom (unit/integration), Playwright (e2e)                                 |
| Lint/format    | ESLint 10 + angular-eslint 22 + typescript-eslint (flat config), Prettier 3             |
| Deploy         | Docker Compose: `app` + `db`                                                            |

## Configuration

`.env.example` is committed. `.env` is gitignored.

| Var                    | Purpose                                                                                                                                                                    |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`         | `postgres://rxplus:***@db:5432/rxplus`                                                                                                                                     |
| `APP_PASSWORD_HASH`    | scrypt hash, created with `npm run hash-password`                                                                                                                          |
| `SESSION_SECRET`       | at least 32 random characters; signs and encrypts the session cookie                                                                                                       |
| `COOKIE_SECURE`        | `false` on plain-HTTP LAN; `true` behind TLS                                                                                                                               |
| `PORT`                 | default `3000`                                                                                                                                                             |
| `TZ`                   | `America/New_York`                                                                                                                                                         |
| `VITE_PRIMEUI_LICENSE` | PrimeUI Community License key. **Build-time**: Vite inlines it into the client bundle, so it's not a secret and must be present when `npm run build` / `docker build` runs |

The server refuses to start, with a clear error, if `DATABASE_URL`, `APP_PASSWORD_HASH` or `SESSION_SECRET` is missing or invalid.

## Commands

```
Install:        npm ci
Dev:            npm run dev                 # Vite dev server with SSR, http://localhost:5173
Build:          npm run build
Start (prod):   node dist/analog/server/index.mjs
Unit tests:     npm test                    # vitest run
Test watch:     npm run test:watch
E2E:            npm run e2e                 # playwright test
Lint:           npm run lint
Format:         npm run format
DB generate:    npm run db:generate         # drizzle-kit generate
DB migrate:     npm run db:migrate          # drizzle-kit migrate
Hash password:  npm run hash-password       # prompts, prints APP_PASSWORD_HASH
Deploy:         docker compose up -d --build
```

## Project Structure

Check the exact Analog paths against the scaffold output and update this section if they differ.

```
src/
  app/
    pages/                  → file-based routes (Analog)
      (app).page.ts         → authenticated layout: shell + <router-outlet>
      (app)/index.page.ts   → dashboard placeholder
      (app)/digest.page.ts  → placeholder for later modules
      login.page.ts         → public, prerendered (SSG)
    core/                   → app-wide services, guards, interceptors
      auth/
    features/<module-id>/   → per-module components, services, NgRx feature
    store/                  → root store config
    shared/ui/              → small reusable presentational components
  server/
    routes/api/             → Nitro API routes (/api/*)
      auth/login.post.ts
      auth/logout.post.ts
      auth/me.get.ts
      health.get.ts
    middleware/auth.ts      → 401 for /api/* unless public
    db/
      client.ts             → drizzle + pg pool
      schema/               → one file per module (empty in foundation)
    utils/                  → env validation, password hashing, session
drizzle/                    → generated SQL migrations (committed)
e2e/                        → Playwright specs
scripts/hash-password.ts
docker-compose.yml
Dockerfile
docs/intent/, CAPABILITY-MAP.md, SPEC-*.md
```

## Behavior

**Auth**

- `POST /api/auth/login` takes `{ password }`.
  - On a match (checked with `timingSafeEqual` against the scrypt hash), it sets a sealed session cookie (`httpOnly`, `sameSite=lax`, `secure` taken from `COOKIE_SECURE`, 30-day max age) and returns `204`.
  - On a wrong password it returns `401` with a generic message.
  - After 5 failed attempts within 15 minutes, further attempts get `429` until the window resets. The counter is kept in memory, which is enough for a single user.
- `POST /api/auth/logout` clears the session and returns `204`.
- `GET /api/auth/me` returns `200 { authenticated: true }` or `401`.
- Server middleware returns `401` for every `/api/*` route except `auth/login` and `health`.
- A page guard runs during SSR and in the browser: unauthenticated visits to any `(app)` route redirect to `/login?next=<path>`. After login, the app returns to `next`, but only if it is a same-origin relative path.

**Health**

- `GET /api/health` returns `200 { status: "ok", db: "ok" }`, or `503 { status: "degraded", db: "down" }` if `SELECT 1` fails.

**NgRx**

- An `auth` feature slice holds `status: 'unknown' | 'authenticated' | 'anonymous'`, plus `error`.
- Actions: `login`, `loginSuccess`, `loginFailure`, `logout`, `logoutSuccess`, `sessionChecked`.
- Effects call the API and navigate as needed.
- Store devtools are registered only in dev builds.

**UI shell**

- Top bar with the app name, plus a navigation menu for Dashboard, Medications, Interactions and Digest (placeholders) and Logout.
- On screens narrower than 768px the navigation collapses into a PrimeNG Drawer opened by a menu button.
- Follows the system light/dark preference through PrimeNG's dark-mode selector and Tailwind's `dark:` variant.

**Database**

- A shared Drizzle client with a single `pg` Pool.
- Foundation defines no tables. The migration pipeline is proven by `medications`' first migration.
- The app container runs `db:migrate` before starting the server, and exits with a non-zero code if a migration fails.

**Docker**

- `db`: `postgres:18`, a named volume for data, a healthcheck with `pg_isready`, and no exposed host port by default.
- `app`: multi-stage Dockerfile (build, then a slim runtime), runs as a non-root user, `depends_on: db (service_healthy)`, and exposes `3000`.

## Code Style

- Standalone components, `ChangeDetectionStrategy.OnPush`, signals for local state, `inject()` over constructor injection.
- Components select from the store with `store.selectSignal`. No `subscribe` in components.
- Tailwind handles layout and spacing. PrimeNG handles interactive widgets. No custom component CSS unless it's unavoidable.
- Files use kebab-case, and NgRx files use the pattern `<feature>.actions.ts`, `.reducer.ts`, `.effects.ts`, `.selectors.ts`.
- Server routes validate their input with zod and return typed results; they never pass raw errors to the client.

```ts
// src/app/pages/login.page.ts
@Component({
  standalone: true,
  imports: [ReactiveFormsModule, ButtonModule, PasswordModule, MessageModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <form
      [formGroup]="form"
      (ngSubmit)="submit()"
      class="mx-auto mt-24 flex max-w-sm flex-col gap-4 p-4"
    >
      <h1 class="text-2xl font-semibold">RxPlus</h1>
      <p-password
        formControlName="password"
        [feedback]="false"
        [toggleMask]="true"
        inputId="password"
      />
      @if (error()) {
        <p-message severity="error" [text]="error()!" />
      }
      <p-button type="submit" label="Sign in" [disabled]="form.invalid" />
    </form>
  `,
})
export default class LoginPage {
  private readonly store = inject(Store);
  readonly error = this.store.selectSignal(selectAuthError);
  readonly form = inject(NonNullableFormBuilder).group({ password: ['', Validators.required] });

  submit() {
    this.store.dispatch(AuthActions.login({ password: this.form.getRawValue().password }));
  }
}
```

## Testing Strategy

- **Unit (Vitest):**
  - auth reducer and selectors
  - auth effects, using `provideMockActions`
  - password hash and verify
  - env validation
  - the login rate limiter
- **Integration (Vitest + real Postgres):**
  - server route handlers for `auth/*` and `health`, run against a `rxplus_test` database (Compose profile `test`)
  - the test DB setup runs migrations first
- **E2E (Playwright, 3 specs):**
  - redirect to login when not signed in
  - wrong password shows an error, and the right password lands on the dashboard
  - logout returns to the login page
- **Coverage target:** 80% lines on `src/server/utils` and `src/app/core/auth` and on the auth store; no global threshold.

## Boundaries

- **Always:**
  - run `npm run lint && npm test` before calling a task done
  - validate server input with zod
  - keep secrets in `.env`
  - commit generated migrations alongside schema changes
- **Ask first:**
  - adding any dependency not listed above
  - changing the database schema or migration strategy
  - exposing the app or the database beyond the LAN
  - switching auth approach
- **Never:**
  - commit `.env` or real secrets
  - log passwords, session contents or health data
  - disable the auth middleware for convenience
  - edit generated migrations by hand once they've been applied

## Success Criteria

1. On a clean machine with Docker, `cp .env.example .env`, filling in the values, then `docker compose up -d --build` serves the app on `http://<server>:3000`, with no errors in `docker compose logs app`.
2. A visit to `/` while not signed in redirects to `/login`. The login page's HTML is prerendered and present in the build output.
3. A wrong password gets `401`, and the sixth attempt within 15 minutes gets `429`. The right password sets an `httpOnly` cookie and loads the dashboard, and a hard refresh keeps you signed in.
4. `curl http://<server>:3000/api/auth/me` without the cookie returns `401`. `/api/health` returns `200` with the DB up and `503` after `docker compose stop db`.
5. The shell has no horizontal scroll at 375px or 1280px wide, the navigation collapses into a drawer below 768px, and dark mode follows the OS setting.
6. Redux DevTools shows `auth` actions in dev and nothing in a production build.
7. `npm run lint`, `npm test` and `npm run e2e` all pass. Coverage targets are met.
8. The app fails fast with a readable message when a required env var is missing.

## Resolved Decisions (2026-09-26)

1. **Git:** repository initialized locally; remote `origin` = `https://github.com/amanoos/my-tracker.git`.
2. **Home server:** Ubuntu on x86_64. Use standard `linux/amd64` Docker images and build on the server with `docker compose up -d --build`.
3. **Access:** LAN only. `COOKIE_SECURE=false`, no TLS termination in this module.
4. **Time zone:** `TZ=America/New_York` on both containers, for the digest schedule later.

## Open Questions

None.
