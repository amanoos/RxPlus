# Tasks: digest

Plan: [plan.md](plan.md) · Spec: [SPEC-digest.md](../SPEC-digest.md)

Every task also meets the Definition of Done: lint and tests pass, no regressions, behavior checked at runtime, docs updated.

## Phase 1: Server

- [x] **Task 1: PubMed recent papers and ClinicalTrials.gov recent updates** (S)
  - Acceptance:
    - PubMed `recentPapers(ingredient, { from, to, limit })` → `{ pmids (relevance order, ≤ limit), total, searchUrl }` with `"<name>"[tiab] AND hasabstract`, `datetype=edat`, both dates; `searchUrl` opens the same search on pubmed.ncbi.nlm.nih.gov
    - ClinicalTrials.gov `recentUpdates(ingredient, since)` → trials updated since the date with `firstPosted` and `resultsFirstPosted` dates
  - Verify: unit tests with recorded fixtures
  - Files: `src/server/pubmed/client.ts`, `src/server/ctgov/client.ts` (+ specs, fixtures)
  - Depends on: none

- [x] **Task 2: Schema, migration 0005 and repository** (M)
  - Acceptance: `digests`, `digest_items`, `digest_label_versions` as in the spec, with one `running` digest at most (partial unique index); repository: start (claim), finish with items in one transaction, fail, list recent with items, unread count, mark read, seen external ids, label versions get/set, last successful run, `failInterrupted`
  - Verify: integration tests
  - Files: `src/server/db/schema/digest.ts`, `drizzle/0005_*`, `src/server/digest/repository.ts` (+ int spec)
  - Depends on: none

- [x] **Task 3: Papers and trials collectors** (M)
  - Acceptance: papers: up to 5 per ingredient not seen before, details, takeaways (literature provider and checks; failure → papers without takeaways + a note), "N more on PubMed" item when the total is larger; trials: newly posted or results newly posted in the window, not seen before
  - Verify: unit tests with stubbed clients and provider
  - Files: `src/server/digest/collect-papers.ts`, `collect-trials.ts` (+ specs)
  - Depends on: 1, 2

- [x] **Task 4: Approvals and label collectors** (M)
  - Acceptance: approvals: per "taken for" condition of active medications, snapshot the condition list, rebuild it (force), report drugs newly listed and new by the 5-year rule; first sight of a condition is a baseline; labels: newest label per active product vs the recorded version; first sight is a baseline; both not repeated
  - Verify: unit/integration tests with stubbed clients
  - Files: `src/server/digest/collect-approvals.ts`, `collect-labels.ts` (+ specs)
  - Depends on: 2

- [x] **Task 5: Run orchestration, weekly schedule and catch-up** (M)
  - Acceptance: `runDigest(trigger)`: window from the last successful run (7 days on the first), active medications and ingredients, collectors, one digest stored at the end (or failed with the error), one at a time; Nitro task `digest:weekly` on `0 6 * * 1` with `experimental.tasks`; startup plugin: fail an interrupted run, catch up when the last successful run is older than 7 days
  - Verify: integration test of a full run with stubs (items per kind, no repeats on the second run, baselines, one at a time); unit test of the catch-up decision
  - Files: `src/server/digest/run.ts` (+ int spec), `src/server/tasks/digest/weekly.ts`, `src/server/plugins/digest.ts`, `vite.config.ts`
  - Depends on: 3, 4

- [x] **Task 6: Digest routes** (S)
  - Acceptance: `GET /api/digests` (12 weeks, items grouped by subject, running status, next scheduled time), `GET /api/digests/unread-count`, `POST /api/digests/run` (202, 409 when running), `POST /api/digests/:id/read` (204)
  - Verify: route integration tests
  - Files: `src/server/digest/service.ts`, `src/server/routes/api/digests/**`, tests
  - Depends on: 5

### Checkpoint A

- [ ] Unit and integration tests pass; migration applies
- [ ] Live: a run over current medications (duration, counts per kind); a second run reports no repeats

## Phase 2: Client

- [x] **Task 7: NgRx `digest` feature and API service** (M)
  - Acceptance: load digests, unread count (on navigation and after actions), run now, poll while a run is going (browser only, every 5 s, ≤ 30 min), mark read after the page shows a digest
  - Verify: reducer, selector and effect tests
  - Files: `src/app/features/digest/**`, `src/app/store/app.store.ts`
  - Depends on: 6

- [ ] **Task 8: "What's new" page and navigation badge** (M)
  - Acceptance: navigation "What's new" with the unread badge; `/digest`: latest digest open, earlier collapsed, grouped by drug; papers with takeaways and quotes, "N more on PubMed", trials, approvals, label changes, each linked; states (next run, running, failed with Try again, empty week, no active medications); Run now; items highlighted until read
  - Verify: component tests; browser check
  - Files: `src/app/pages/(app)/digest.page.ts` (+ spec), `src/app/features/digest/*.component.ts` (+ specs), `src/app/core/layout/app-shell.component.ts`
  - Depends on: 7

### Checkpoint B

- [ ] Browser: badge, page groups, read tracking, Run now; 375px and desktop

## Phase 3: Verification

- [ ] **Task 9: E2E with stub entry-date search, trial updates, label and approval changes** (M)
  - Acceptance: the stub serves an entry-date PubMed search, trial updates, a second label version and a newly listed drug; the spec adds a medication, runs the digest, sees the badge, opens What's new, sees each kind of item, and the badge clears
  - Verify: `npm run e2e` (3 repeats stable)
  - Files: `e2e/stub-upstream.ts`, `e2e/digest.spec.ts`, fixtures
  - Depends on: 8

- [ ] **Task 10: Coverage, README** (S)
  - Acceptance: coverage ≥ 80% on `src/server/digest`, `src/app/features/digest`; README section on the digest (what, when, catch-up, Run now)
  - Verify: `npm run test:coverage`; production build
  - Files: `vite.config.ts`, `README.md`
  - Depends on: 9

### Checkpoint C: digest complete

- [ ] Spec success criteria 1–8; live run reported
- [ ] Human review, then `SPEC-pricing.md`
