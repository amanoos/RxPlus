# Spec: per-user-hiding

Module of [CAPABILITY-MAP.md](CAPABILITY-MAP.md), initiative **multi-user**. Depends on: `accounts`, `literature`, `alternatives`. Status: **done, approved 2026-09-29**.

## Objective

Make **Hide** personal. A paper hidden on a drug's Research section, or an alternative drug hidden on its Alternatives section, disappears for the person who hid it only. The paper and alternatives caches stay shared: they're about the drug, not the person.

This is the last module of the multi-user initiative. When it's done, nothing in the app is shared between accounts except data about drugs, and the upgrade can be deployed (see the README's upgrade checklist).

**User story:** "Alice hides a rat study from lisinopril's research; Bob, who also takes lisinopril, still sees it among his 10 papers. Bob hides candesartan from the alternatives; Alice still sees it."

Out of scope: sharing hides within a household, and hiding anything else (trials, digest items).

## Tech Stack

Unchanged. There are no new dependencies. Drizzle migration `0010`, and `requireUser(event)`.

## Commands

```
Unit tests:     npm test
Integration:    npm run db:test:up && npm run test:int
E2E:            npm run e2e
Lint / format:  npm run lint && npm run format:check
Migration:      npm run db:generate      # then check the generated SQL (see Data)
```

## Project Structure

```
src/server/db/schema/literature.ts       → new literature_hidden table; literature_papers.hidden_at removed
src/server/db/schema/alternatives.ts     → alternative_hidden keyed by (user_id, ingredient_rxcui, hidden_rxcui)
drizzle/0010_hiding_per_user.sql         → generated; clears alternative_hidden first (see Data)
src/server/literature/repository.ts      → shownPapers / hiddenPapers / setHidden take the user
src/server/literature/service.ts         → literatureService(userId): the view, refresh, takeaways and hide per user
src/server/alternatives/repository.ts    → hide / unhide / hidden take the user
src/server/alternatives/service.ts       → passes its userId to them
src/server/routes/api/drugs/[rxcui]/literature/*.ts, src/server/routes/api/literature/**  → pass requireUser(event).id
src/server/tests/{literature,alternatives}-api.int.spec.ts, e2e/{literature,alternatives}.spec.ts → two users
```

## Behavior

**Data**

- **New `literature_hidden`:** `user_id` (references `users`, delete cascade), `ingredient_rxcui`, `pmid`, `hidden_at`. The primary key is `(user_id, ingredient_rxcui, pmid)`.
  - `literature_papers.hidden_at` is dropped. The paper rows stay shared, with their takeaways.
  - A hide survives a research refresh, as it does today. A paper the refresh no longer finds leaves a harmless hide row behind, which the page never shows because hidden papers are read joined to the current candidates.
- **`alternative_hidden`** gains `user_id` (references `users`, delete cascade). Its primary key becomes `(user_id, ingredient_rxcui, hidden_rxcui)`.
- **Migration `0010`** clears `alternative_hidden` before adding the not-null `user_id`. The existing hides belong to nobody; the real database has none today, of either kind.
- **No copying of hidden papers:** `literature_papers.hidden_at` has no values to keep (0 in the real database), so nothing is copied into `literature_hidden`.

**Literature (each call reads `requireUser(event)`)**

- The **10 papers shown** are the first 10 candidates that _this user_ hasn't hidden, using the same `selectShown` rules. Hiding one brings the next candidate in, for that user only.
- `hiddenPapers` lists the user's hidden papers that are still candidates, oldest hide first.
- `POST` and `DELETE /api/literature/:ingredient/papers/:pmid/hide` hide and unhide for the user. A PMID that isn't a candidate for that ingredient gets `404`, as today. Hiding twice or unhiding a paper that isn't hidden is harmless.
- **Takeaways:** "write takeaways" generates them for the user's shown papers that lack one. Takeaways stay stored on the shared paper row, so a takeaway written for Alice's list also appears on Bob's.
- The list's fetch time and takeaway job status stay shared (per ingredient).

**Alternatives**

- `hide`, `unhide` and `hidden` take the user. The Alternatives section of a drug page lists the user's hidden drugs under "Hidden", as today.

**Client**

- No behavior changes. The literature and alternatives stores already reset on `logoutSuccess`.

## Code Style

This follows [SPEC-foundation.md](SPEC-foundation.md). The user id is passed down from the route, as in the other `per-user-*` modules.

```ts
// src/server/literature/repository.ts (shape)
async shownPapers(ingredientRxcui: string, userId: string): Promise<LiteraturePaper[]> {
  const hiddenByUser = db
    .select({ pmid: literatureHidden.pmid })
    .from(literatureHidden)
    .where(and(eq(literatureHidden.userId, userId), eq(literatureHidden.ingredientRxcui, ingredientRxcui)));
  const visible = await db
    .select()
    .from(literaturePapers)
    .where(and(eq(literaturePapers.ingredientRxcui, ingredientRxcui), notInArray(literaturePapers.pmid, hiddenByUser)));
  return selectShown(visible);
}
```

## Testing Strategy

- **Integration (repositories):**
  - a paper hidden by Alice is still shown to Bob, and the next candidate fills Alice's list
  - hides survive `saveFetched`
  - alternative hides are per user
  - removing a user cascades their hides
  - migration `0010` applied to a copy of the dev database leaves every other table's row count unchanged
- **Integration (routes):** hide and unhide for papers and alternatives as Alice, then read as Bob. `404` for a non-candidate PMID.
- **E2E:** extend the literature and alternatives specs. Hide as one account, then check that the other account still sees the item.
- **Release rehearsal:** build the image, and against a copy of the real database:
  - run all migrations (`0007`–`0010`)
  - create two accounts with `dist/user.cjs`
  - sign in as each
  - check the app starts clean: empty lists, no digests, research and alternatives still cached
- **Coverage:** `src/server/literature` and `src/server/alternatives` stay at 80% or above.

## Boundaries

- **Always:** pass the signed-in user to every hide read or write.
- **Ask first:** sharing hides across accounts, or making anything else hideable.
- **Never:**
  - change what another user sees by hiding
  - drop or modify the shared paper and alternatives caches beyond removing `hidden_at`
  - apply `0010` to the real database before the owner runs the README's upgrade checklist

## Success Criteria

1. Alice hides a paper on lisinopril's Research. It moves to her Hidden list, and the next paper takes its place. Bob's list for lisinopril is unchanged.
2. Bob hides an alternative. Alice still sees it among the alternatives, and Bob sees it under Hidden.
3. Unhiding brings the item back for that user only.
4. A research refresh keeps each user's hidden papers hidden.
5. `remove alice --yes` removes her hides.
6. The release rehearsal on a copy of the real database passes: migrations apply, accounts are created, both sign in, and the lists start empty while the caches remain.
7. Lint, unit, integration and e2e pass; coverage targets are met.

## Open Questions

None. The one design choice, keeping takeaways shared while each user's shown set differs, follows the existing rule that takeaways are about the paper.
