# Spec: medications

Module of [CAPABILITY-MAP.md](CAPABILITY-MAP.md). Depends on: `foundation`. Status: **draft, awaiting review**.

## Objective

Let the owner keep an accurate list of the prescriptions they take: add a drug with its strength, see the list, edit notes, and stop or remove a drug. Every entry is resolved to an **RxNorm concept** (RXCUI). Every later module (drug-info, interactions, literature, alternatives, pricing, digest) keys off these identifiers, never off free text.

**User story:** "I was just prescribed lisinopril 10 mg. I type `lisin`, pick _lisinopril_, pick _10 MG Oral Tablet_, and it's on my list in under 30 seconds, with the right name and strength."

## Data source: RxNav (NIH National Library of Medicine)

Free, no API key. Base URL `https://rxnav.nlm.nih.gov/REST`, configurable as `RXNAV_BASE_URL`. All four endpoints below were checked on 2026-09-27.

| Use                                      | Endpoint                                                     | Example                                                                  |
| ---------------------------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------ |
| Search as you type (prescribable subset) | `GET /Prescribe/approximateTerm.json?term=<q>&maxEntries=10` | `lisinop` → `lisinopril` (IN 29046)                                      |
| Products for a drug                      | `GET /Prescribe/drugs.json?name=<ingredient or brand>`       | groups by `tty`: `SCD` (generic product), `SBD` (branded)                |
| Product details                          | `GET /rxcui/<rxcui>/related.json?tty=IN+BN+DF`               | ingredient `lisinopril`, brands `Zestril`/`Prinivil`, form `Oral Tablet` |
| Strength                                 | `GET /rxcui/<rxcui>/allProperties.json?prop=attributes`      | `AVAILABLE_STRENGTH` = `10 MG`                                           |

Terms: **IN** = ingredient, **BN** = brand name, **SCD** = generic product ("lisinopril 10 MG Oral Tablet"), **SBD** = branded product ("… [Zestril]"), **DF** = dose form.

Rules:

- The browser never calls RxNav directly. The server proxies every request, with a 5-second timeout, one retry on network errors, and an in-memory cache (search: 24 hours, product details: 7 days).
- A saved medication must be an `SCD` or `SBD` concept. Saving always re-fetches its details on the server, so what's stored is whatever RxNorm says, not what the client sent.
- NLM asks clients to stay under 20 requests per second. Debounced search plus the cache keeps a single user far below that.

## Data model (Drizzle, `src/server/db/schema/medications.ts`)

```ts
medications = pgTable('medications', {
  id: uuid().primaryKey().defaultRandom(),
  rxcui: text().notNull(), // SCD or SBD
  tty: text({ enum: ['SCD', 'SBD'] }).notNull(),
  name: text().notNull(), // RxNorm name, e.g. "lisinopril 10 MG Oral Tablet"
  strength: text(), // "10 MG"; null for multi-ingredient products without one value
  doseForm: text(), // "Oral Tablet"
  brandName: text(), // "Zestril" for SBD, else null
  ingredients: jsonb().$type<{ rxcui: string; name: string }[]>().notNull(),
  notes: text(), // free text, max 1000 characters
  startedOn: date(),
  stoppedOn: date(), // null = currently taking
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
});
// A product can only be active once: unique (rxcui) where stoppedOn is null.
```

The first real migration is `drizzle/0000_*.sql`, which also proves the foundation's migrate-on-start pipeline end to end.

## API (all require a session; validated with zod)

| Method and path                  | Purpose                                       | Responses                                                                       |
| -------------------------------- | --------------------------------------------- | ------------------------------------------------------------------------------- |
| `GET /api/rxnorm/search?q=`      | Candidate drugs (IN/BN), `q` 2–100 characters | 200 `[{ rxcui, name, tty }]`, 400, 503 if RxNav is down                         |
| `GET /api/rxnorm/products?name=` | SCD/SBD products for one drug                 | 200 `[{ rxcui, name, tty, strength, doseForm, brandName }]`, 503                |
| `GET /api/medications`           | Active medications first, then stopped        | 200 `Medication[]`                                                              |
| `POST /api/medications`          | `{ rxcui, notes?, startedOn? }`               | 201 `Medication`; 409 if already active; 422 if the rxcui isn't an SCD/SBD; 503 |
| `PATCH /api/medications/:id`     | `{ notes?, startedOn?, stoppedOn? }`          | 200, 404, 409 (restarting a duplicate)                                          |
| `DELETE /api/medications/:id`    | Permanently delete                            | 204, 404                                                                        |

## UI (`/medications`, SSR)

