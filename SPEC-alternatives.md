# Spec: alternatives

Module of [CAPABILITY-MAP.md](CAPABILITY-MAP.md). Depends on: `medications`, and reuses `drug-info` (drug page, RxNav and openFDA clients). Status: **approved 2026-09-27**.
Research basis: [docs/research/free-data-sources.md](docs/research/free-data-sources.md) (§1 RxClass, Drugs@FDA), plus the queries measured below.

## Objective

For each drug the owner takes, show **what else exists**: other drugs in the same class, other drug classes used for the **same condition**, and **newly approved** drugs for that condition. It's for awareness and for questions to bring to the prescriber, never a recommendation to switch.

**User story:** "On the _lisinopril 10 MG Oral Tablet_ page, under **Alternatives**, I've said I take it **for hypertension**. I see:

- **New for hypertension:** aprocitentan (Tryvio, first approved 2024; no generic yet)
- **Same class (ACE inhibitors):** benazepril, captopril, enalapril, fosinopril, moexipril, perindopril, quinapril, ramipril, trandolapril; each with its first US approval year and whether a generic exists
- **Other classes for hypertension:** ARBs (losartan, valsartan, …), calcium channel blockers (amlodipine, …), thiazide diuretics, beta blockers, and so on, collapsed by class

Each name links to its own drug page (facts, summary, research). The note at the top says these are options to discuss with a prescriber, not recommendations."

Out of scope: prices (the `pricing` module), week-to-week alerts about new approvals (the `digest` module), AI comparisons between drugs, dosing equivalence.

## Decisions (2026-09-27)

1. **Scope:** same class + other classes for the same condition, with newly approved drugs flagged.
2. **Condition:** chosen per medication ("Taken for"), from the drug's known uses. Without a choice, the section asks for one.
3. **New:** first FDA approval of a new molecule within the **last 5 years**.
4. **Details:** name, class, first US approval year, generic available (yes/no), link to the drug page. **No AI.**

## Data sources (verified 2026-09-27)

| Content                 | Source                                                                                         | Notes                                                                                                                                                                                                                                                                                                                       |
| ----------------------- | ---------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The drug's class        | RxClass `byRxcui`, `relaSource=DAILYMED`, `rela=has_epc` (FDA Established Pharmacologic Class) | lisinopril → "Angiotensin Converting Enzyme Inhibitor" (N0000175562)                                                                                                                                                                                                                                                        |
| Same-class drugs        | RxClass `classMembers?classId=<EPC>&relaSource=DAILYMED&rela=has_epc`                          | 17 members for ACE inhibitors, incl. 8 active metabolites ("…prilat") and 2 salt forms, which are dropped (below)                                                                                                                                                                                                           |
| The drug's known uses   | RxClass MED-RT `may_treat` (already fetched for the drug page)                                 | lisinopril: hypertension, heart failure, myocardial infarction, diabetic nephropathies, left ventricular dysfunction                                                                                                                                                                                                        |
| Same-condition drugs    | RxClass `classMembers?classId=<disease>&relaSource=MEDRT&rela=may_treat`                       | Hypertension: 231 entries (137 ingredients, 94 salt forms)                                                                                                                                                                                                                                                                  |
| Their class             | RxClass `byRxcui` EPC per ingredient                                                           | Groups the list by class                                                                                                                                                                                                                                                                                                    |
| US availability         | RxNav: the ingredient has at least one prescribable clinical drug (SCD)                        | Drops non-US drugs (bopindolol, lacidipine, cilazapril, …) and metabolites                                                                                                                                                                                                                                                  |
| First approval, generic | openFDA Drugs@FDA `drugsfda.json?search=products.active_ingredients.name:<NAME>*`              | First approval = earliest original (`ORIG`) NDA approval with that ingredient; generic = any ANDA whose product has that ingredient alone. Names are matched exactly or as "<name> <salt>", so "enalapril" never matches "enalaprilat". Measured: lisinopril 1987 / 33 ANDAs; enalapril 1985 / 36; aprocitentan 2024 / none |
| Link target             | RxNav Prescribe drugs for the ingredient                                                       | A representative product: the first single-ingredient oral tablet or capsule, else the first single-ingredient product                                                                                                                                                                                                      |

### Cleaning the same-condition list

