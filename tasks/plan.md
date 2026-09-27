# Implementation Plan: foundation

Spec: [SPEC-foundation.md](../SPEC-foundation.md) · Map: [CAPABILITY-MAP.md](../CAPABILITY-MAP.md) · Tasks: [todo.md](todo.md)

## Overview

Build the runnable RxPlus skeleton: an Analog SSR app with the PrimeNG + Tailwind shell, NgRx, Drizzle on PostgreSQL, single-password auth, and a Docker Compose deploy to the Ubuntu x86_64 home server (LAN only, `TZ=America/New_York`). No drug features.

## Architecture Decisions

- **Scaffold first, verify the paths.** `npm create analog@latest` sets the real directory layout and versions. Task 1 updates the spec's Project Structure if the scaffold output differs, before anything else is built on it.
- **Line endings:** add `.gitattributes` with `* text=auto eol=lf`. The first commit showed CRLF conversion warnings, and shell scripts and Dockerfiles must stay LF for the Linux server.
- **Migrations at startup use the runtime migrator** (`drizzle-orm/node-postgres/migrator`) in a small script, not `drizzle-kit migrate`. This keeps `drizzle-kit`, a dev dependency, out of the production image. If `drizzle/meta/_journal.json` doesn't exist yet (foundation has no tables), the script logs "no migrations" and exits 0. This refines the spec's "container runs `db:migrate`": the dev command stays `drizzle-kit migrate`.
- **Dev database:** during development, Postgres runs from the same `docker-compose.yml` with only the `db` service, and a `dev` override file exposes `5432` on localhost. The production compose keeps it unexposed.
- **Auth is built as a vertical slice** (server, then store, then page), and the shell comes after it, so each task leaves a working, testable app.

## Dependency Graph

```
1 Scaffold ─┬─ 2 UI kit (PrimeNG/Tailwind)
            ├─ 3 Env config ─┬─ 4 DB + health
            │                └─ 5 Password hash ─┐
            │                   4 ───────────────┴─ 6 Auth API
            └─ 7 NgRx root + auth slice (needs 6's API contract)
               8 Login page + guard (2, 6, 7)
               9 App shell (2, 8)
              10 E2E (9)
              11 Production Docker + migrate-on-start (4, 9)
```

## Task List

### Phase 1: Scaffold

- [x] Task 1: Scaffold the Analog app, add tooling and set LF line endings
- [x] Task 2: Add PrimeNG + Tailwind v4 with the Aura theme and dark mode
- [x] Task 3: Validate env config and fail fast

### Checkpoint A: after Tasks 1–3

- [ ] `npm run lint && npm test && npm run build` pass
- [ ] Dev server renders a PrimeNG button styled with Tailwind, via SSR (visible in view-source)
- [ ] Human review

### Phase 2: Data

- [x] Task 4: Drizzle client, dev Postgres and `/api/health`

### Phase 3: Auth slice

- [x] Task 5: Password hashing util and `hash-password` script
- [x] Task 6: Auth API routes, session, rate limiter and middleware
- [x] Task 7: NgRx root store and `auth` feature
- [ ] Task 8: Login page (prerendered) and auth guard

### Checkpoint B: after Tasks 4–8

- [ ] All unit and integration tests pass
- [ ] Manual check: logged-out `/` goes to `/login`; wrong password shows an error; right password lands on `/`; refresh stays signed in
- [ ] `/api/health` returns 200, and 503 with the DB stopped
- [ ] Human review

### Phase 4: Shell and E2E

- [ ] Task 9: Responsive app shell with placeholder pages and logout
- [ ] Task 10: Playwright e2e (3 specs)

### Phase 5: Deploy

- [ ] Task 11: Production Dockerfile, Compose app service and migrate-on-start

### Checkpoint C: complete

- [ ] Spec Success Criteria 1–8 all verified (criterion 1 on the home server)
- [ ] Coverage targets met
- [ ] Human review, then `SPEC-medications.md`

## Risks and Mitigations

| Risk                                                         | Impact | Mitigation                                                                                                                  |
| ------------------------------------------------------------ | ------ | --------------------------------------------------------------------------------------------------------------------------- |
| Analog scaffold layout or versions differ from the spec      | Med    | Task 1 reconciles the spec before continuing                                                                                |
| PrimeNG and Tailwind v4 CSS layer conflicts                  | Med    | Use `tailwindcss-primeui` and PrimeNG's `cssLayer` option; verified at Checkpoint A                                         |
| SSR guard can't read the session cookie during server render | High   | Task 8 forwards request cookies to `/api/auth/me` during SSR (Analog's request context); covered by e2e with a hard refresh |
| NgRx devtools or effects break SSR hydration                 | Low    | Register devtools only when `isDevMode()`; the checkpoint checks for no hydration warnings                                  |
| Migrator with no migrations crashes the container            | Med    | Task 11 guards on the journal file existing and tests it                                                                    |
| Windows dev vs Linux prod differences (CRLF, native modules) | Med    | `.gitattributes`; no native deps (scrypt comes from `node:crypto`)                                                          |

## Open Questions

None.