- **List:** active medications as cards (name, strength, form, brand, started date, notes), with a collapsed "Stopped" section. The list is server-rendered with the page (no loading flash). There's an empty state with an "Add medication" call to action.
- **Add dialog** (PrimeNG `Dialog`):
  1. A PrimeNG `AutoComplete` for the drug, debounced 300 ms, minimum 2 characters.
  2. A list of products for that drug (strength and form, generics first, then brands).
  3. Optional start date and notes.
  4. Save.

  It shows "Drug lookup is unavailable right now" if RxNav fails. Anything already on the list keeps working.

- **Per medication:** edit notes and start date, "Stop taking" (sets today's date, which you can change), "Restart", and "Delete" with a confirmation.
- Works at 375px and 1280px, is keyboard-operable, and meets WCAG AA contrast, following foundation conventions.

## State (NgRx)

A `medications` feature built on `@ngrx/entity` (**new dependency, ask first**):

- **Actions:** `load`, `loadSuccess`/`loadFailure`, `add`/`addSuccess`/`addFailure`, `update…`, `stop…`, `remove…`.
- **Effects:** call `MedicationsApi`.
- **Selectors:** `selectActive`, `selectStopped`.

The drug search lives in component-local state (signals). It's transient, so it doesn't belong in the store.

## Project structure (additions)

```
src/server/db/schema/medications.ts
src/server/rxnorm/client.ts        → RxNav calls, timeout/retry/cache, response mapping
src/server/rxnorm/fixtures/        → recorded RxNav responses for tests
src/server/medications/repository.ts
src/server/routes/api/rxnorm/{search.get,products.get}.ts
src/server/routes/api/medications/{index.get,index.post,[id].patch,[id].delete}.ts
src/app/features/medications/      → store (actions/reducer/effects/selectors), api service, components
src/app/pages/(app)/medications.page.ts
drizzle/0000_*.sql
```

## Testing strategy

- **Unit:**
  - RxNav response mapping, using recorded fixtures (no network calls in tests).
  - The cache and timeout behaviour.
  - The reducer, selectors and effects.
  - The components: autocomplete flow, product pick, error state.
- **Integration (test DB):**
  - repository create/list/update/delete
  - the unique-active constraint
  - route handlers with the RxNav client stubbed
- **E2E:** add, stop and delete a medication through the UI against a stub RxNav (`RXNAV_BASE_URL` points at a small fixture server started by Playwright), so tests never depend on NLM being up.
- **Coverage:** at least 80% lines on `src/server/rxnorm`, `src/server/medications` and `src/app/features/medications`.

## Boundaries

- **Always:**
  - resolve and re-verify through RxNorm on the server
  - key everything by RXCUI
  - keep RxNav behind the server proxy
- **Ask first:**
  - `@ngrx/entity`
  - any other new dependency
  - changing the medications table after its first migration ships
- **Never:**
  - call RxNav from the browser
  - store free-text drugs that later modules can't resolve (unless open question 2 decides otherwise)
  - log notes or medication names at info level

## Success criteria

1. Typing `lisin` shows _lisinopril_ within 1 second (cached) or 2 seconds (uncached, normal RxNav latency).
2. Choosing _lisinopril → 10 MG Oral Tablet_ adds `lisinopril 10 MG Oral Tablet`, strength `10 MG`, form `Oral Tablet`, ingredient `lisinopril (29046)`, which survives a page reload and a container restart.
3. Adding the same product again while it's active gives a clear "already on your list" message (409).
4. Stop, restart, edit notes and delete all work and persist. Delete asks for confirmation.
5. With RxNav unreachable, search shows the "unavailable" message within 6 seconds, and the existing list still loads and edits.
6. `/medications` HTML from the server already contains the list (SSR); there are no hydration warnings.
7. The first Drizzle migration applies automatically on `docker compose up`, with `[migrate] database is up to date` in the logs.
8. Lint, unit, integration and e2e tests pass; coverage targets are met.

## Open questions (need your answer)

1. **"Remove" behaviour:** should removing a drug usually mean _stop taking_, which keeps it in a "Stopped" history (useful context for interactions and the digest), with a separate permanent _delete_? _Recommendation: yes, both, as specified above._
2. **Drugs RxNorm can't find** (compounded meds, some supplements): allow a free-text entry marked "no drug information available", or RxNorm only? _Recommendation: RxNorm only for now. Every later feature needs an RXCUI, and it keeps the data clean. Free text can come later._
3. **Extra fields:** is _notes + start date_ enough, or do you also want dose instructions ("1 tablet daily"), prescriber, or pharmacy? _Recommendation: notes + start date only. Dose schedules are out of scope in the intent (no reminders)._
4. **`@ngrx/entity`:** OK to add? It's the standard NgRx tool for collections and fits the learning goal. _Recommendation: yes._
