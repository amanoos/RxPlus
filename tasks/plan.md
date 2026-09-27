# Implementation Plan: interactions

Spec: [SPEC-interactions.md](../SPEC-interactions.md) · Research: [free-data-sources](../docs/research/free-data-sources.md) · Tasks: [todo.md](todo.md) · Previous: [medications](medications/plan.md), [foundation](foundation/plan.md)

## Overview

Check a new prescription, or the current list, for drug–drug interactions:

- **Severity:** from DDInter 2.0, imported into Postgres and mapped to RxNorm ingredients.
- **Explanation:** verbatim FDA label sentences from openFDA.
- **Where it shows:** `/interactions`, the add-medication dialog, and a dashboard line.

## Architecture Decisions

- **Import, don't query live:** DDInter has no API. A one-off `ddi:import` command downloads the CSVs, maps names through the existing RxNav client (new `ingredientByName`), and replaces the three `ddi_*` tables in one transaction. It's bundled like `migrate.cjs` so it runs in the container.
- **Pure core, thin I/O:** CSV parsing, route-suffix parsing, report building (matching rules, notCovered) and label sentence matching are pure functions tested exhaustively. Queries and HTTP clients stay thin.
- **One openFDA client** (`src/server/openfda/client.ts`) mirrors the RxNav client: base URL from `OPENFDA_BASE_URL` (optional; default `https://api.fda.gov`), optional `OPENFDA_API_KEY`, 5 s timeout, one retry, 7-day cache. It queries only labels that have the interaction section (`_exists_:drug_interactions`, newest first).
- **Evidence loads lazily** per pair (`/api/interactions/evidence`), so severity shows immediately and label lookups never block the report.
- **Shared product picker:** extract drug search → product selection from the add dialog into `ProductPickerComponent`, reused by `/interactions`.
- **E2E stays offline:** the stub server gains DDInter CSV and openFDA routes. Playwright's global setup runs the importer against the stub.

## Dependency Graph

```
1 openFDA client ─────────────────────────────┐
2 Schema + CSV parsing ── 3 Importer (RxNav) ──┤
                          4 Report builder ───┼── 6 API routes ── 7 NgRx feature ── 9 /interactions page ── 10 Add-dialog warning + dashboard
5 Label evidence (1 + RxClass EPC) ───────────┘                    8 ProductPicker extraction ┘
                                                                     11 E2E (stubs) ── 12 Docker import, coverage, docs
```

## Task List

### Phase 1: Data and server

- [x] Task 1: openFDA label client
- [x] Task 2: DDInter schema, migration and CSV parsing
- [ ] Task 3: DDInter importer and `ddi:import` command
- [ ] Task 4: Interaction report builder and queries
- [ ] Task 5: Label evidence matching (with RxClass class names)
- [ ] Task 6: Interactions API routes

### Checkpoint A

- [ ] Real import against live DDInter + RxNav (≥ 95% mapped, idempotent)
- [ ] curl: spironolactone vs active lisinopril → Major + label sentence; atorvastatin → Unknown; notCovered case

### Phase 2: Client

- [ ] Task 7: NgRx interactions feature and API service
- [ ] Task 8: Extract `ProductPickerComponent` from the add dialog
- [ ] Task 9: `/interactions` page (check + current + evidence)
- [ ] Task 10: Add-dialog warning and dashboard summary

### Checkpoint B

- [ ] Browser: check flow, current pairs, evidence expand, add-dialog warning, dashboard line; 375px and 1280px; openFDA-down message

### Phase 3: Verification

- [ ] Task 11: E2E with stub DDInter, RxNav and openFDA
- [ ] Task 12: Docker import run, coverage, docs

### Checkpoint C: interactions complete

- [ ] Spec success criteria 1–8
- [ ] Human review, then `SPEC-drug-info.md`

## Risks and Mitigations

| Risk                                              | Impact | Mitigation                                                                                                           |
| ------------------------------------------------- | ------ | -------------------------------------------------------------------------------------------------------------------- |
| DDInter URLs or CSV format change                 | Med    | Importer validates the header and fails loudly; the old data stays (transactional)                                   |
| Name mapping misses                               | Med    | 90% guard; unmapped names printed; notCovered shown in the UI, so gaps are visible, never silent                     |
| Label text uses class phrasing the matcher misses | Med    | EPC class names + a synonym list + always a link to the full section; never implies "not mentioned = no interaction" |
| openFDA daily limit without a key (1,000/day)     | Low    | 7-day cache; lazy evidence; optional `OPENFDA_API_KEY`                                                               |
| Import time (≈2k RxNav calls)                     | Low    | 10 req/s throttle (~4 min); reuse previous mappings                                                                  |
| 235k-row insert speed                             | Low    | Batched inserts (e.g. 5k rows per statement) inside the transaction                                                  |

## Open Questions

None. Spec decisions resolved 2026-09-27.
