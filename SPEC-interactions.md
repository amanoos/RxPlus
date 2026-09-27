# Spec: interactions

Module of [CAPABILITY-MAP.md](CAPABILITY-MAP.md). Depends on: `medications`. Status: **draft, awaiting review**.
Research basis: [docs/research/free-data-sources.md](docs/research/free-data-sources.md).

## Objective

The owner's main use of the app: **"I've just been prescribed X. Does it interact with anything I already take?"** Also: "Do any of my current medications interact with each other?"

- **Severity** always comes from structured data: DDInter 2.0 (Major / Moderate / Minor / Unknown), never from AI wording.
- **Explanation** is quoted from the official FDA label ("Drug interactions" section), with a link to the source.
- The app never says a combination is _safe_. It says what the data contains, and makes clear when a drug isn't covered by the dataset.

**User story:** "Before my pharmacist fills a new spironolactone prescription, I pick _spironolactone 25 MG Oral Tablet_ and immediately see **Major: lisinopril**, with the FDA label's sentence about potassium-sparing diuretics and hyperkalemia, and a link to the label."

## Data sources

| Purpose                             | Source                                                                                                                                                                                | Access                                              |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| Interaction pairs and severity      | DDInter 2.0 CSVs (`https://ddinter2.scbdd.com/static/media/download/ddinter_downloads_code_<X>.csv`, one file per ATC letter; 14 files)                                               | Downloaded by an import command, stored in Postgres |
| DDInter name → RxNorm ingredient    | RxNav `GET /rxcui.json?name=<name>&search=2` (99% of a sample mapped)                                                                                                                 | At import time                                      |
| Explanation text                    | openFDA `GET /drug/label.json?search=openfda.rxcui:<rxcui>+AND+_exists_:drug_interactions&sort=effective_time:desc&limit=1`, fields `drug_interactions` and `drug_interactions_table` | On demand; cached 7 days                            |
| Class names for matching label text | RxClass `GET /rxclass/class/byRxcui.json?rxcui=<ingredient>&relaSource=DAILYMED&relas=has_epc` (e.g. spironolactone → "Aldosterone Antagonist")                                       | On demand; cached 7 days                            |

**Licensing:**

- DDInter is **CC BY-NC-SA 4.0**; personal, non-commercial use is allowed with attribution. The app shows "Severity: DDInter 2.0 (CC BY-NC-SA 4.0)" with a link wherever a rating appears.
- **The DDInter files are downloaded at import time and never committed to the repository.**
- FDA label text is public domain.

## Data model (Drizzle, `src/server/db/schema/interactions.ts`)

```ts
ddiDrugs = pgTable('ddi_drugs', {
  ddinterId: text().primaryKey(), // "DDInter1079"
  name: text().notNull(), // "Lisinopril", "Hydrocortisone (topical)"
  route: text(), // "topical" | "ophthalmic" | … parsed from a "(…)" suffix; null = systemic/any
  ingredientRxcui: text(), // RxNorm IN; null if unmapped
}); // index on ingredientRxcui

ddiInteractions = pgTable(
  'ddi_interactions',
  {
    drugA: text().notNull(), // ddinterId, always drugA < drugB
    drugB: text().notNull(),
    level: text({ enum: ['Major', 'Moderate', 'Minor', 'Unknown'] }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.drugA, t.drugB] }), index().on(t.drugB)],
);

ddiImports = pgTable('ddi_imports', {
  id: serial().primaryKey(),
  importedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  pairs: integer().notNull(),
  drugs: integer().notNull(),
  mappedDrugs: integer().notNull(),
});
```

About 235,000 pairs and about 2,000 drugs, easily handled by Postgres.

## Import (`npm run ddi:import`; in Docker: `docker compose run --rm app node dist/ddi-import.cjs`)

