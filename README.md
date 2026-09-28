# RxPlus

A personal, single-user medication watchlist. Built with [Analog](https://analogjs.org) (Angular + SSR), PrimeNG, Tailwind CSS, NgRx, Drizzle and PostgreSQL.

- What and why: [docs/intent/rx-tracker.md](docs/intent/rx-tracker.md)
- Modules and build order: [CAPABILITY-MAP.md](CAPABILITY-MAP.md)
- All modules built: [foundation](SPEC-foundation.md) ([tasks](tasks/foundation/todo.md)) · [medications](SPEC-medications.md) ([tasks](tasks/medications/todo.md)) · [interactions](SPEC-interactions.md) ([tasks](tasks/interactions/todo.md)) · [drug-info](SPEC-drug-info.md) ([tasks](tasks/drug-info/todo.md)) · [literature](SPEC-literature.md) ([tasks](tasks/literature/todo.md)) · [alternatives](SPEC-alternatives.md) ([tasks](tasks/alternatives/todo.md)) · [digest](SPEC-digest.md) ([tasks](tasks/digest/todo.md)) · [pricing](SPEC-pricing.md) ([tasks](tasks/pricing/todo.md))

## Configuration

Copy `.env.example` to `.env` and fill it in. `.env` is gitignored; never commit it.

| Variable                            | How to set it                                                                                                               |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `POSTGRES_PASSWORD`                 | Any strong password. Use letters and digits only: it is embedded in a connection URL.                                       |
| `DATABASE_URL`                      | Local dev only: `postgres://rxplus:<POSTGRES_PASSWORD>@localhost:<DB_DEV_PORT>/rxplus`. Compose sets its own.               |
| `APP_PASSWORD_HASH`                 | `npm run hash-password` (asks for your login password, at least 12 characters).                                             |
| `SESSION_SECRET`                    | `node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"`                                       |
| `COOKIE_SECURE`                     | `false` on the LAN over plain HTTP.                                                                                         |
| `VITE_PRIMEUI_LICENSE`              | Your PrimeUI Community License key. Build-time: baked into the client bundle.                                               |
| `DB_DEV_PORT`                       | Host port for the dev database (default 5432; change it if that port is taken).                                             |
| `APP_PORT`                          | Host port for the app in Docker (default 3000).                                                                             |
| `RXNAV_BASE_URL`                    | Optional. RxNorm API base (default `https://rxnav.nlm.nih.gov/REST`). The e2e tests point it at a local stub.               |
| `OPENFDA_BASE_URL`                  | Optional. openFDA drug API base (default `https://api.fda.gov/drug`).                                                       |
| `OPENFDA_API_KEY`                   | Optional, free from open.fda.gov. Raises the keyless limit of 1,000 requests/day. Never logged.                             |
| `MEDLINEPLUS_BASE_URL`              | Optional. MedlinePlus Connect base (default `https://connect.medlineplus.gov/service`).                                     |
| `SUMMARY_PROVIDER`                  | `ollama` (default, local model) or `claude`. See [AI summaries](#ai-summaries).                                             |
| `OLLAMA_BASE_URL`                   | Local dev: `http://127.0.0.1:11434` (not `localhost`, which Node may resolve to IPv6). Compose sets its own.                |
| `OLLAMA_MODEL`                      | The Ollama model to use, e.g. `qwen2.5:7b`. Without it, summaries are unavailable (the rest of the page works).             |
| `OLLAMA_NUM_CTX`                    | Optional. Context window in tokens (default 16384); long labels need it.                                                    |
| `OLLAMA_TIMEOUT_MS`                 | Optional. Per-attempt time limit (default 600000, 10 minutes).                                                              |
| `ANTHROPIC_API_KEY`                 | Only for `SUMMARY_PROVIDER=claude`. Never logged.                                                                           |
| `AI_DAILY_LIMIT`                    | Optional. Claude requests per day: summaries, research and digest takeaways together (default 20). Not for the local model. |
| `OLLAMA_CHECK_MODEL`                | Optional. A (stronger) local model that checks each research takeaway against its quote. Off when unset.                    |
| `NCBI_API_KEY`                      | Optional, free from an NCBI account. Raises PubMed's limit from 3 to 10 requests/s. Never logged.                           |
| `NCBI_EMAIL`                        | Optional. Your contact address, sent to PubMed with `tool=rxplus` as NCBI asks.                                             |
| `PUBMED_BASE_URL`, `CTGOV_BASE_URL` | Optional. PubMed E-utilities and ClinicalTrials.gov API bases; the e2e tests point them at a local stub.                    |
| `COSTPLUS_BASE_URL`                 | Optional. Cost Plus Drugs public price API (default: its public endpoint); the e2e tests point it at a local stub.          |

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

### Drug pages

Each medication links to a page (`/drugs/<rxcui>`) with its drug class, uses and conditions to avoid it with (RxClass), the side effects most often reported to the FDA (FAERS, with a disclaimer that reports aren't frequencies), links to the FDA label on DailyMed and to MedlinePlus, and an AI summary of the label.

### AI summaries

An AI model rewrites the product's FDA label in plain language under five headings. Only the public label text is sent to the model. Every sentence must quote the label, and the server checks each quote against the label text before showing it. Sentences it can't link are marked "not linked to the label", and sentences telling you to start, stop or change a medication are removed. A summary is stored per label version and reused until the FDA label changes ("Check for a newer label").

**Local model (default): Ollama on the home server.** Generation takes a few minutes on a consumer GPU; the page shows progress and you can leave and come back.

```bash
curl -fsSL https://ollama.com/install.sh | sh   # installs Ollama as a systemd service
ollama pull qwen2.5:7b                          # ~4.7 GB
```

The app container reaches Ollama on the host through `host.docker.internal` (set up in `docker-compose.yml`), so Ollama must listen on all interfaces, not just localhost:

```bash
sudo systemctl edit ollama   # add the two lines below, save
#   [Service]
#   Environment="OLLAMA_HOST=0.0.0.0"
sudo systemctl restart ollama
```

This also opens port 11434 to your LAN. Ollama has no authentication, so keep the server LAN-only (or firewall the port to the Docker bridge). Then set `OLLAMA_MODEL=qwen2.5:7b` in `.env` and restart the app. For development on your PC, run Ollama locally and set `OLLAMA_BASE_URL=http://127.0.0.1:11434`.

**Claude (optional).** Set `SUMMARY_PROVIDER=claude` and `ANTHROPIC_API_KEY`. Summaries then use Claude Opus 5 with the label cited through the API's citations feature (about $0.10–0.20 each), capped at `AI_DAILY_LIMIT` per day. There is no automatic fallback between providers.

"Show quotes" on the summary shows every sentence's label quote inline.

### Research

Each drug page has a **Research** section per ingredient:

- **Papers:** up to 10 from PubMed, strongest evidence first: up to 4 meta-analyses or systematic reviews (the ingredient in the title or abstract), then randomized trials (the ingredient as a main topic), in PubMed's relevance order. Only papers with an abstract are listed, with links to PubMed and to the free full text when there is one.
- **Takeaways:** one plain-language line per paper, written by the same AI provider as the summaries from the paper's abstract (only abstracts are sent). The model picks one results or conclusion sentence and rewrites only that; the server checks that the sentence really is in that paper's abstract, and the page shows it right under the takeaway ("In the study: …") so you can compare. Takeaways it can't link are marked, and advice sentences are removed. All takeaways for a drug are written in one background call (about 4–5 minutes with `qwen2.5:7b`).
- **Trials:** up to 5 from ClinicalTrials.gov: completed with posted results, then recruiting.
- **Hide** a paper you don't find useful and the next one takes its place (Show hidden → Show again to undo).

Lists are stored and refreshed after 30 days, or with "Check for new research". New papers week to week are in [What's new](#whats-new).

### Alternatives

Each drug page has an **Alternatives** section: other drugs used for the same purpose, for awareness and for questions to bring to your prescriber. It is **not a recommendation**, and no AI is involved.

- **"Taken for":** set what you take a medication for in its edit dialog (or on its drug page), from the drug's known uses in MED-RT. The medication card shows "For: …".
- **New for that condition:** drugs first approved by the FDA in the last 5 years (Drugs@FDA), e.g. aprocitentan (2024) for hypertension.
- **Same class:** other drugs in the same FDA pharmacologic class (RxClass), e.g. the other ACE inhibitors.
- **Other classes for the condition:** grouped and collapsed by class (ARBs, calcium channel blockers, thiazides…).
- Each drug shows its first US approval year and whether a generic exists, and links to its own drug page. **Hide** removes one you don't care about ("Show hidden" to undo).

How the lists are made: MED-RT's drugs for the condition, reduced to ingredients with a US prescribable single-ingredient product. Drugs also listed for a more specific form (e.g. pulmonary arterial hypertension) are kept only if their FDA label mentions the plain condition. Lists are built in the background (about a minute the first time for a common condition), stored, shared by every drug taken for that condition, and refreshed after 30 days or with "Check for new approvals". Known gaps: combination-only drugs (e.g. sacubitril/valsartan) are not listed, some drugs lack an FDA class and appear under "Other", and MED-RT can lag new approvals.

### What's new

Once a week the app collects what changed for the medications you take (stopped ones are skipped) and shows it on **What's new**, with the number of unread items in the navigation (a dot on the menu button on phones). Opening the page marks them read. No email or notifications.

- **New papers:** papers entered in PubMed since the last digest with the ingredient in the title or abstract (new entries aren't indexed by topic or study type for weeks). The 5 most relevant per ingredient get a takeaway with its quote, as in Research; the rest are counted, with a link to the same search on PubMed.
- **Trials:** trials first posted, or with results first posted, on ClinicalTrials.gov since the last digest.
- **Newly listed drugs:** each condition your medications are taken for is rebuilt as in Alternatives; drugs that newly appear and were first approved in the last 5 years are reported.
- **Label changes:** a new FDA label version for a product you take (the drug page then writes a new summary).
- Nothing is reported twice. The first digest records the current condition lists and label versions without reporting them.

**When:** every Monday at 6:00 AM in the server's time zone (`TZ`). If the server was off then, the digest runs at the next start once the last one is more than a week old; a run cut off by a restart is marked failed and run again. **Run now** on the page starts one at any time (one at a time). A run takes a few minutes: about a minute per condition, plus one takeaway call per ingredient with new papers (live, four medications: 5 minutes with `qwen2.5:7b`). If a source or the model fails, the digest says what couldn't be checked; if the run itself fails, the page offers Try again.

### Prices and costs

- **Cash price:** from Mark Cuban Cost Plus Drug Company's public price API (no key; only ingredient names are sent). A product is priced only when a Cost Plus listing has one of the product's NDCs in RxNorm, never by name; otherwise the page says "Not sold at Cost Plus Drugs" (it carries mostly generics). Prices are Cost Plus's billed price per unit, cached for a day, with the time they were fetched. Cost Plus's per-order fees (pharmacy labor, shipping) are not included; the page says so and links to the product.
- **With insurance:** you enter your copay per fill (e.g. $10 for 90 tablets) in the medication's edit dialog or from the drug page. No plan rules are modeled.
- **Per month:** each medication has units per month (default 30, half units allowed). The drug page's **Prices** section and the **Costs** page show cash and copay per month and which is cheaper; the Costs page totals them and says what the totals leave out.

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
# edit .env: POSTGRES_PASSWORD, APP_PASSWORD_HASH, SESSION_SECRET, VITE_PRIMEUI_LICENSE,
#            OLLAMA_MODEL (after setting up Ollama, see "AI summaries")
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

## Backups

The `backup` service in Docker Compose dumps the database with `pg_dump` into `backups/` (or `BACKUP_DIR`): once when it starts if there's no dump for today, then every night at 3:00 AM (`BACKUP_HOUR`, server time zone). It keeps the newest 30 (`BACKUP_KEEP`). Each file is a complete copy (medications, research, digests, interaction data) in PostgreSQL's custom format, e.g. `rxplus-2026-09-28-175538.dump`.

- `backups/` holds personal data: it is gitignored; never commit or share it.
- The default folder is on the same disk as the database. That protects against a deleted volume or a bad update, not a failed disk: point `BACKUP_DIR` at another drive or a synced folder (e.g. `BACKUP_DIR=D:/RxPlus-backups`) for that.

```bash
docker compose logs backup                     # "[backup] wrote rxplus-….dump (92K)"
docker compose exec backup sh /backup.sh once  # back up now (e.g. before an update)
```

Restore a dump (this **replaces** the current data with the dump's):

```bash
docker compose stop app
docker compose exec -T db pg_restore -U rxplus -d rxplus --clean --if-exists --no-owner < backups/rxplus-2026-09-28-175538.dump
docker compose start app
```

To check a dump without touching the live data, restore it into a scratch database instead (`createdb -U rxplus restore_check`, then `-d restore_check`), look, and `dropdb` it.
