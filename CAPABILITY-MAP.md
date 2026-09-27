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

## Open, per module

- **interactions:** NIH retired the free RxNav interaction API in 2024. Proposed replacement (see [docs/research/free-data-sources.md](docs/research/free-data-sources.md)): DDInter 2.0 severity (CC BY-NC-SA, personal use) mapped to RxNorm, plus FDA label `drug_interactions` text. Needs approval in `SPEC-interactions.md`.

## Specs

- [SPEC-foundation.md](SPEC-foundation.md) (done)
- [SPEC-medications.md](SPEC-medications.md) (done, awaiting review)
- [SPEC-interactions.md](SPEC-interactions.md) (approved)