1. Download the 14 CSVs, parsing them properly (names can contain quoted commas).
2. Deduplicate pairs. If the files disagree on a pair's level, keep the most severe.
3. Map each drug name to an RxNorm ingredient:
   - strip a route suffix such as "(topical)" or "(ophthalmic)" into `route`
   - call RxNav `search=2`, throttled to ≤ 10 requests per second
   - reuse mappings from the previous import for names that haven't changed
4. Replace all three tables' contents in one transaction, so a failed import leaves the old data untouched.
5. Print a summary (pairs, drugs, mapped percentage, unmapped names). Exit non-zero if fewer than 90% of drugs map.

Run manually when DDInter publishes a release. It doesn't run on server start.

## Matching rules

- A medication's **ingredients** (already stored from RxNorm) are what get checked. A combination product is checked per ingredient; for example, hydrochlorothiazide/lisinopril is checked as both.
- An ingredient matches DDInter drugs with the same `ingredientRxcui`:
  - route-qualified entries only when the medication's dose form contains that route (e.g. "Topical Cream" ↔ `topical`, "Ophthalmic Solution" ↔ `ophthalmic`)
  - unqualified entries always
- Ingredients shared between the two drugs aren't reported as interactions. Duplicate therapy is out of scope.
- If several DDInter entries match a pair, keep the most severe level.
- **Coverage:** for every checked ingredient, report whether DDInter covers it. "No interactions found" is only shown when every ingredient is covered. Otherwise the result is "_X isn't in the interaction dataset. Ask your pharmacist._"

## Label evidence

- For a pair (A, B), fetch the current FDA label of **each** product and split its interaction section(s) into sentences, stripping HTML from the table field.
- Keep sentences that mention the other drug's ingredient name, brand name, or class name (EPC; e.g. "Aldosterone Antagonist"), plus a small maintained list of common label phrasings for classes (e.g. NSAID ↔ "Nonsteroidal Anti-inflammatory Drug", "potassium-sparing diuretic" ↔ aldosterone antagonists/amiloride/triamterene).
- Show at most 3 sentences per label, quoted verbatim, each with "FDA label: <manufacturer>, <effective date>" linking to DailyMed (`https://dailymed.nlm.nih.gov/dailymed/lookup.cfm?setid=<set_id>`).
- If nothing matches, show "Not mentioned in the FDA labels. See the full interaction section" with the link. If openFDA is unavailable, severity is still shown, with "Label text unavailable right now."

## API (session required)

| Method and path                                      | Purpose                                                 | Response                                  |
| ---------------------------------------------------- | ------------------------------------------------------- | ----------------------------------------- |
| `GET /api/interactions/check?rxcui=<SCD/SBD>`        | New product vs all **active** medications               | `InteractionReport`                       |
| `GET /api/interactions/current`                      | All pairs among active medications                      | `InteractionReport`                       |
| `GET /api/interactions/evidence?a=<rxcui>&b=<rxcui>` | Label sentences for one pair (loaded lazily per result) | `LabelEvidence[]`, 503 if openFDA is down |

```ts
interface InteractionReport {
  results: {
    a: { rxcui: string; name: string; ingredient: string };
    b: { rxcui: string; name: string; ingredient: string; medicationId?: string };
    level: 'Major' | 'Moderate' | 'Minor' | 'Unknown';
  }[]; // sorted Major → Unknown, then by name
  notCovered: { rxcui: string; ingredient: string }[];
  source: { name: 'DDInter 2.0'; license: 'CC BY-NC-SA 4.0'; url: string; importedAt: string };
}
```

The `check` endpoint re-resolves the candidate product through the existing RxNav client, as `POST /api/medications` does. It returns 422 for non-products and 503 if RxNav is down. It returns 409 `{ code: 'no-data' }` if no DDInter import has been run yet.

## UI

