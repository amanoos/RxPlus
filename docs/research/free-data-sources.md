# Free data sources for RxPlus

Investigated 2026-09-27. Every endpoint below was called live from this machine unless marked _not verified_. Example drug: lisinopril (RxNorm ingredient 29046, product 314076).

## Summary: what each feature can use

| Feature (module)                                 | Best free source(s)                                                                                     | Structured?     | Verified  |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------- | --------------- | --------- |
| Identify drugs (medications)                     | RxNorm via RxNav                                                                                        | Yes             | ✅ in use |
| Purpose / what it treats (drug-info)             | RxClass (MED-RT `may_treat`, `may_prevent`), openFDA label `indications_and_usage`, MedlinePlus Connect | Yes + text      | ✅        |
| Side effects (drug-info)                         | openFDA label `adverse_reactions` / `boxed_warning`; FAERS report counts                                | Text + counts   | ✅        |
| Efficacy (drug-info, literature)                 | openFDA label `clinical_studies`; PubMed RCTs/meta-analyses; ClinicalTrials.gov results                 | Text + metadata | ✅        |
| **Interaction severity (interactions)**          | **DDInter 2.0** (Major/Moderate/Minor) mapped to RxNorm                                                 | **Yes**         | ✅        |
| Interaction explanation (interactions)           | openFDA / DailyMed label `drug_interactions` section                                                    | Text            | ✅        |
| Contraindicated conditions (interactions, later) | RxClass MED-RT `ci_with`                                                                                | Yes             | ✅        |
| Alternatives (alternatives)                      | RxClass same class (ATC, EPC, VA) + `classMembers`; Drugs@FDA approvals                                 | Yes             | ✅        |
| Papers and trials (literature, digest)           | PubMed E-utilities; ClinicalTrials.gov API v2                                                           | Yes             | ✅        |
| Prices (pricing)                                 | NADAC (weekly pharmacy acquisition cost per unit); Medicare Part D average spend per unit               | Yes             | ✅        |

The only gaps with no good free source are **retail cash prices by pharmacy** and **your own insurance copay** (manual entry remains the plan).

## Sources

### 1. RxNorm / RxNav (NLM)

- **Base:** `https://rxnav.nlm.nih.gov/REST`. No key. NLM asks for at most 20 requests per second per IP.
- **Interaction API:** retired about 2024-01-02. `GET /interaction/list.json` now returns **404** (verified). It was built on ONCHigh plus a limited DrugBank subset.
- **RxClass** (`/rxclass/class/byRxcui.json?rxcui=29046`) returned, for lisinopril:
  - `MEDRT may_treat`: Hypertension, Heart Failure, Myocardial Infarction, Diabetic Nephropathies
  - `MEDRT may_prevent`: Left Ventricular Hypertrophy/Dysfunction
  - `MEDRT ci_with` (contraindicated with): Angioedema, Hypotension, Hyperaldosteronism, Drug Hypersensitivity
  - `MEDRT has_moa`, `has_pe`: mechanism and physiologic effects
  - Classes: ATC `C09AA` ACE inhibitors, plain; FDA EPC "Angiotensin Converting Enzyme Inhibitor"; VA class
- **Class members** (`/rxclass/classMembers.json?classId=…&relaSource=…`): other drugs in the same class. This is the basis for "alternatives".
- **RxTerms** (`/RxTerms/rxcui/314076/allinfo.json`): patient-friendly display name ("Lisinopril (Oral Pill)"), route, strength.
- **NDCs** (`/rxcui/314076/ndcs.json`): 245 NDCs for lisinopril 10 MG Oral Tablet. This is the bridge to pricing.
- **Name normalization** (`/rxcui.json?name=…&search=2`): maps international names to RxNorm (Acetylsalicylic acid → aspirin 1191, Salbutamol → albuterol 435, Paracetamol → acetaminophen 161).
- **License:** RxNorm itself is free. MED-RT, ATC and VA content come through NLM with their own attribution notes. Personal use is fine.

### 2. DDInter 2.0 (drug–drug interactions with severity)

