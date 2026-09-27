# Implementation Plan: drug-info

Spec: [SPEC-drug-info.md](../SPEC-drug-info.md) · Research: [free-data-sources](../docs/research/free-data-sources.md) · Tasks: [todo.md](todo.md) · Previous: [interactions](interactions/plan.md), [medications](medications/plan.md), [foundation](foundation/plan.md)

## Overview

A drug page (`/drugs/:rxcui`) with:

- **Structured facts from RxClass:** class, what it's used for, conditions to avoid it with.
- **FAERS reported reactions:** shown with a disclaimer.
- **Links:** DailyMed and MedlinePlus.
- **AI summary of the FDA label:** local `qwen2.5:7b` via Ollama by default, optional Claude Opus 5. Every sentence is tied to a verified label quote; summaries are stored per label version.

## Architecture Decisions

- **One summary pipeline, two providers.** `SummaryProvider.generate(label) → RawSummary` (sections → sentences → quotes). Everything else is provider-neutral and pure:
  - prompt rules
  - label section selection
  - quote verification (normalize whitespace, case and quote marks, then substring-match within the named section)
  - the 20% uncited rule
- **Ollama via its HTTP API** (`POST /api/chat`, `format` = JSON schema, `num_ctx`, `temperature`, timeout) through the existing `getJson`-style helper, extended for POST. No new dependency.
- **Claude via `@anthropic-ai/sdk`** (the only new dependency; approved in the spec). Citations enabled on document blocks; `cited_text` become quotes; refusal fallback on.
- **Background generation** in the server process after `POST` returns 202. A row with status `pending` is inserted first (the unique index prevents duplicates), then updated to `ready` or `failed`. On startup, stale `pending` rows (> 10 min) are marked failed.
- **Label freshness:** the openFDA client caches the label for 7 days; "Check for a newer label" bypasses the cache for one call. The summary lookup uses the current label's set_id and version.
- **E2E stays offline:** the stub server gains `/api/chat` (Ollama) and FAERS routes.

## Dependency Graph

```
1 openFDA label + FAERS ─┐
2 RxClass facts ─────────┼─ 3 Facts & FAERS routes ─────────────┐
4 Summary core (pure) ───┼─ 5 Ollama provider ─┐                ├─ 7 NgRx ── 8 Page (facts, FAERS) ── 9 Summary panel ── 10 Links in
                         └─ 6 Claude provider ─┴─ 7a Storage, generation, routes ┘
                                                        11 E2E ── 12 Docker/README/coverage
```

## Task List

### Phase 1: Server

- [x] Task 1: openFDA `summaryLabel(rxcui)` and `reportedReactions(ingredient)`
- [x] Task 2: RxClass facts (uses, avoid with, classes) and MedlinePlus link
- [x] Task 3: `GET /api/drugs/:rxcui` and `/reported-reactions`
- [x] Task 4: Summary core: prompt, output schema, quote verification
- [x] Task 5: Ollama provider
- [ ] Task 6: Claude provider (optional, citations, refusal fallback)
- [ ] Task 7: Summary storage, background generation and summary routes

### Checkpoint A

- [ ] Unit and integration tests pass; migration applies
- [ ] curl: facts, FAERS, summary generation with a stub provider; and live with `qwen2.5:7b` if Ollama is reachable from this machine

### Phase 2: Client

- [ ] Task 8: NgRx `drugInfo` feature and API service (with polling)
- [ ] Task 9: `/drugs/:rxcui` page: facts, FAERS panel, links (SSR)
- [ ] Task 10: Summary panel: citations, uncited styling, states, refresh
- [ ] Task 11: Links from medication cards and interaction results

### Checkpoint B

- [ ] Browser: page, FAERS disclaimer, summary states, citation popover; 375px and desktop

### Phase 3: Verification

- [ ] Task 12: E2E with stub Ollama and FAERS
- [ ] Task 13: Docker `extra_hosts`, coverage, README (Ollama setup)

### Checkpoint C: drug-info complete

- [ ] Spec success criteria 1–8; live summary with `qwen2.5:7b` on the home server (uncited rate reported)
- [ ] Human review, then `SPEC-literature.md`

## Risks and Mitigations

| Risk                                                                 | Impact | Mitigation                                                                                                                                                    |
| -------------------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `qwen2.5:7b` paraphrases instead of quoting → many uncited sentences | Med    | Prompt demands exact quotes; verification tolerant to whitespace, case and punctuation; 20% rule with one retry; the uncited rate is measured at Checkpoint C |
| Local model slow or context overflow                                 | Med    | Explicit `num_ctx` 16384, prompt size estimate before sending, 5-min timeout, background generation                                                           |
| Ollama not reachable from the container (listens on localhost only)  | Med    | README: `OLLAMA_HOST=0.0.0.0` + `extra_hosts`; a clear "provider unavailable" message                                                                         |
| Background generation lost on restart                                | Low    | Stale `pending` rows marked failed on startup; retry button                                                                                                   |
| FAERS counts misread as frequencies                                  | Med    | Disclaimer always visible; never mixed into the AI summary                                                                                                    |
| No Ollama in dev/CI                                                  | Low    | Stub provider in unit/integration tests; stub `/api/chat` in e2e                                                                                              |

## Open Questions

None.
