# RxPlus

A medication watchlist for you and your household that runs on your own computer or home server. Each person signs in to their own list of the prescriptions they take and their strengths, and sees:

- what each drug is for, its FDA label in plain language, and the side effects most often reported
- interactions between your medications
- up to 10 research papers and current clinical trials per drug, with plain-language takeaways
- other drugs for the same condition, including newly approved ones
- cash prices at Cost Plus Drugs next to what your insurance copay costs you
- a weekly **What's new** digest: new papers, trial results, newly listed drugs and FDA label changes

It is for information and for questions to bring to your prescriber or pharmacist. It never recommends starting, stopping or switching a medication.

Built with [Analog](https://analogjs.org) (Angular + SSR), PrimeNG, Tailwind CSS, NgRx, Drizzle and PostgreSQL.

- [Run the app (users)](#run-the-app-users)
- [Develop (developers)](#develop-developers)
- [Configuration reference](#configuration-reference)
- [How it works](#how-it-works)
- [Accounts](#accounts)
- [Backups](#backups)

## Run the app (users)

The app runs in Docker: one container for the app, one for its PostgreSQL database, and one that backs the database up every night. Each person signs in with their own account, which whoever runs the server creates. It's meant for your home network, not the internet.

### 1. Install the prerequisites

| What                  | Why                                                                                        | Where                                                                                                                                                                         |
| --------------------- | ------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Docker**            | Runs the app and its database                                                              | Windows or macOS: [Docker Desktop](https://www.docker.com/products/docker-desktop/). Linux: [Docker Engine](https://docs.docker.com/engine/install/) with the Compose plugin. |
| **Git**               | Downloads the app                                                                          | [git-scm.com](https://git-scm.com/downloads)                                                                                                                                  |
| **Ollama** (optional) | Free local AI for drug summaries and takeaways; needs a GPU with about 8 GB for good speed | [ollama.com/download](https://ollama.com/download), then `ollama pull qwen2.5:7b`. See [AI summaries](#ai-summaries).                                                         |

Disk space: about 2 GB for the app, plus 5–10 GB per local AI model. Your own data stays under about 100 MB after years of use.

### 2. Download and configure

```bash
git clone https://github.com/amanoos/my-tracker.git rxplus
cd rxplus
cp .env.example .env
```

Open `.env` in a text editor. Every setting is explained there, including how to get each optional key. You need to fill in three values:

1. **`SESSION_SECRET`**: at least 32 random characters, e.g. from `openssl rand -base64 32`.
2. **`POSTGRES_PASSWORD`**: any strong password (letters and digits only) for the database.
3. **`VITE_PRIMEUI_LICENSE`**: the free PrimeUI Community License key (sign-up link in `.env`). The app also works without it.

Accounts aren't set in `.env`: you create them after the first start (step 3).

Optional, all explained in `.env`:

- **AI:** `OLLAMA_MODEL`, and/or an Anthropic API key for Claude.
- **Higher rate limits:** free openFDA and NCBI keys.
- **Backup folder:** `BACKUP_DIR`.

### 3. Start it

```bash
docker compose up -d --build
docker compose run --rm app node dist/ddi-import.cjs   # drug interaction data, one time, about 5 minutes
```

The first command builds the app (a few minutes the first time), creates the database and starts everything. The second loads the DDInter interaction data; rerun it only when DDInter publishes a new release.

Check that it's running:

```bash
docker compose ps                     # app and backup running, db healthy
curl http://localhost:3000/api/health # {"status":"ok","db":"ok"}
```

Create an account for each person (usernames are 3–32 letters, digits, `.`, `_` or `-`; passwords at least 12 characters):

```bash
docker compose exec app node dist/user.cjs add alice   # asks for the password twice
docker compose exec app node dist/user.cjs list
```

Until there is at least one account, `docker compose logs app` shows a "No accounts yet" line with this command. See [Accounts](#accounts) to reset a password or remove an account.

Open **http://localhost:3000** (or your `APP_PORT`) and sign in with your username and password.

### 4. First steps in the app

1. **Medications:** add each prescription (search the drug, then pick the exact product and strength).
2. **Edit** each one to set what it's **taken for**, **units per month** and, if you have insurance, your **copay per fill**. "Taken for" drives the alternatives shown and the digest's watch for new drugs; units and copay drive the Costs page.
3. Open a medication's **About this drug** page: facts, the AI label summary, research, alternatives and prices. The first visit builds these in the background, taking one to a few minutes.
4. **What's new:** press **Run now** for your first digest, or wait for Monday 6:00 AM.

### 5. Use it from your phone or tablet (optional)

Other devices on your home network can use **http://\<computer-ip\>:3000**. Give the computer a fixed IP address, either a DHCP reservation in your router or a static address. Then allow port 3000 in the firewall, from your home network only, in an administrator shell:

- **Windows with Docker Desktop:** if `%USERPROFILE%\.wslconfig` has `networkingMode=mirrored`, the port belongs to WSL and needs a Hyper-V firewall rule:
  ```powershell
  New-NetFirewallHyperVRule -Name "RxPlus-LAN" -DisplayName "RxPlus (LAN only)" -Direction Inbound -VMCreatorId "{40E0AC32-46A5-438A-A0B2-2B479E8F2E90}" -Protocol TCP -LocalPorts 3000 -RemoteAddresses 192.168.1.0/24 -Action Allow
  ```
  Otherwise, use a Windows Firewall rule:
  ```powershell
  New-NetFirewallRule -DisplayName "RxPlus (LAN only)" -Direction Inbound -Protocol TCP -LocalPort 3000 -RemoteAddress 192.168.1.0/24 -Action Allow -Profile Any
  ```
- **Linux:** `sudo ufw allow from 192.168.1.0/24 to any port 3000 proto tcp`

Replace `192.168.1.0/24` with your network's range. With mirrored networking, the computer itself can't open its own LAN address; test from another device. Keep the app off the internet: the database and a local Ollama have no protection of their own beyond your network.

### 6. Keep it running and up to date

- The app restarts by itself with Docker. It only runs while the computer is on and awake, so turn off sleep on the machine that hosts it. A digest missed while it was off runs at the next start.
- **Update** to a new version:
  ```bash
  docker compose exec backup sh /backup.sh once   # a backup first
  git pull
  docker compose up -d --build                     # database migrations run automatically
  ```
- **Upgrading from the single-password version** (separate accounts). The upgrade clears the medication list and the What's new history, because they belonged to no account; research, label summaries, alternatives and interaction data stay. In order:
  1. Take a backup (`docker compose exec backup sh /backup.sh once`) and write down your medications, with what each is taken for, units per month and copay.
  2. `git pull`, then `docker compose up -d --build`.
  3. Create an account for each person (step 3, `docker compose exec app node dist/user.cjs add <username>`).
  4. Remove `APP_PASSWORD_HASH` from `.env`.
  5. Sign in and add your medications again; everyone signs in once more.
- Clean up old Docker layers every few months: `docker image prune` and `docker builder prune`.
- Your data lives in the `rxplus_db-data` Docker volume. `docker compose down` keeps it; `docker compose down -v` **deletes it**. See [Backups](#backups).
- `POSTGRES_PASSWORD` is fixed when the database is first created; changing it later in `.env` doesn't change the database's password. Changing `VITE_PRIMEUI_LICENSE` needs a rebuild (`--build`).

### Linux home server with Ollama

On Linux, install Ollama with `curl -fsSL https://ollama.com/install.sh | sh`. The app container reaches it through `host.docker.internal`, so Ollama must listen on all interfaces:

```bash
sudo systemctl edit ollama   # add the two lines below, save
#   [Service]
#   Environment="OLLAMA_HOST=0.0.0.0"
sudo systemctl restart ollama
```

This also opens port 11434 to your network. Ollama has no authentication, so keep the server LAN-only, or firewall the port to the Docker bridge. On Windows and macOS, Docker Desktop reaches a local Ollama without this.

## Develop (developers)

### Prerequisites

- **Node.js 24** (see `.nvmrc`; `nvm use` picks it up)
- **Docker**, for the development and test databases
- **Google Chrome**, for the Playwright end-to-end tests
- **Ollama** (optional), only to work on AI features against a real model. Everything else runs against stubs.

### Set up

```bash
git clone https://github.com/amanoos/my-tracker.git rxplus && cd rxplus
npm ci
cp .env.example .env     # fill in section 1 and 2 (see "Run the app"); DATABASE_URL points at the dev database
npm run db:up            # dev PostgreSQL on localhost:${DB_DEV_PORT}
npm run db:migrate       # create the tables
npm run ddi:import       # optional: interaction data (~5 minutes)
npm run user -- add me   # an account to sign in with (asks for the password)
npm run dev              # http://localhost:5173
```

To run the Docker app alongside development, keep the dev database's port by including the dev overlay:

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d --build app
```

A plain `docker compose up` recreates the database container without the port that `npm run dev` uses.

### Project layout

| Path                                  | What                                                                                                                                                                      |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/app/`                            | Angular client: `pages/` (file-based routes), `features/<module>/` (components, NgRx store, API services), `core/` (auth, layout)                                         |
| `src/server/`                         | Nitro server: `routes/api/` (file-based API routes), one folder per module (service, repository, upstream client), `db/schema/`, `plugins/`, `tasks/` (the weekly digest) |
| `drizzle/`                            | SQL migrations generated from `src/server/db/schema`                                                                                                                      |
| `scripts/`                            | Password hash, DDInter import, migrations runner, backup script                                                                                                           |
| `e2e/`                                | Playwright specs and the stub server that stands in for every upstream API                                                                                                |
| `SPEC-<module>.md`, `tasks/<module>/` | The spec and task plan behind each module; [CAPABILITY-MAP.md](CAPABILITY-MAP.md) lists the modules and build order                                                       |
| `docs/`                               | [Intent](docs/intent/rx-tracker.md) and [research on the data sources](docs/research/free-data-sources.md)                                                                |

Framework conventions for Analog (routing, server routes, data fetching) are in `node_modules/@analogjs/platform/AGENTS.md`; [AGENTS.md](AGENTS.md) points AI assistants there.

### Tests

```bash
npm test               # unit tests (no database needed)
npm run db:test:up     # throwaway PostgreSQL on localhost:5433 (in memory)
npm run test:int       # integration tests against it
npm run e2e            # test DB + production build + Playwright (installed Chrome; stubbed upstream APIs and AI)
npm run test:coverage  # unit + integration with coverage (needs the test DB); 80% lines minimum
npm run lint
npm run db:test:down
```

Integration and e2e tests reset tables in the test database, including any DDInter import there, so use the dev database for manual checks. Always run `npm run build` before committing UI changes: it type-checks templates, which `tsc` doesn't.

### Database migrations

```bash
npm run db:generate  # after changing src/server/db/schema/*: writes SQL to drizzle/
npm run db:migrate   # apply to the dev database
```

Commit the generated `drizzle/` files with the schema change. In Docker, migrations run automatically when the app container starts, before the server; if they fail, the container exits and the server never starts.

### Rules of the codebase

- Never commit `.env`, API keys, backups or DDInter data.
- AI never gives dosing or start/stop advice and never sets interaction severity; only public label text and paper abstracts are sent to models.
- Alternatives never rank drugs or recommend switching.

## Configuration reference

All settings live in `.env`. [`.env.example`](.env.example) explains each one and how to get the optional keys. The server refuses to start if a required value is missing or invalid, and names the variable.

| Variable                                                                                                               | Required | Purpose                                                                                             |
| ---------------------------------------------------------------------------------------------------------------------- | -------- | --------------------------------------------------------------------------------------------------- |
| `SESSION_SECRET`                                                                                                       | yes      | Signs the session cookie; at least 32 random characters                                             |
| `POSTGRES_PASSWORD`                                                                                                    | yes      | Database password (letters and digits only)                                                         |
| `DATABASE_URL`                                                                                                         | dev only | `postgres://rxplus:<POSTGRES_PASSWORD>@localhost:<DB_DEV_PORT>/rxplus`; Docker Compose sets its own |
| `COOKIE_SECURE`                                                                                                        |          | `true` only over HTTPS (default `false`)                                                            |
| `PORT`, `APP_PORT`                                                                                                     |          | Server port (3000) and the host port Docker publishes (3000)                                        |
| `DB_DEV_PORT`                                                                                                          |          | Host port of the dev database (default 5432)                                                        |
| `TZ`                                                                                                                   |          | Time zone for the weekly digest and nightly backup (default `America/New_York`)                     |
| `VITE_PRIMEUI_LICENSE`                                                                                                 |          | PrimeUI Community License key; build-time                                                           |
| `OPENFDA_API_KEY`                                                                                                      |          | Free; raises openFDA from 1,000 to 120,000 requests a day                                           |
| `NCBI_API_KEY`, `NCBI_EMAIL`                                                                                           |          | Free; raises PubMed from 3 to 10 requests a second; contact email NCBI asks for                     |
| `SUMMARY_PROVIDER`                                                                                                     |          | `ollama` (default) or `claude`, for drug label summaries                                            |
| `TAKEAWAY_PROVIDER`                                                                                                    |          | `ollama` or `claude`, for research and digest takeaways (default: `SUMMARY_PROVIDER`)               |
| `OLLAMA_BASE_URL`                                                                                                      |          | Dev: `http://127.0.0.1:11434` (not `localhost`); Docker Compose sets its own                        |
| `OLLAMA_MODEL`                                                                                                         |          | Local model, e.g. `qwen2.5:7b`; empty turns local AI off                                            |
| `OLLAMA_TAKEAWAY_MODEL`                                                                                                |          | Local model for takeaways (default `OLLAMA_MODEL`), e.g. `qwen3:8b`                                 |
| `OLLAMA_CHECK_MODEL`                                                                                                   |          | A stronger local model that double-checks takeaways; off when unset                                 |
| `OLLAMA_NUM_CTX`, `OLLAMA_TIMEOUT_MS`                                                                                  |          | Context window (16384) and per-call time limit (600000 ms)                                          |
| `ANTHROPIC_API_KEY`                                                                                                    |          | For Claude (paid); never logged                                                                     |
| `AI_DAILY_LIMIT`                                                                                                       |          | Most Claude requests a day, summaries and takeaways together (default 20)                           |
| `JEV_API_KEY`                                                                                                          |          | TypeSafe Jev key; checks local takeaways, labels who was studied when the words don't say           |
| `JEV_PROVIDER`, `JEV_BASE_URL`, `JEV_TIMEOUT_MS`                                                                       |          | `typesafe` (default) or `gateway`; service address; time limit per check (30000 ms)                 |
| `BACKUP_DIR`, `BACKUP_KEEP`, `BACKUP_HOUR`                                                                             |          | Backup folder (`./backups`), how many to keep (30), hour of the nightly dump (3)                    |
| `RXNAV_BASE_URL`, `OPENFDA_BASE_URL`, `MEDLINEPLUS_BASE_URL`, `PUBMED_BASE_URL`, `CTGOV_BASE_URL`, `COSTPLUS_BASE_URL` |          | Upstream API bases; defaults are the public services. The e2e tests point them at a stub            |

## How it works

### Drug data

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

**Local model (default): Ollama.** Generation takes a few minutes on a consumer GPU; the page shows progress and you can leave and come back. Install Ollama, `ollama pull qwen2.5:7b` (~4.7 GB), and set `OLLAMA_MODEL=qwen2.5:7b`. For a Linux server, see [Linux home server with Ollama](#linux-home-server-with-ollama).

**Claude (optional).** Set `SUMMARY_PROVIDER=claude` and `ANTHROPIC_API_KEY`. Summaries then use Claude Opus 5 with the label cited through the API's citations feature (about $0.10–0.20 each), capped at `AI_DAILY_LIMIT` per day. There is no automatic fallback between providers.

"Show quotes" on the summary shows every sentence's label quote inline.

### Research

Each drug page has a **Research** section per ingredient:

- **Papers:** up to 10 from PubMed, strongest evidence first: up to 4 meta-analyses or systematic reviews (the ingredient in the title or abstract), then randomized trials (the ingredient as a main topic), in PubMed's relevance order. Only papers with an abstract are listed, with links to PubMed and to the free full text when there is one.
- **Takeaways:** one plain-language line per paper, written by AI from the paper's abstract. Only abstracts are sent. `TAKEAWAY_PROVIDER` or `OLLAMA_TAKEAWAY_MODEL` choose the model; otherwise it's the summaries' one.
  - The model picks one results or conclusion sentence and rewrites only that. The server checks that the sentence really is in that paper's abstract, and the page shows it right under the takeaway ("In the study: …") so you can compare.
  - Takeaways it can't link are marked, advice sentences are removed, and takeaways worded as if about you are flagged.
  - Each paper is labeled with who was studied (people, animals, lab, review), read from its abstract.
  - All takeaways for a drug are written in one background call: about 4–5 minutes with a local model, well under a minute with Claude.
- **Trials:** up to 5 from ClinicalTrials.gov: completed with posted results, then recruiting.
- **Hide** a paper you don't find useful and the next one takes its place (Show hidden → Show again to undo). Hides are yours alone: others who take the drug still see it.

Lists are stored and refreshed after 30 days, or with "Check for new research". New papers week to week are in [What's new](#whats-new).

### Alternatives

Each drug page has an **Alternatives** section: other drugs used for the same purpose, for awareness and for questions to bring to your prescriber. It is **not a recommendation**, and no AI is involved.

- **"Taken for":** set what you take a medication for in its edit dialog (or on its drug page), from the drug's known uses in MED-RT. The medication card shows "For: …".
- **New for that condition:** drugs first approved by the FDA in the last 5 years (Drugs@FDA), e.g. aprocitentan (2024) for hypertension.
- **Same class:** other drugs in the same FDA pharmacologic class (RxClass), e.g. the other ACE inhibitors.
- **Other classes for the condition:** grouped and collapsed by class (ARBs, calcium channel blockers, thiazides…).
- Each drug shows its first US approval year and whether a generic exists, and links to its own drug page. **Hide** removes one you don't care about ("Show hidden" to undo), for you only.

How the lists are made: MED-RT's drugs for the condition, reduced to ingredients with a US prescribable single-ingredient product. Drugs also listed for a more specific form (e.g. pulmonary arterial hypertension) are kept only if their FDA label mentions the plain condition. Lists are built in the background (about a minute the first time for a common condition), stored, shared by every drug taken for that condition, and refreshed after 30 days or with "Check for new approvals". Known gaps: combination-only drugs (e.g. sacubitril/valsartan) are not listed, some drugs lack an FDA class and appear under "Other", and MED-RT can lag new approvals.

### What's new

Once a week the app collects what changed for the medications each person takes (stopped ones are skipped) and shows it on their **What's new**, with the number of unread items in the navigation (a dot on the menu button on phones). Each account has its own digests, unread count and "already reported" list, built from its own medications only; no one sees another person's digest. Opening the page marks them read. No email or notifications.

- **New papers:** papers entered in PubMed since the last digest with the ingredient in the title or abstract (new entries aren't indexed by topic or study type for weeks). The 5 most relevant per ingredient get a takeaway with its quote, as in Research; the rest are counted, with a link to the same search on PubMed.
- **Trials:** trials first posted, or with results first posted, on ClinicalTrials.gov since the last digest.
- **Newly listed drugs:** each condition your medications are taken for is rebuilt as in Alternatives; drugs that newly appear and were first approved in the last 5 years are reported.
- **Label changes:** a new FDA label version for a product you take (the drug page then writes a new summary).
- Nothing is reported twice to the same person. Their first digest records the current condition lists and label versions without reporting them.
- A paper's takeaway is about the paper, so when a second person's digest finds a paper someone else's digest already has, it reuses that takeaway instead of asking the model again.

**When:** every Monday at 6:00 AM in the server's time zone (`TZ`), for each account with an active medication, one after another. If the server was off then, each person's digest runs at the next start once their last one is more than a week old; a run cut off by a restart is marked failed and run again. **Run now** on the page starts that person's digest at any time (one at a time per person). A run takes a few minutes: about a minute per condition, plus one takeaway call per ingredient with new papers. If a source or the model fails, the digest says what couldn't be checked; if the run itself fails, the page offers Try again.

### Prices and costs

- **Cash price:** from Mark Cuban Cost Plus Drug Company's public price API (no key; only ingredient names are sent). A product is priced only when a Cost Plus listing has one of the product's NDCs in RxNorm, never by name; otherwise the page says "Not sold at Cost Plus Drugs" (it carries mostly generics). Prices are Cost Plus's billed price per unit, cached for a day, with the time they were fetched. Cost Plus's per-order fees (pharmacy labor, shipping) are not included; the page says so and links to the product.
- **With insurance:** you enter your copay per fill (e.g. $10 for 90 tablets) in the medication's edit dialog or from the drug page. No plan rules are modeled.
- **Per month:** each medication has units per month (default 30, half units allowed). The drug page's **Prices** section and the **Costs** page show cash and copay per month and which is cheaper; the Costs page totals them and says what the totals leave out.

See [docs/research/free-data-sources.md](docs/research/free-data-sources.md) for the sources considered.

## Accounts

Each person has a username and password. There's no sign-up page: accounts are managed with a command on the server (in development, `npm run user -- <command>` instead of `docker compose exec app node dist/user.cjs <command>`):

```bash
docker compose exec app node dist/user.cjs add <username>              # new account; asks for the password twice
docker compose exec app node dist/user.cjs reset-password <username>   # new password; signs them out everywhere
docker compose exec app node dist/user.cjs remove <username>           # asks you to type the name; add --yes to skip
docker compose exec app node dist/user.cjs list                        # usernames and creation dates
```

- Usernames ignore case (`Alice` signs in as `alice`) and are 3–32 letters, digits, `.`, `_` or `-`. Passwords are at least 12 characters, stored only as scrypt hashes.
- A wrong password and an unknown username get the same answer, "Invalid username or password.". After 5 failures in 15 minutes that username is locked for the rest of the window; after 20 failures across all usernames, every sign-in is.
- Each account has its own medication list, and everything built from it is that person's alone: the dashboard, interactions, prices and costs, what a drug is taken for, and the weekly What's new digest. Research, label summaries and alternatives are shared, since they're about the drug, not the person; what each person hides from them is their own. Removing an account deletes its medications, digests and hides.
- Signing out ends the session in that browser only. A password reset or a removed account ends every session of that person on their next request.

## Backups

The `backup` service in Docker Compose dumps the database with `pg_dump` into `backups/` (or `BACKUP_DIR`): once when it starts if there's no dump for today, then every night at 3:00 AM (`BACKUP_HOUR`, server time zone). It keeps the newest 30 (`BACKUP_KEEP`). Each file is a complete copy (medications, research, digests, interaction data) in PostgreSQL's custom format, e.g. `rxplus-2026-09-28-175538.dump`.

- `backups/` holds personal data: it is gitignored; never commit or share it.
- Keep backups on a different disk from Docker's data (on Windows, Docker Desktop keeps it on C:), so a failed disk doesn't take both. For protection against losing the whole computer, point `BACKUP_DIR` at a synced folder (e.g. `BACKUP_DIR=D:/RxPlus-backups`).

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
