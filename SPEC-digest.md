# Spec: digest

Module of [CAPABILITY-MAP.md](CAPABILITY-MAP.md). Depends on: `medications`, `literature` (PubMed and ClinicalTrials.gov clients, takeaways), `alternatives` (condition lists), `drug-info` (FDA labels). Status: **approved 2026-09-27**.
Research basis: [docs/research/free-data-sources.md](docs/research/free-data-sources.md) §5–6, plus the queries measured below.

## Objective

Once a week, tell the owner **what changed for the medications they take**: new research, trial news, newly approved drugs for their conditions, and new FDA label versions. It appears in the app ("What's new"), with an unread count; no email or notifications.

**User story:** "On Monday morning the navigation shows **What's new (7)**. I open it and see, for lisinopril: one new paper with a plain-language takeaway and the sentence it's based on; a trial that just posted results; and, for hypertension, a newly listed drug approved this year. For atorvastatin: the 5 most relevant new papers with takeaways, and 'and 9 more on PubMed'. Opening the page marks them as read."

Out of scope: email/push notifications, alerts for stopped medications, AI overviews of the week, pricing.

## Decisions (2026-09-27)

1. Contents: new papers, trial updates, new approvals for your conditions, label changes.
2. Papers: the 5 most relevant new papers per ingredient get an AI takeaway (with its quote); the rest are counted with a link to see them all on PubMed.
3. Schedule: **Monday 6:00 AM** (America/New_York).
4. No AI overview of the week; takeaways only.

## What a run collects (verified 2026-09-27)

For each ingredient of the **active** medications (stopped ones are skipped), over the window since the previous run (the first run covers 7 days):

| Item              | Source                                                                                                                                                                            | Rule                                                                                                                                                                                                                                                                                                                                                                            |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **New papers**    | PubMed `esearch` `"<ingredient>"[tiab] AND hasabstract`, `datetype=edat`, `mindate`/`maxdate` (both needed), `sort=relevance`, `retmax=5`; details and abstracts as in literature | New entries aren't indexed with MeSH or publication types for weeks: `[majr]` and `[pt]` filters return 0 for the past month, so the digest searches title/abstract only. Measured, last 7 days: lisinopril 0, spironolactone 6, atorvastatin 14, metformin 56. A PMID already reported in an earlier digest is skipped. The rest of the count links to the same PubMed search. |
| **Trial updates** | ClinicalTrials.gov `query.intr=<ingredient>`, `filter.advanced=AREA[LastUpdatePostDate]RANGE[<window start>,MAX]`                                                                 | Reported only when the trial was **first posted** in the window, or **first posted results** in the window (`StudyFirstPostDate`, `ResultsFirstPostDate`); other updates are noise.                                                                                                                                                                                             |
| **New approvals** | The alternatives condition list for each condition the medications are **taken for**, rebuilt by the run                                                                          | Drugs that appear in the rebuilt list but weren't in the previous one, and are "new" by the alternatives rule (first approved within 5 years). MED-RT can list a drug months after approval, so "newly listed" is used rather than "approved this week". The first run records a baseline only.                                                                                 |
| **Label changes** | openFDA newest label per active medication product (as the drug page uses)                                                                                                        | A new label version (set id or version differs from the one recorded). The first run records the current versions only. The drug page then writes a new summary on the next visit (summaries are stored per label version).                                                                                                                                                     |

