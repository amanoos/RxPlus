# Capability Map: RxPlus

Source intent: [docs/intent/rx-tracker.md](docs/intent/rx-tracker.md). Approved 2026-09-26.

| Module id    | Responsibility                                                                                             | Depends on               |
| ------------ | ---------------------------------------------------------------------------------------------------------- | ------------------------ |
| foundation   | Analog app scaffold, PrimeNG + Tailwind, NgRx wiring, Drizzle + Postgres, single-user auth, Docker Compose | —                        |
| medications  | Add/edit/remove meds; RxNorm name resolution; strength                                                     | foundation               |
| drug-info    | Purpose, side effects, efficacy from openFDA/DailyMed; sourced AI summary                                  | medications              |
| interactions | Check a new drug against the current list; structured severity + AI explanation                            | medications              |
| literature   | Up to 10 key papers/trials per drug (PubMed, ClinicalTrials.gov)                                           | medications              |
| alternatives | Same-class and newly approved alternatives (RxClass, FDA approvals)                                        | medications              |
| pricing      | Published benchmark prices (NADAC, Medicare) + user-entered copays; cash vs. insured                       | medications              |
| digest       | Weekly scheduled job: new papers/alternatives, seen-tracking, in-app "What's new"                          | literature, alternatives |

Build order: foundation → medications → interactions → drug-info → literature → alternatives → digest → pricing

## Cross-cutting decisions

- Backend is Analog/Nitro server routes in the same app; no separate API service.
- Drizzle ORM + drizzle-kit migrations on PostgreSQL (home server).
- Single-user auth: one password (hash in env) + sealed session cookie. LAN only; remote access via the user's VPN/tunnel.
- Scheduled work runs as Nitro scheduled tasks in the app process.
- AI via the Claude API; outputs cached in Postgres, every claim linked to a source.
- Interaction severity comes from structured data, never from AI wording.
- Deployed with Docker Compose (app + postgres).

## Initiative: multi-user (approved 2026-09-28)

Separate accounts on the same home server, each with its own medication list. Replaces the single-user auth decision above.

| Module id            | Responsibility                                                                                                                                                            | Depends on            |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------- |
| accounts             | Users table, username + password login, session carries the user, admin CLI to add/reset/remove users                                                                     | foundation            |
| per-user-medications | Medications owned by one user; every reader of the list (medications, drug pages, prices, alternatives, interactions) scoped to the signed-in user; existing rows cleared | accounts, medications |
| per-user-hiding      | Hidden papers and hidden alternative drugs per user; paper and drug caches stay shared                                                                                    | accounts              |
| per-user-digest      | Digests, items and "already reported" tracking per user; the weekly task builds one digest per user                                                                       | per-user-medications  |

Build order: accounts → per-user-medications → per-user-hiding, per-user-digest (either order).

`per-user-interactions` was folded into `per-user-medications` (2026-09-29): scoping the repository already scopes the interaction routes.

Decisions:

- Accounts are created by an admin command on the server; no sign-up page, no admin UI, no roles.
- Existing data starts fresh: current medications (and what hangs off them per user) are cleared, not migrated.
- Shared, keyed by drug: drug info, label summaries, papers, trials, prices, the interaction database, alternatives lists.
- `AI_DAILY_LIMIT` stays one server-wide cap (one API key, one bill).
- Still LAN only; no internet exposure in this initiative.
- Deploy only when all four modules are done (2026-09-29): until then, lists, digests or hidden items would be shared between accounts.

## Open, per module

## Specs

- [SPEC-foundation.md](SPEC-foundation.md) (done)
- [SPEC-medications.md](SPEC-medications.md) (done, awaiting review)
- [SPEC-interactions.md](SPEC-interactions.md) (done, awaiting review)
- [SPEC-drug-info.md](SPEC-drug-info.md) (done, awaiting review)
- [SPEC-literature.md](SPEC-literature.md) (done, awaiting review)
- [SPEC-alternatives.md](SPEC-alternatives.md) (done, awaiting review)
- [SPEC-digest.md](SPEC-digest.md) (done)
- [SPEC-pricing.md](SPEC-pricing.md) (done)
- [SPEC-accounts.md](SPEC-accounts.md) (done)
- [SPEC-per-user-medications.md](SPEC-per-user-medications.md) (done)
- [SPEC-per-user-digest.md](SPEC-per-user-digest.md) (done)
- [SPEC-per-user-hiding.md](SPEC-per-user-hiding.md) (done)
