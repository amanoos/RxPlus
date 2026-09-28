# Spec: pricing

Module of [CAPABILITY-MAP.md](CAPABILITY-MAP.md). Depends on: `medications`, and reuses `drug-info` (drug page, RxNav client). Status: **approved 2026-09-28**.
Research basis: [docs/research/free-data-sources.md](docs/research/free-data-sources.md) §8, plus the queries measured below.

## Objective

Show **what each medication costs**, paying cash at a real pharmacy versus paying with insurance, per month and in total, so the owner can see where cash beats their copay.

**User story:** "On the Costs page I see: lisinopril 10 MG, 30 tablets a month: **Cost Plus Drugs $0.39/month** cash, **my copay $10.00 per 90 tablets = $3.33/month**. Atorvastatin 20 MG: Cost Plus $0.42/month, copay $5 per 30 = $5.00/month, so cash is cheaper by $4.58. Total: $0.81 cash vs $8.33 with insurance. On each drug page a **Prices** section shows the same for that product, with a link to buy it at Cost Plus."

Out of scope: per-pharmacy retail prices (no free source), discount-card prices (GoodRx has no open API), NADAC and Medicare Part D reference prices (not chosen), insurance plan rules (deductibles, coinsurance), buying or ordering anything, price history charts.

## Decisions (2026-09-28)

1. **Price source:** Cost Plus Drugs (Mark Cuban Cost Plus Drug Company) only, via its public API.
2. **Insurance:** the owner enters their **copay per fill** (amount and fill size) per medication.
3. **Totals:** **units per month** per medication (default 30); costs shown per month.
4. **Placement:** a **Prices** section on each drug page and a **Costs** page with all active medications and the monthly totals.

## Data source (verified 2026-09-28)

| Content    | Source                                                                                                                            | Notes                                                                                                                                                                                                                                                                                                                                          |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Cash price | Cost Plus Drugs public API `GET https://us-central1-costplusdrugs-publicapi.cloudfunctions.net/main?medication_name=<ingredient>` | No key. One result per product they sell: `strength`, `form`, `brand_generic`, `ndc`, `unit_price`, `unit_billing_price`, `url`. Lisinopril 10mg tablet: `unit_billing_price` $0.0131, `unit_price` $0.011. Atorvastatin 4 strengths, metformin 3, spironolactone 3; apixaban and semaglutide: none (brand-only drugs are mostly not carried). |
| Matching   | RxNav `GET /rxcui/<product>/ndcs.json`                                                                                            | The product matches a Cost Plus item when the item's NDC is one of the RxNorm product's NDCs (lisinopril 10 MG Oral Tablet 314076 includes Cost Plus's 68180098003). No NDC match → "Not sold at Cost Plus Drugs". Never matched by name alone.                                                                                                |

- **Price used:** `unit_billing_price` (what an order is billed per unit). Cost Plus also charges fixed per-order fees (pharmacy labor and shipping, shown at checkout); these are **not** in the monthly figure, and the page says so with a link to the product.
- **Freshness:** prices cached 24 hours in the server; "as of" time shown. NDC lists cached 7 days.
- **Pacing:** Cost Plus and RxNav calls are spaced (≤ 2/s for Cost Plus); one lookup per ingredient serves all its strengths.

## Owner entries (per medication)

Stored on the medication (active or stopped):

- `unitsPerMonth` (number, default 30, e.g. 60 for twice daily, 0.5 steps allowed)
- `copayAmount` (dollars and cents) and `copayUnits` (units per fill, e.g. 90), both optional; set together
- Entered in the medication's edit dialog ("Cost") and from the Prices section.

## Calculations

- Cash per month = `unitsPerMonth × unit_billing_price`, rounded to cents for display.
- Insured per month = `copayAmount × unitsPerMonth / copayUnits`.
- Difference: "Cash is cheaper by $X/month" or "Your copay is cheaper by $X/month" when both exist; nothing claimed when either is missing.
- Costs page total: sums over active medications that have each figure; says how many are missing a cash price or a copay ("2 of 4 without a copay").

## Data model (Drizzle, migration `0006_*`)

```ts
// medications: new columns
unitsPerMonth: numeric({ precision: 6, scale: 1 }).notNull().default('30'),
copayCents: integer(),        // null = not entered
copayUnits: numeric({ precision: 6, scale: 1 }),
```

Cost Plus answers are not stored in Postgres (cache in memory only): they are public, cheap to fetch and change often.

## API (session required)

| Method and path                | Purpose                                                                                       | Response                                             |
| ------------------------------ | --------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| `GET /api/drugs/:rxcui/prices` | Cost Plus match for the product: price per unit, product link, as-of time, or "not sold"      | 200; 503 when Cost Plus is unreachable               |
| `GET /api/costs`               | Active medications with units/month, copay, Cost Plus price, monthly cash and insured, totals | 200 (items without a price are listed with a reason) |
| `PATCH /api/medications/:id`   | Existing route, gains `unitsPerMonth`, `copay: { amountCents, units } \| null`                | 200                                                  |

## UI

- **Drug page, Prices section:** "Cost Plus Drugs: $0.0131 per tablet → $0.39 for 30 tablets/month (plus per-order fees) · Buy at Cost Plus Drugs ↗ · as of 9:14 AM". For a medication on the list: units/month and copay with an Edit button, and the monthly comparison. Not sold / unavailable states.
- **Costs page** (`/costs`, in the navigation): table (cards below 768px) per active medication: units/month, Cost Plus monthly, copay monthly, cheaper option; totals row; "Edit" opens the medication's cost fields. A note: prices are Cost Plus's list prices, not a quote; copays are what you entered.
- **Medication edit dialog:** "Units per month" and "Copay (optional): $__ for __ units".

## Testing

- **Unit:** Cost Plus client (query, parsing `$0.0131`, empty results, errors, cache); NDC matching; monthly math and rounding; totals with missing data; reducers, effects, components.
- **Integration (test DB):** migration; PATCH with the new fields (validation: units > 0, copay both-or-neither); `/api/costs` with stubbed Cost Plus and RxNav.
- **E2E:** the stub server gains Cost Plus answers; set units and a copay, see the drug page Prices section and the Costs page totals.
- **Live check:** prices for the current medications (matches, not-sold cases).
- **Coverage:** ≥ 80% lines on the new server and client code.

## Boundaries

- **Always:** link to the Cost Plus product page; say fees aren't included; say when a product isn't sold or a price is missing; show the as-of time.
- **Ask first:** adding another price source; storing price history.
- **Never:** recommend switching pharmacy or drug; buy or place orders; send notes or the medication list anywhere (only ingredient names go to Cost Plus); match by name when NDCs don't match.

## Success criteria

1. A product sold by Cost Plus shows its per-unit price, monthly cash cost and a working product link; one not sold says so.
2. Units per month and a copay can be set per medication; the monthly insured cost and the difference appear.
3. The Costs page lists active medications with totals and counts what's missing.
4. Cost Plus being down shows "Prices are unavailable right now" without breaking the page.
5. Lint, unit, integration and e2e tests pass; coverage targets are met.

## Open questions

- None blocking. (Fees: shown as a note rather than estimated, since Cost Plus sets them per order.)