- **Takeaways:** the literature takeaway provider and checks (quote from that paper's abstract, shown inline; advice removed; unverified marked), one call per ingredient for up to 5 papers. A takeaway failure lists the papers without takeaways, with a note. Claude calls count toward `AI_DAILY_LIMIT`.
- **Duration:** about 2–5 minutes per ingredient with new papers on the local model; the GPU is idle at 6 AM.

## Scheduling

- A Nitro scheduled task (`experimental.tasks`, `scheduledTasks: { '0 6 * * 1': ['digest:weekly'] }`), in the server's time zone (`TZ=America/New_York`).
- **Catch-up:** if the server was off at that time, the run starts at the next startup when the last successful run is more than 7 days old.
- **One run at a time**; a run left `running` by a restart is marked failed at startup (and caught up).
- **"Run now"** on the page starts a run in the background (e.g. after adding a medication).

## Data model (Drizzle, `src/server/db/schema/digest.ts`, migration `0005_*`)

```ts
digests = pgTable('digests', {
  id: uuid().primaryKey().defaultRandom(),
  status: text({ enum: ['running', 'ready', 'failed'] }).notNull(),
  trigger: text({ enum: ['schedule', 'manual', 'catch-up'] }).notNull(),
  windowStart: date().notNull(),
  windowEnd: date().notNull(),
  startedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp({ withTimezone: true }),
  error: text(),
  notes: jsonb().$type<string[]>(), // e.g. "Takeaways for metformin couldn't be written"
});

digestItems = pgTable('digest_items', {
  id: uuid().primaryKey().defaultRandom(),
  digestId: uuid().notNull(),
  kind: text({ enum: ['paper', 'more-papers', 'trial', 'approval', 'label'] }).notNull(),
  ingredientRxcui: text(),
  productRxcui: text(),
  conditionId: text(),
  subject: text().notNull(), // drug or condition name the item is about
  title: text().notNull(),
  url: text().notNull(),
  details: jsonb(), // journal/year, trial status/phase, approval year, label date, count…
  takeaway: jsonb().$type<PaperTakeaway>(),
  externalId: text(), // PMID / NCT id / ingredient rxcui / set_id+version, for de-duplication
  readAt: timestamp({ withTimezone: true }),
});

digestLabelVersions = pgTable('digest_label_versions', {
  productRxcui: text().primaryKey(),
  setId: text().notNull(),
  version: text().notNull(),
  checkedAt: timestamp({ withTimezone: true }).notNull(),
});
```

Condition-list snapshots for "newly listed" come from `alternative_drugs` before and after the rebuild.

## API (session required)

| Method and path                 | Purpose                                                                                       | Response                   |
| ------------------------------- | --------------------------------------------------------------------------------------------- | -------------------------- |
| `GET /api/digests`              | Digests newest first (up to 12 weeks), with items grouped by drug, and the running one if any | 200                        |
| `GET /api/digests/unread-count` | For the navigation badge                                                                      | 200 `{ count }`            |
| `POST /api/digests/run`         | Run now (background)                                                                          | 202; 409 if one is running |
| `POST /api/digests/:id/read`    | Mark a digest's items as read                                                                 | 204                        |

## UI

- **Navigation:** the existing "Digest" link becomes **"What's new"** with an unread badge (count of unread items), refreshed on navigation.
- **`/digest` page:** the latest digest open, earlier ones collapsed ("Week of Sep 21: 4 items"). Within a digest, grouped by drug: papers (title → PubMed, journal · year, takeaway with its quote inline, "not linked" marking), "and N more on PubMed", trials (NCT id, title → ClinicalTrials.gov, "New trial" / "Results posted"), approvals ("Newly listed for hypertension: X (approved 2026)" → drug page), label changes ("New FDA label for …, dated …" → drug page and DailyMed).
- **Read tracking:** items are highlighted until read; opening the page marks the displayed digests read after they load (the badge clears).
- **States:** "Next digest: Monday 6:00 AM"; running ("Collecting this week's news… started 6:00") with polling; failed with Try again; empty week ("Nothing new this week for your medications"); no active medications.
- **Run now** button (disabled while running).

## Testing

- **Unit:** PubMed entry-date query (both dates, title/abstract only, relevance, 5 + count, PubMed search link); ClinicalTrials.gov update filter and the new/results rule; newly-listed approval diff; label version diff with baseline; window computation; grouping for the page; badge count.
- **Integration (test DB):** migration; a full run with stubbed clients (items per kind, dedupe across runs, baselines on first run, takeaway failure note, one run at a time, interrupted run marked failed, catch-up decision); routes (list, unread count, run 202/409, mark read).
- **E2E:** the stub server gains an entry-date PubMed search, trial updates, a changed label version and a newly listed drug; the spec runs the digest with "Run now", sees the badge, opens What's new, sees each kind of item, and the badge clears.
- **Live check at the checkpoint:** a run over the current medications (duration, counts per kind).
- **Coverage:** ≥ 80% lines on `src/server/digest`, `src/app/features/digest`.

## Boundaries

- **Always:** show every item's source link; show takeaways with their quote; skip stopped medications; record baselines before reporting changes; one run at a time.
- **Ask first:** adding notifications of any kind; changing the schedule or the paper cap; an AI overview.
- **Never:** send the medication list, notes or conditions to an AI model (only abstracts); report the same PMID/NCT/label twice; block page loads on a run.

## Success criteria

1. A scheduled run at Monday 6:00 AM (or a catch-up after downtime, or Run now) produces a digest for the active medications.
2. New papers: up to 5 per ingredient with takeaways and inline quotes, the rest counted with a working PubMed link; no PMID repeats across digests.
3. Trials appear only when newly posted or with newly posted results in the window.
4. A drug newly listed for a medication's "taken for" condition and approved within 5 years appears once; the first run reports none (baseline).
5. A new FDA label version for an active medication appears once; the first run records a baseline.
6. The navigation shows the unread count; opening What's new clears it.
7. Failures (upstream or AI) leave a readable note or a failed run with Try again, never a half-written digest; the rest of the app is unaffected.
8. Lint, unit, integration and e2e tests pass; coverage targets are met.

## Open questions

- None blocking.