- **Site:** https://ddinter2.scbdd.com. Paper: [NAR 2025, 53(D1):D1356](https://academic.oup.com/nar/article/53/D1/D1356/7740584).
- **Download:** one CSV per ATC letter (`/static/media/download/ddinter_downloads_code_<A..V>.csv`); 14 files downloaded, about 3.5 MB each at most.
- **Columns:** `DDInterID_A, Drug_A, DDInterID_B, Drug_B, Level`. Names are quoted when they contain commas, so a real CSV parser is needed.
- **Content (parsed):** 234,981 unique pairs across 1,971 drugs.
  - Major 39,082; Moderate 143,748; Minor 9,736; Unknown 42,415.
  - The website (not the CSV) also has mechanism and management text per pair.
- **Spot checks:**
  - lisinopril + spironolactone: Major
  - lisinopril + potassium chloride: Major
  - sertraline + phenelzine: Major
  - simvastatin + clarithromycin: Major
  - warfarin + acetylsalicylic acid: Major
  - atorvastatin + lisinopril: Unknown (listed, no rating)
- **RxNorm mapping:** 149/150 random DDInter names resolved with `rxcui.json?search=2` (99%). The miss was "Insulin human (zinc extended)". Suffixes such as "(topical)" need stripping first.
- **License:** CC BY-NC-SA 4.0. The terms allow downloading "for your own personal, non-commercial, informational or scholarly use", with attribution. **This fits RxPlus as a personal app. It would not allow a commercial product.**
- **Caveat:** an academic dataset, updated per release rather than continuously. Severity is DDInter's own grading, so the app should show it as "DDInter: Major", with the source.

### 3. DailyMed (NLM) and openFDA drug labels (FDA)

- **DailyMed:** `https://dailymed.nlm.nih.gov/dailymed/services/v2/spls.json?rxcui=314076` returns current labels (SPL set IDs, versions, dates). Full label XML is available per set ID.
- **openFDA label:** `https://api.fda.gov/drug/label.json?search=openfda.rxcui:314076` returns the same labels already split into sections: `indications_and_usage`, `boxed_warning`, `contraindications`, `warnings_and_cautions`, `adverse_reactions`, **`drug_interactions`**, `clinical_studies`, `mechanism_of_action`, `pregnancy`, `information_for_patients`, and more.
  - Example `drug_interactions` for lisinopril: diuretics (excessive BP drop), NSAIDs (renal impairment), dual RAS blockade, lithium, …
- **openFDA FAERS** (`/drug/event.json … &count=patient.reaction.reactionmeddrapt.exact`): counts of reported adverse reactions. These are reports, not rates, so they need a clear disclaimer.
- **openFDA Drugs@FDA** (`/drug/drugsfda.json`): approvals and application history. Useful for "newly approved alternatives".
- **Limits:** without a key, 240 requests/min and 1,000/day; a free key raises the daily cap (_daily figures from openFDA docs, not verified here_).
- **License:** FDA label text is public domain. openFDA's own disclaimer says not to rely on it for medical decisions, so the app will show it as information with sources.

### 4. MedlinePlus Connect (NLM)

- `https://connect.medlineplus.gov/service?mainSearchCriteria.v.cs=2.16.840.1.113883.6.88&mainSearchCriteria.v.c=29046&knowledgeResponseType=application/json` returns links to the consumer drug page "Lisinopril" (`medlineplus.gov/druginfo/meds/a692051.html`) and the topic "Blood Pressure Medicines".
- Best used as a plain-language "Learn more" link. The drug monographs are licensed content, so link to them rather than copy them.

### 5. PubMed (NCBI E-utilities)

- `esearch.fcgi?db=pubmed&term=lisinopril[majr] AND (randomized controlled trial[pt] OR meta-analysis[pt])&sort=relevance`: 307 hits. This is the query for the "up to 10 key papers" feature.
- **Digest gotcha:** new articles aren't MeSH-indexed for weeks. `lisinopril[majr]` with entry dates Aug 1–Sep 27 2026 returned **0**; `lisinopril[tiab]` returned **8**. The weekly digest must search `[tiab]` by entry date (`datetype=edat` **with both** `mindate` and `maxdate`; `mindate` alone is ignored).
- **Limits:** 3 requests/s without a key, 10/s with a free NCBI key (_from NCBI docs_).
- Store PMIDs, titles and links. Abstracts belong to their publishers, so link out and let the AI summary cite them.