MED-RT's "may treat Hypertension" also lists drugs for **pulmonary** hypertension (bosentan, sildenafil, treprostinil, …): 20 of the 24 pulmonary-hypertension drugs are in it, but so are hydralazine and nitroglycerin, which do treat hypertension. Rule:

- Keep only **ingredients** (salt forms are mapped to their ingredient) with a US prescribable product.
- For drugs that are also listed for a **more specific form** of the condition (a MED-RT disease whose name contains the condition's name, e.g. "Hypertension, Pulmonary"), keep them only if their FDA label's indications mention the condition **other than** in that specific form (e.g. "hypertension" not within "pulmonary (arterial) hypertension"). Hydralazine and nitroglycerin stay; bosentan and sildenafil go.
- The drug itself and its same-class drugs are not repeated under "other classes".
- A **Hide** button removes an alternative that isn't relevant (undo: "Show hidden"), for what the rules miss.

## Behavior

- **"Taken for":** a new optional field on each medication, chosen in the edit dialog (and on the drug page) from the drug's known uses. Stored as the MED-RT disease id and name. For a drug page of a product not on the list, the choice applies to that visit only.
- **Per-condition lists are shared and stored:** building the list for a condition (e.g. hypertension) takes many upstream calls (about 2 RxNav + 1–2 openFDA per ingredient, ~100 ingredients), so it runs **in the background**, is stored in Postgres, and is reused by every drug taken for that condition. Refreshed after 30 days, or with "Check for new approvals". The page shows "Finding alternatives…" and polls every 2 s, like summaries.
- **Same-class list:** per ingredient, a few calls, built on first view and stored the same way.
- **New:** first approval within 5 years of today is shown in its own group at the top and marked "New (2024)" wherever it appears.
- **Combination products:** alternatives per ingredient.
- Upstream calls are spaced (RxNav ≤ 20/s; openFDA with the owner's key, 240/min limit respected) and cached; one failed ingredient doesn't fail the list (it's left out and counted).

## Data model (Drizzle, `src/server/db/schema/alternatives.ts`, migration `0004_*`)

```ts
medications: add takenForId: text(), takenForName: text()   // MED-RT disease

alternativeLists = pgTable('alternative_lists', {
  key: text().primaryKey(),            // 'condition:D006973' or 'class:N0000175562'
  kind: text({ enum: ['condition', 'class'] }).notNull(),
  name: text().notNull(),               // 'Hypertension' / 'Angiotensin Converting Enzyme Inhibitor'
  status: text({ enum: ['pending', 'ready', 'failed'] }).notNull(),
  builtAt: timestamp({ withTimezone: true }),
  skipped: integer(),                   // ingredients left out after upstream errors
  error: text(),
});

alternativeDrugs = pgTable('alternative_drugs', {
  listKey: text().notNull(),
  ingredientRxcui: text().notNull(),
  name: text().notNull(),
  classId: text(), className: text(),   // FDA EPC
  firstApproved: date(),                // earliest NDA ORIG approval
  genericAvailable: boolean().notNull(),
  productRxcui: text(),                 // representative product for the link
}, (t) => [primaryKey({ columns: [t.listKey, t.ingredientRxcui] })]);

alternativeHidden = pgTable('alternative_hidden', {
  ingredientRxcui: text().notNull(),    // the drug being viewed (per ingredient)
  hiddenRxcui: text().notNull(),
  hiddenAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.ingredientRxcui, t.hiddenRxcui] })]);
```

## API (session required)

| Method and path                                                   | Purpose                                                                                                                                                             | Response                                                                    |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `GET /api/drugs/:rxcui/alternatives?condition=<id>`               | Per ingredient: same-class list, and, for the condition (the medication's "Taken for" or the query), new + other classes; starts background builds that are missing | 200 with lists and their status (`pending` while building); 422 non-product |
| `POST /api/drugs/:rxcui/alternatives/refresh`                     | "Check for new approvals": rebuild the lists now (background)                                                                                                       | 202                                                                         |
| `PATCH /api/medications/:id`                                      | Existing route, gains `takenFor: { id, name } \| null`                                                                                                              | 200                                                                         |
| `POST /api/alternatives/:ingredient/hidden/:rxcui` and `DELETE …` | Hide / unhide an alternative for that drug                                                                                                                          | 204                                                                         |

## UI

- **"Alternatives" section** on `/drugs/:rxcui`, after Research; one block per ingredient for combinations.
- **Top note, always visible:** "Other drugs used for the same purpose. Not a recommendation: talk to your prescriber before changing anything."
- **Condition chooser** when no "Taken for" is set: the drug's known uses as buttons ("What do you take lisinopril for?"). Once chosen: "For hypertension (change)".
- **Groups:** "New for <condition>" (if any) · "Same class (<class>)" · "Other classes for <condition>", the last collapsed per class with counts ("Calcium channel blockers (9)").
- **Each drug:** name (link to its drug page), "New (2024)" tag when new, first approved year, "Generic available" / "No generic yet", Hide.
- **States:** "Finding alternatives…" while building (can take a minute the first time), failed with Try again, a note when some drugs were skipped.
- **Medication card and edit dialog:** "For: Hypertension" and the "Taken for" select.
- **Footer:** "From RxClass (FDA and MED-RT) and Drugs@FDA, updated <date>." and "Check for new approvals".

## Testing

- **Unit:** RxClass class members and disease members mapping (metabolites and salts dropped, salt → ingredient); availability check; Drugs@FDA mapping (first ORIG NDA date, ANDA alone, exact name/salt matching incl. the enalaprilat case); the pulmonary-hypertension rule (recorded lists: hydralazine and nitroglycerin kept, bosentan and sildenafil dropped); grouping and the 5-year "new" rule; representative product choice.
- **Integration (test DB):** migration; list builder with stubbed clients (happy path, partial failures counted, shared reuse across drugs, 30-day refresh); routes; `takenFor` on medications; hide/unhide.
- **E2E:** the stub server gains RxClass members, Drugs@FDA and label fixtures; the spec sets "Taken for" on lisinopril, sees the new, same-class and other-class groups, opens an alternative's drug page, and hides one.
- **Live check at the checkpoint:** lisinopril for hypertension (build time, counts per group, a manual look at noise).
- **Coverage:** ≥ 80% lines on `src/server/alternatives`, `src/app/features/alternatives`.

## Boundaries

- **Always:** show the "not a recommendation" note; link every drug to its page; say when drugs were skipped; space and cache upstream calls.
- **Ask first:** adding AI to this module; showing drugs not available in the US; changing the 5-year rule or the cleaning rule.
- **Never:** rank alternatives as better or worse; suggest switching; imply dose equivalence; send anything to an AI model.

## Success criteria

1. With "Taken for: Hypertension" on lisinopril, the section shows aprocitentan as new (2024), the 9 US ACE inhibitors as same class (no "…prilat"), and other classes for hypertension without pulmonary-hypertension-only drugs.
2. Each drug shows its first approval year and generic availability matching Drugs@FDA, and links to a drug page that loads.
3. The first build for a condition runs in the background with visible progress; later visits (and other drugs taken for the same condition) load instantly from storage.
4. "Taken for" can be set and changed from the edit dialog and the drug page, and shows on the medication card.
5. Hide removes an alternative for that drug and survives reloads; "Show hidden" undoes it.
6. Upstream failures leave out single drugs with a visible count, or fail the build with Try again; the rest of the drug page is unaffected.
7. No AI is involved (no model calls from this module).
8. Lint, unit, integration and e2e tests pass; coverage targets are met.

## Checkpoint A (live, 2026-09-27)

- **Hypertension:** built in 55 s, nothing skipped: new aprocitentan (2024) and baxdrostat (2026); 9 same-class drugs; 60 drugs in 17 other classes; no pulmonary-hypertension drugs. **Heart failure:** 29 s, 39 drugs in 18 classes. The shared ACE-inhibitor class list: 7 s.
- **Kept as is (owner's decision):** injection-only drugs (enalaprilat, clevidipine, esmolol, nitroprusside, milrinone, mannitol, somatropin) and products with neither an FDA class nor an approval (phenylalanine, CoQ10). Hide covers them.
- **Known gaps:** moexipril has no FDA-class link, so it's under "Other"; combination-only ingredients (sacubitril, as in Entresto) are left out; MED-RT lags new drugs (vericiguat, 2021, isn't listed for heart failure yet).
- Success criterion 1's "no …prilat" doesn't hold for enalaprilat, which is a real US injectable; kept per the decision above.

## Open questions

- None blocking. The cleaning rule is measured on hypertension; other conditions (e.g. heart failure) are checked at the live checkpoint and Hide covers the rest.