- **`/interactions` (SSR):**
  - **"Check a new prescription":** the same drug → product picker as the add dialog, extracted into a shared `ProductPickerComponent`. Results are grouped by severity, with color tags: Major red, Moderate orange, Minor blue, Unknown gray ("Listed, severity not rated"). Each result expands to show the label evidence.
  - **"Between your current medications":** the same result list for current pairs. If there are none: "No interactions found in DDInter between your current medications."
- **Add-medication dialog:** after a product is picked, show a compact warning ("Interacts with lisinopril: Major. See details") before _Add_. Adding is still allowed.
- **Everywhere:** a footer note ("Severity from DDInter 2.0, imported <date>. Not medical advice; confirm with your pharmacist or prescriber"), plus the notCovered message when relevant.
- **Dashboard:** a single line ("2 Major interactions between your current medications") linking to `/interactions`.

## State

A new NgRx feature, `interactions`:

- **State:** `current` report, `candidate` report, `evidence` keyed by pair, loading/error flags.
- **Effects:** load `current` when the medication list changes (`addSuccess`, `updateSuccess`, `removeSuccess`).

## Testing

- **Unit:**
  - CSV parsing (quoted names), dedupe/max-level, route-suffix parsing
  - sentence splitting and matching (name, brand, class, synonyms)
  - the report builder: combination products, shared ingredients, notCovered
  - the openFDA client: timeout, cache, 503
  - the NgRx feature
  - the components
- **Integration (test DB):**
  - the importer against small fixture CSVs, with a stubbed RxNav: transactional replace, 90% guard
  - the report queries against seeded tables
- **E2E:** stub DDInter CSVs, stub RxNav and stub openFDA:
  - check spironolactone against an active lisinopril → Major + label sentence
  - add-dialog warning
  - current-pairs list
- **Coverage:** ≥ 80% lines on `src/server/interactions`, `src/app/features/interactions`.

## Boundaries

- **Always:**
  - severity only from DDInter
  - show the source and license next to severity
  - quote label text verbatim, with a link
  - show notCovered
- **Ask first:**
  - adding the ONC high-priority overlay or another severity source
  - using AI in this module
- **Never:**
  - say a combination is "safe"
  - derive or change severity with AI
  - commit DDInter data to the repository
  - call openFDA or DDInter from the browser

## Success criteria

1. `npm run ddi:import` completes in under 10 minutes, maps ≥ 95% of DDInter drugs, and prints a summary. A second run is idempotent (same counts).
2. With lisinopril 10 MG active, checking _spironolactone 25 MG Oral Tablet_ shows **Major** with DDInter attribution, and at least one FDA label sentence naming spironolactone or potassium-sparing diuretics. The severity appears within 1 s; the label evidence within 3 s (uncached).
3. Checking _atorvastatin 20 MG Oral Tablet_ against lisinopril shows **Unknown: listed, severity not rated**.
4. A product whose ingredient isn't in DDInter shows the notCovered message, never "no interactions".
5. A combination product (hydrochlorothiazide/lisinopril) is checked per ingredient.
6. `/interactions` renders the current-pairs list on the server. The add dialog shows the warning before _Add_.
7. With openFDA unreachable, severity still shows, with "Label text unavailable right now."
8. Lint, unit, integration and e2e pass; coverage targets are met.

## Open questions (need your answer)

1. **AI in this module?** The intent calls for AI summaries with source links. _Recommendation: not here. The interaction view is safest as severity plus verbatim label quotes. Introduce the Claude API in the `drug-info` module, then add an optional "Explain this interaction" summary here later._
2. **Warning inside the add dialog?** _Recommendation: yes, show it before Add. Checking a new prescription is the main reason you use the app._
3. **ONC high-priority list** as an always-Major override on top of DDInter? _Recommendation: not now. DDInter already rates those pairs Major; revisit if gaps appear._
4. **Is the GitHub repo `amanoos/my-tracker` public?** It doesn't change the design (DDInter data is never committed), but if it's public, check that nothing else sensitive is there. _Recommendation: keep it private._
