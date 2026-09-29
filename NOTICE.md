# Notices

RxPlus's own code is under the [MIT License](LICENSE). This page lists what it uses or contains from others, and on what terms. Licenses below apply to the third-party material, not to RxPlus's code.

## Data in this repository

These files are small samples kept so the tests run without calling live services.

| Files                                      | Source                                                                                               | Terms                                                                                                                                                                                                 |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `e2e/fixtures/ddinter-sample.csv` (3 rows) | [DDInter 2.0](https://ddinter2.scbdd.com)                                                            | [CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/): attribution, **non-commercial**, share-alike. This file stays under those terms, not MIT.                                      |
| `src/server/rxnorm/fixtures/**`            | RxNorm and RxClass via [RxNav](https://lhncbc.nlm.nih.gov/RxNav/), U.S. National Library of Medicine | Public NLM API responses. RxNorm source vocabularies may carry their own terms; see the [RxNorm license information](https://www.nlm.nih.gov/research/umls/rxnorm/docs/termsofservice.html).          |
| `src/server/openfda/fixtures/**`           | [openFDA](https://open.fda.gov) (FDA labels, FAERS reports, Drugs@FDA)                               | Public domain ([CC0](https://open.fda.gov/terms/)).                                                                                                                                                   |
| `src/server/pubmed/fixtures/**`            | [PubMed](https://pubmed.ncbi.nlm.nih.gov) via NCBI E-utilities                                       | Citation data is from NLM. **Abstracts remain under their publishers' copyright**; they're kept only as short test samples. See [NCBI's policies](https://www.ncbi.nlm.nih.gov/home/about/policies/). |
| `src/server/ctgov/fixtures/**`             | [ClinicalTrials.gov](https://clinicaltrials.gov)                                                     | U.S. government data; see its [terms](https://clinicaltrials.gov/about-site/terms-conditions).                                                                                                        |
| `src/server/medlineplus/fixtures/**`       | [MedlinePlus Connect](https://medlineplus.gov/medlineplus-connect/overview/), NLM                    | See MedlinePlus's [terms](https://medlineplus.gov/about/using/usingcontent/).                                                                                                                         |
| `src/server/costplus/fixtures/**`          | [Mark Cuban Cost Plus Drug Company](https://costplusdrugs.com) public API                            | Prices as published; not an offer or a quote.                                                                                                                                                         |

## Data the running app fetches

The app calls the same services at run time (DDInter is imported once with `ddi:import`). Each deployment is responsible for following their terms, including DDInter's non-commercial license and NCBI's request-rate guidelines. No account is needed except for the optional openFDA, NCBI and Anthropic keys.

## Software

- **Dependencies** are listed in `package.json`; each keeps its own license. All are open source (MIT, Apache-2.0 or 0BSD) **except PrimeNG and `@primeuix/themes`**, below.
- **PrimeNG and `@primeuix/themes`** (the UI components and theme) are **not open source**: they're under the PrimeUI License from PrimeTek Informatics, and the MIT license above doesn't cover them. The free [Community License](https://primeui.dev/licenses/community) covers individuals, small organizations and non-commercial open-source projects; others need a [Commercial License](https://primeui.dev/licenses/commercial). They're installed by `npm ci`, not included in this repository. Each deployment enters its own license key at build time (`VITE_PRIMEUI_LICENSE`); without one the app works but shows a license notice in the browser console.
- **Fonts:** [Bricolage Grotesque](https://fonts.google.com/specimen/Bricolage+Grotesque) and [DM Sans](https://fonts.google.com/specimen/DM+Sans), SIL Open Font License, loaded from Google Fonts.
- **Design:** the look takes its palette, type pairing and shapes from the Groupsy by Photobucket website as a reference (see [docs/design.md](docs/design.md)). No Photobucket or Groupsy names, logos, images, text or code are used.

## Not medical advice

RxPlus is for information and for questions to bring to a prescriber or pharmacist. It never recommends starting, stopping or changing a medication, and it can be wrong or out of date. Always confirm with a pharmacist or prescriber.
