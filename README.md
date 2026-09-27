# RxPlus

A personal, single-user medication watchlist. Built with [Analog](https://analogjs.org) (Angular + SSR), PrimeNG, Tailwind CSS, NgRx, Drizzle and PostgreSQL.

- What and why: [docs/intent/rx-tracker.md](docs/intent/rx-tracker.md)
- Modules and build order: [CAPABILITY-MAP.md](CAPABILITY-MAP.md)
- Current spec: [SPEC-medications.md](SPEC-medications.md) · Tasks: [tasks/todo.md](tasks/todo.md) · Done: [foundation](SPEC-foundation.md) ([tasks](tasks/foundation/todo.md))

## Configuration

Copy `.env.example` to `.env` and fill it in. `.env` is gitignored; never commit it.

| Variable               | How to set it                                                                                                 |
| ---------------------- | ------------------------------------------------------------------------------------------------------------- |
| `POSTGRES_PASSWORD`    | Any strong password. Use letters and digits only: it is embedded in a connection URL.                         |
| `DATABASE_URL`         | Local dev only: `postgres://rxplus:<POSTGRES_PASSWORD>@localhost:<DB_DEV_PORT>/rxplus`. Compose sets its own. |
| `APP_PASSWORD_HASH`    | `npm run hash-password` (asks for your login password, at least 12 characters).                               |
| `SESSION_SECRET`       | `node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"`                         |
| `COOKIE_SECURE`        | `false` on the LAN over plain HTTP.                                                                           |
| `VITE_PRIMEUI_LICENSE` | Your PrimeUI Community License key. Build-time: baked into the client bundle.                                 |
| `DB_DEV_PORT`          | Host port for the dev database (default 5432; change it if that port is taken).                               |
| `APP_PORT`             | Host port for the app in Docker (default 3000).                                                               |
| `RXNAV_BASE_URL`       | Optional. RxNorm API base (default `https://rxnav.nlm.nih.gov/REST`). The e2e tests point it at a local stub. |
| `OPENFDA_BASE_URL`     | Optional. openFDA drug API base (default `https://api.fda.gov/drug`).                                         |
| `OPENFDA_API_KEY`      | Optional, free from open.fda.gov. Raises the keyless limit of 1,000 requests/day. Never logged.               |

The server refuses to start, naming the variable, if a required value is missing or invalid.

## Drug data

Medications are looked up in [RxNorm](https://www.nlm.nih.gov/research/umls/rxnorm/) through NLM's free RxNav API (no key needed). Only the server talks to RxNav: requests time out after 5 seconds, are retried once on network errors, and are cached (drug names 24 hours, product details 7 days). If RxNav is down, adding a medication shows "Drug lookup is unavailable right now"; your saved list keeps working.

### Interactions

- **Severity** comes from [DDInter 2.0](https://ddinter2.scbdd.com) (CC BY-NC-SA 4.0, personal non-commercial use), imported into Postgres and mapped to RxNorm ingredients. It is never produced by AI.
- **Explanations** are verbatim sentences from the FDA drug labels (openFDA / DailyMed), with a link to each label.
- If a drug's ingredient isn't in DDInter, the app says so instead of reporting "no interactions".

Import the DDInter data once, then again whenever DDInter publishes a release. It takes about 5 minutes the first time (≈2,000 RxNav name lookups); later runs reuse earlier mappings. The data is downloaded at import time and never committed.

```bash
npm run ddi:import                                   # development (uses DATABASE_URL from .env)
docker compose run --rm app node dist/ddi-import.cjs # in Docker
```

Until it has run, the Interactions page explains that the data hasn't been imported yet.

See [docs/research/free-data-sources.md](docs/research/free-data-sources.md) for the sources considered.

## Development

```bash
npm ci
npm run db:up        # dev Postgres on localhost:${DB_DEV_PORT}
npm run dev          # http://localhost:5173
```

## Tests

```bash
npm test             # unit tests (no database needed)
npm run db:test:up   # throwaway Postgres on localhost:5433
npm run test:int     # integration tests against it
npm run e2e          # test DB + build + Playwright (installed Chrome; stub RxNav/openFDA; sample DDInter data)
npm run db:test:down
npm run lint
npm run test:coverage  # unit + integration with coverage (needs the test DB)
```

Integration and e2e tests reset tables in the test database (including any DDInter import there). Use the dev database for manual checks.

## Database migrations

```bash
npm run db:generate  # after changing src/server/db/schema/*: writes SQL to drizzle/
npm run db:migrate   # apply to the dev database
```

Commit the generated `drizzle/` files with the schema change. In Docker, migrations run automatically on container start, before the server; if they fail, the container exits and the server never starts.

## Deploy (home server, Ubuntu x86_64, LAN only)

Prerequisites: Docker Engine with the Compose plugin, and a clone of this repository.

```bash
git clone https://github.com/amanoos/my-tracker.git rxplus && cd rxplus
cp .env.example .env
npm run hash-password          # or run it on your PC and paste the result
# edit .env: POSTGRES_PASSWORD, APP_PASSWORD_HASH, SESSION_SECRET, VITE_PRIMEUI_LICENSE
docker compose up -d --build
docker compose run --rm app node dist/ddi-import.cjs   # interaction data, ~5 minutes
```

Open `http://<server-ip>:3000` (or your `APP_PORT`). Check it:

```bash
docker compose ps                     # app running, db healthy
docker compose logs app               # "[migrate] ..." then "Listening on ..."
curl http://localhost:3000/api/health # {"status":"ok","db":"ok"}
```

Update to a new version:

```bash
git pull && docker compose up -d --build
```

Notes:

- The database has no published port; only the app container can reach it. Data lives in the `rxplus_db-data` volume.
- `docker compose down` keeps the data. `docker compose down -v` **deletes the database**.
- `POSTGRES_PASSWORD` is fixed when the volume is first created. Changing it later in `.env` doesn't change the database password.
- Changing `VITE_PRIMEUI_LICENSE` needs a rebuild (`--build`), because it is baked in at build time.
