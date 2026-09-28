# Implementation Plan: pricing

Spec: [SPEC-pricing.md](../SPEC-pricing.md) · Research: [free-data-sources](../docs/research/free-data-sources.md) · Tasks: [todo.md](todo.md) · Previous: [digest](digest/plan.md), [alternatives](alternatives/plan.md), [literature](literature/plan.md), [drug-info](drug-info/plan.md), [interactions](interactions/plan.md), [medications](medications/plan.md), [foundation](foundation/plan.md)

## Overview

Cash prices from Cost Plus Drugs matched to each RxNorm product by NDC, plus the owner's units per month and copay per fill, shown as monthly cash vs insured on each drug page (Prices) and on a Costs page with totals.

## Architecture Decisions

- **One client per upstream:** `src/server/costplus/client.ts` (query by ingredient, parse dollar strings, 24 h cache, spacing, `COSTPLUS_BASE_URL` for the e2e stub); RxNav client gains `ndcs(rxcui)` (7 days).
- **Match by NDC only:** a product's price is the Cost Plus item whose NDC is in the product's RxNorm NDCs (normalized to 11 digits). No name fallback.
- **Pure math in one place:** `src/server/pricing/math.ts` (monthly cash, insured, difference, totals, cents rounding) shared by both routes.
- **Owner entries live on `medications`** (migration 0006), edited through the existing PATCH route and edit dialog.
- **No price storage:** Cost Plus answers stay in memory; pages always read through the server.

## Dependency Graph

```
1 Cost Plus client + RxNav ndcs ─┐
2 Migration + medication fields ─┼─ 3 Pricing service + routes ── 4 NgRx pricing ── 5 Prices section + edit fields ── 6 Costs page
                                 │                                                                                    7 E2E ── 8 Coverage, README
```

## Task List

### Phase 1: Server

- [x] Task 1: Cost Plus client and RxNav NDCs
- [x] Task 2: Migration 0006 and medication cost fields
- [x] Task 3: Pricing math, service and routes

### Checkpoint A

- [x] Unit and integration tests pass; migration applies
- [x] Live: prices for current medications (matches, not-sold cases)

### Phase 2: Client

- [x] Task 4: NgRx pricing feature and API service
- [x] Task 5: Drug page Prices section and cost fields in the edit dialog
- [ ] Task 6: Costs page and navigation

### Checkpoint B

- [ ] Browser: Prices section, edit fields, Costs page totals; 375px and desktop

### Phase 3: Verification

- [ ] Task 7: E2E with a Cost Plus stub
- [ ] Task 8: Coverage, README

### Checkpoint C: pricing complete

- [ ] Spec success criteria 1–5
- [ ] Human review

## Risks and Mitigations

| Risk                                                                      | Impact | Mitigation                                                                            |
| ------------------------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------- |
| Cost Plus API is unofficial-looking (cloud function URL) and could change | Med    | One client, base URL configurable, errors shown as "Prices are unavailable right now" |
| NDC formats differ (10 vs 11 digits, hyphens)                             | Med    | Normalize both sides to 11 digits; unit tests with real fixtures                      |
| Monthly figures without fees understate cash cost                         | Low    | Fee note with product link on every price                                             |
| Fractional units (0.5) and cents rounding                                 | Low    | Numeric columns; math in cents with one rounding step                                 |

## Open Questions

- None blocking.
