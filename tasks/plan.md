# Implementation Plan: alternatives

Spec: [SPEC-alternatives.md](../SPEC-alternatives.md) · Research: [free-data-sources](../docs/research/free-data-sources.md) · Tasks: [todo.md](todo.md) · Previous: [literature](literature/plan.md), [drug-info](drug-info/plan.md), [interactions](interactions/plan.md), [medications](medications/plan.md), [foundation](foundation/plan.md)

## Overview

An **Alternatives** section on `/drugs/:rxcui`, per ingredient: drugs **newly approved** for the condition the medication is **taken for** (last 5 years), drugs in the **same class**, and **other classes** for that condition, each with first approval year, generic availability, a link to its drug page and Hide. Structured data only (RxClass, RxNav, Drugs@FDA, FDA labels); no AI.

## Architecture Decisions

- **Lists are keyed by what they describe, not by drug:** `class:<EPC id>` and `condition:<MED-RT id>`. Every drug in the class, or taken for the condition, reuses the same stored list; the drug page picks its lists and removes itself.
- **Building is a background job per list** (like summaries): many upstream calls (~100 ingredients × 2–4 calls for a condition), so `GET` returns stored lists or `pending`, and the page polls. Built lists live 30 days; "Check for new approvals" rebuilds.
- **Per-ingredient facts are cached separately** (`alternative_drugs` rows are per list, but the ingredient lookups—class, availability, Drugs@FDA facts—are memoized for the build and in the clients' 30-day caches), so a condition list and a class list share work.
- **The cleaning rule is a pure, tested function** over recorded inputs: candidates, their "more specific condition" memberships, and label indication text for only those in the overlap (so labels are fetched for ~20 drugs, not ~100).
- **Existing clients are extended, not duplicated:** RxNav client gains class/disease members, ingredient mapping, availability and a representative product; the openFDA client gains Drugs@FDA facts and label indications by ingredient name.
- **"Taken for" lives on `medications`** (two nullable columns) and is set through the existing PATCH route; the drug page falls back to a per-visit `?condition=` choice for products not on the list.
- **Request pacing:** RxNav calls are throttled to ≤ 20/s, openFDA to ≤ 4/s (240/min), serialized per client during builds.

## Dependency Graph

```
1 RxNav extensions ──┐
2 Drugs@FDA + labels ┼─ 4 List builder ── 5 Routes ──┐
3 Schema + repository┘                              ├─ 7 NgRx ── 8 Alternatives section
6 "Taken for" (server + medications UI) ────────────┘
                                          9 E2E ── 10 Coverage, README
```

## Task List

### Phase 1: Server

- [ ] Task 1: RxNav extensions (classes with ids, members, ingredient mapping, availability, representative product, uses with ids)
- [ ] Task 2: Drugs@FDA facts and label indications by ingredient
- [ ] Task 3: Schema, migration 0004 and repository
- [ ] Task 4: List builder: class and condition lists, cleaning rule, background jobs
- [ ] Task 5: Alternatives routes (lists, refresh, hide) and "Taken for" on medications

### Checkpoint A

- [ ] Unit and integration tests pass; migration applies
- [ ] Live: lisinopril for hypertension (build time, counts per group, noise check) and for heart failure

### Phase 2: Client

- [ ] Task 6: "Taken for" in the medication edit dialog and card
- [ ] Task 7: NgRx `alternatives` feature and API service
- [ ] Task 8: Alternatives section: chooser, groups, drug rows, hide, states, footer

### Checkpoint B

- [ ] Browser: chooser, groups, links, hide/undo, building state; 375px and desktop

### Phase 3: Verification

- [ ] Task 9: E2E with stub RxClass, Drugs@FDA and labels
- [ ] Task 10: Coverage, README, `.env.example`

### Checkpoint C: alternatives complete

- [ ] Spec success criteria 1–8; live counts reported
- [ ] Human review, then `SPEC-digest.md`

## Risks and Mitigations

| Risk                                                                 | Impact | Mitigation                                                                                                              |
| -------------------------------------------------------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------- |
| MED-RT "may treat" lists are noisy (other conditions, non-US, salts) | High   | Ingredient + availability filter, the specific-form rule with label check, Hide; measured per condition at Checkpoint A |
| First build is slow (~1 min) or hits rate limits                     | Med    | Background job with polling; pacing; per-ingredient memoization; partial failures counted, not fatal                    |
| openFDA daily quota (1,000/day without a key)                        | Med    | The owner has a key; builds reuse cached ingredient facts; 30-day lists                                                 |
| Drugs@FDA name matching (salts, metabolites, combinations)           | Med    | Exact "<name>" or "<name> <salt>" matching; tests incl. enalapril/enalaprilat                                           |
| "Taken for" changes the medications table                            | Low    | Nullable columns; migration test; existing medication tests unchanged                                                   |

## Open Questions

- None blocking.