### 6. ClinicalTrials.gov API v2

- `https://clinicaltrials.gov/api/v2/studies?query.intr=lisinopril&filter.overallStatus=RECRUITING,COMPLETED&countTotal=true&fields=…` returns 111 studies, with NCT IDs, titles, phase and status.
- Supports "trials for my drugs" and "new or updated trials" in the digest (by last-update date). No key.

### 7. PubChem (NCBI)

- `rest/pug/compound/name/lisinopril/cids/JSON` returns CID 5362119. PUG-View has chemistry and pharmacology summaries.
- Its "Drug-Drug Interactions" section is an **external table sourced from DrugBank** (`drugbankddi`). The query endpoint I tried (`/sdq/sdqagent.cgi`) returned 404, so I couldn't pull the rows.
- Even if reachable, it's DrugBank's open subset: interaction descriptions **without severity levels**. Severity is in DrugBank's paid dataset. **Not recommended for severity**; DDInter is better.

### 8. Pricing: NADAC (Medicaid) and Medicare Part D (CMS)

- **NADAC 2026** (data.medicaid.gov dataset `fbb83258-…`, modified 2026-09-22), datastore query by `ndc_description`/`ndc`:
  - LISINOPRIL 10 MG TABLET: **$0.01815 per tablet**, effective 2026-09-23.
  - Weekly. This is what pharmacies pay (acquisition cost), not what patients pay.
- **Medicare Part D Spending by Drug** (data.cms.gov API, modified 2026-06-25):
  - Lisinopril average spend per dosage unit (2024): **$0.089** overall.
  - Annual. This is roughly what Medicare plans and patients paid.
- **Pipeline:** RxNorm product → NDCs (RxNav) → NADAC per unit; ingredient name → Part D average. Show both as reference points, alongside user-entered copays.
- **Not available free:** per-pharmacy retail cash prices and discount-card prices (e.g. GoodRx has no open API).

### 9. Other free sources worth knowing (_not verified here_)

- **ONC High-Priority DDI list** (JAMIA 2012; 15 critical interaction classes) plus **CredibleMeds** (QT-prolonging drugs, free registration): a small, authoritative "never combine" overlay.
- **TWOSIDES / nSIDES** (Tatonetti lab): statistical side-effect signals mined from FAERS. Research-grade, not for severity.
- **RxNav-in-a-Box:** the whole RxNav stack as a Docker image to run on your home server. Removes the rate limit and the outage risk (requires a UMLS license, which is free).

## Recommendation for the interactions module

1. **Severity:** DDInter 2.0. Import the CSVs into Postgres, mapping names to RxNorm ingredient IDs (99% coverage). Label ratings as "DDInter: Major/Moderate/Minor/Unknown" with attribution (CC BY-NC-SA). Refresh on each DDInter release.
2. **Explanation:** the matching paragraph of each drug's FDA label `drug_interactions` section (openFDA), shown verbatim with the source. The AI summarizes it but never assigns severity.
3. **Condition warnings (optional):** RxClass `ci_with`.
4. **Optional safety net:** the ONC high-priority list as an always-Major override.

This meets the original constraint: severity comes from structured data, never from AI wording. It costs nothing, and its license fits a personal, non-commercial app.

## Impact on earlier assumptions

- **Pricing is better than expected.** NADAC (weekly) and Medicare Part D (annual) give two real, free reference prices per product. Only retail pharmacy cash prices and personal copays remain manual.
- **drug-info needs no paid source.** RxClass covers purpose and class; openFDA covers side effects and label sections; MedlinePlus covers plain language.
- **The digest must search PubMed by title/abstract plus entry-date window, not by MeSH major topic.**
