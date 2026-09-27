# Intent: RxPlus — Personal Medication Watchlist

Confirmed with user on 2026-09-26 via interview.

- **Outcome:** A personal medication watchlist. Adding a drug (name + strength) flags interactions with current meds, explains purpose, side effects, and efficacy, and links up to 10 key papers/trials per drug.
- **Ongoing:** A weekly in-app digest of new studies and new or alternative drugs for each current med, AI-summarized with every claim linked to its source.
- **Prices:** Awareness only: published prices, cash vs. insured, compared across providers. No purchasing.
- **User:** Only the owner. Single user, light auth, no sharing.
- **Success:** Adding a new prescription shows interaction risk within seconds; the weekly digest shows whether anything changed for the current meds.
- **Constraint:** Angular + PrimeNG + Tailwind + NgRx + AnalogJS (SSR/SSG) is required; this is a learning project. Interaction severity comes from structured data, never from AI wording.
- **Out of scope:** Purchasing, email/push notifications, multi-user, dose/refill reminders, sharing with doctors, mobile apps.
- **Hosting & data:** PostgreSQL on the user's always-on home server, which also runs the weekly digest job.

## Known risk

Drug facts, interactions, and studies are available from free sources (RxNorm, openFDA, DailyMed, PubMed, ClinicalTrials.gov). Pricing is not: there is no open retail pricing API. Expect official benchmarks (e.g. Medicare averages) plus manually entered copays. This is the weakest feature.
