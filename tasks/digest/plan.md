# Implementation Plan: digest

Spec: [SPEC-digest.md](../../SPEC-digest.md) · Research: [free-data-sources](../../docs/research/free-data-sources.md) · Tasks: [todo.md](todo.md) · Previous: [alternatives](../alternatives/plan.md), [literature](../literature/plan.md), [drug-info](../drug-info/plan.md), [interactions](../interactions/plan.md), [medications](../medications/plan.md), [foundation](../foundation/plan.md)

## Overview

A weekly run (Monday 6:00 AM, catch-up after downtime, or "Run now") collects, for the active medications: new PubMed papers (5 per ingredient with takeaways, the rest counted), newly posted trials or results, drugs newly listed for the conditions they're taken for, and new FDA label versions. Shown on "What's new" with an unread badge.

## Architecture Decisions

- **Collectors are separate and small**, one per kind (papers, trials, approvals, labels), each `(context) → items + notes`. The run orchestrates them per ingredient/condition/product and stores one digest in a single transaction at the end, so a digest is never half-written.
- **Reuse, don't copy:** PubMed and ClinicalTrials.gov clients gain one "recent" query each; takeaways come from the literature takeaway provider and checks; approvals rebuild the alternatives condition lists through the existing builder and diff `alternative_drugs` before/after; labels use the openFDA client's `summaryLabel(rxcui, { refresh: true })`.
- **De-duplication by external id** (PMID, NCT id + event, ingredient for approvals, set id + version for labels) across digests.
- **Baselines** for approvals and labels: the first time a condition/product is seen, record it without reporting.
- **Scheduling** with Nitro scheduled tasks (`experimental.tasks`, cron `0 6 * * 1`, server `TZ`), plus a startup plugin for catch-up and interrupted runs. A run holds a row in `digests` with status `running` (one at a time by a partial unique index).
- **The page reads, the server runs:** `GET` never starts work; `POST /run` does.

## Dependency Graph

```
1 Client queries ─┐
2 Schema + repo ──┼─ 3 Papers + trials collectors ─┐
                  └─ 4 Approvals + labels collectors┴─ 5 Run, schedule, catch-up ── 6 Routes ── 7 NgRx ── 8 Page + badge
                                                                                               9 E2E ── 10 Coverage, README
```

## Task List

### Phase 1: Server

- [x] Task 1: PubMed recent papers and ClinicalTrials.gov recent updates
- [x] Task 2: Schema, migration 0005 and repository
- [x] Task 3: Papers and trials collectors
- [x] Task 4: Approvals and label collectors (baselines)
- [x] Task 5: Run orchestration, weekly schedule and catch-up
- [x] Task 6: Digest routes

### Checkpoint A

- [x] Unit and integration tests pass; migration applies
- [x] Live: a run over current medications (duration, counts per kind); a second run reports no repeats

### Phase 2: Client

- [x] Task 7: NgRx `digest` feature and API service
- [x] Task 8: "What's new" page and navigation badge

### Checkpoint B

- [x] Browser: badge, page groups, read tracking, Run now; 375px and desktop

### Phase 3: Verification

- [x] Task 9: E2E with stub entry-date search, trial updates, label and approval changes
- [x] Task 10: Coverage, README

### Checkpoint C: digest complete

- [x] Spec success criteria 1–8; live run reported
- [x] Human review, then `SPEC-pricing.md`

## Risks and Mitigations

| Risk                                             | Impact | Mitigation                                                                                           |
| ------------------------------------------------ | ------ | ---------------------------------------------------------------------------------------------------- |
| Nitro scheduled tasks are experimental           | Med    | Catch-up on startup covers missed runs; "Run now"; the task is a thin wrapper over a tested function |
| Long runs on the local model                     | Med    | 5 papers per ingredient, one call each; run in the background; one at a time                         |
| Weekly condition rebuilds are slow (~1 min each) | Low    | Only for conditions set as "taken for"; they refresh the alternatives lists too                      |
| Noisy trial updates                              | Low    | Only newly posted trials and newly posted results                                                    |
| Restart during a run                             | Low    | Startup marks it failed and catches up                                                               |

## Open Questions

- None blocking.
