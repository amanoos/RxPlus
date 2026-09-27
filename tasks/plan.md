# Implementation Plan: literature

Spec: [SPEC-literature.md](../SPEC-literature.md) · Research: [free-data-sources](../docs/research/free-data-sources.md) · Tasks: [todo.md](todo.md) · Previous: [drug-info](drug-info/plan.md), [interactions](interactions/plan.md), [medications](medications/plan.md), [foundation](foundation/plan.md)

## Overview

A **Research** section on `/drugs/:rxcui`, per ingredient:

- **Papers:** up to 10 from PubMed, strongest evidence first (≤ 4 meta-analyses and systematic reviews, then randomized trials).
- **Takeaways:** one plain-language line per paper, written by AI from its abstract and checked against it.
- **Trials:** up to 5 from ClinicalTrials.gov (completed with results, then recruiting).
- **Curation:** Hide (with undo) promotes the next candidate from a stored pool.

## Architecture Decisions

- **Lists are per ingredient**, keyed by ingredient RXCUI; the drug page resolves its ingredients through drug-info's `product()` (saved medications skip RxNav).
- **Search once, store the pool.** Up to 20 candidates per tier are stored with their abstracts; Hide and the "first 10 not hidden" selection are database work, with no new search. Refresh (30 days, or on request) upserts candidates, keeping takeaways and hidden state.
- **PubMed via E-utilities with our own HTTP helpers.** `esearch`/`esummary` are JSON; `efetch` is XML, so `upstream.ts` gains a text variant of `getJson`. Abstract XML is parsed with a small, tested extractor (`<AbstractText>` sections, entities decoded), with no new dependency. Requests are serialized with a minimum spacing (400 ms, or 110 ms with `NCBI_API_KEY`), and a 429 is retried with backoff (measured: NCBI still returns occasional 429s at 350 ms).
- **ClinicalTrials.gov v2** with a `fields=` subset, two calls (completed with results, recruiting).
- **One AI call per ingredient list.** The provider layer is refactored into a generic core (Ollama: `system + user + JSON schema`; Claude: documents with citations and headed output) used by both drug-info summaries and literature takeaways. Drug-info's tests must pass unchanged, which guards the refactor.
- **Verification is shared.** The normalization, stem relevance, synonyms and advice filter move from `drug-info/summary.ts` into a shared module; takeaways verify each quote against that paper's abstract.
- **Background generation** follows drug-info: `POST` → 202, status on the list row, poll every 2 s, startup cleanup. The Claude daily limit counts starts across both tables.
- **E2E stays offline:** the stub server gains PubMed, ClinicalTrials.gov and an Ollama takeaway reply, routed by request content.

## Dependency Graph

```
1 PubMed client ──────┐
2 CT.gov client ──────┼─ 3 Schema + repository ── 4 Service + routes ──┐
5 Provider refactor ──┴─ 6 Takeaway core ── 7 Takeaway generation ─────┴─ 8 NgRx ── 9 Papers UI ── 10 Hide, trials, refresh
                                                                            11 E2E ── 12 Coverage, README
```

## Task List

### Phase 1: Server

- [x] Task 1: PubMed client (search tiers, summaries, abstracts, spacing)
- [x] Task 2: ClinicalTrials.gov client
- [x] Task 3: Schema, migration 0003 and repository
- [x] Task 4: Literature service and routes (lists, refresh, hide)
- [x] Task 5: Provider refactor (generic structured generation), drug-info unchanged
- [x] Task 6: Takeaway core: prompt, schema, per-abstract verification
- [x] Task 7: Takeaway generation in the background, route, shared Claude limit

### Checkpoint A

- [x] Unit and integration tests pass; migration applies
- [x] curl: lisinopril lists from live PubMed and ClinicalTrials.gov; takeaways with a stub provider, then live with `qwen2.5:7b`

### Phase 2: Client

- [x] Task 8: NgRx `literature` feature and API service
- [x] Task 9: Research section: papers with takeaways and quotes shown inline
- [ ] Task 10: Hide and undo, trials list, footer and "Check for new research"
- [ ] Task 10b: Summary panel "Show quotes" toggle

### Checkpoint B

- [ ] Browser: Research section states, takeaways, hide/undo, trials; 375px and desktop

### Phase 3: Verification

- [ ] Task 11: E2E with stub PubMed, ClinicalTrials.gov and Ollama
- [ ] Task 12: Coverage, README, `.env.example`

### Checkpoint C: literature complete

- [ ] Spec success criteria 1–8; live takeaways with the verified rate reported
- [ ] Human review, then `SPEC-alternatives.md`

## Risks and Mitigations

| Risk                                                    | Impact | Mitigation                                                                                             |
| ------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------ |
| Provider refactor breaks drug-info summaries            | High   | Do it as its own task with drug-info tests unchanged; e2e summary flow re-run                          |
| NCBI rate limits (3/s) or slow E-utilities              | Med    | Serialized, spaced calls; stored pools; stale lists served while refreshing                            |
| Relevance order surfaces off-topic reviews              | Med    | Hide with promotion; cap reviews at 4; measured queries in the spec                                    |
| qwen2.5:7b mis-attributes takeaways across papers       | Med    | Verify each quote against that PMID's abstract only; unknown PMIDs dropped; live check at Checkpoint A |
| Abstract XML variations (structured, entities, missing) | Low    | `hasabstract` filter; extractor tests with recorded XML (structured and plain)                         |
| Several ingredients multiply calls on first load        | Low    | Ingredients fetched one after another; lists cached 30 days                                            |

## Open Questions

- None blocking.
