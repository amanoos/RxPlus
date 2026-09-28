// Stand-in for RxNav, openFDA, MedlinePlus Connect, PubMed, ClinicalTrials.gov,
// Cost Plus Drugs and Ollama during e2e runs:
// serves the recorded fixtures used by the unit tests. Started by Playwright
// (see playwright.config.ts).
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';

const PORT = Number(process.env['STUB_UPSTREAM_PORT'] ?? 4399);
const SERVER = join(import.meta.dirname, '..', 'src', 'server');
const RXNORM_FIXTURES = join(SERVER, 'rxnorm', 'fixtures');
const COSTPLUS_FIXTURES = join(SERVER, 'costplus', 'fixtures');
const OPENFDA_FIXTURES = join(SERVER, 'openfda', 'fixtures');
const MEDLINEPLUS_FIXTURES = join(SERVER, 'medlineplus', 'fixtures');
const PUBMED_FIXTURES = join(SERVER, 'pubmed', 'fixtures');
const CTGOV_FIXTURES = join(SERVER, 'ctgov', 'fixtures');
/** A real qwen2.5:7b answer for the lisinopril label (quotes match summary-label-314076). */
const OLLAMA_SUMMARY = join(import.meta.dirname, 'fixtures', 'ollama-lisinopril-summary.json');
/** Takeaways for the four fixture papers; each quote is a sentence of its own abstract. */
const OLLAMA_TAKEAWAYS = join(import.meta.dirname, 'fixtures', 'ollama-lisinopril-takeaways.json');

const rxnav: Record<string, string> = {
  '/REST/Prescribe/displaynames.json': 'displaynames-sample',
  '/REST/Prescribe/drugs.json?name=lisinopril': 'drugs-lisinopril',
  '/REST/Prescribe/drugs.json?name=spironolactone': 'drugs-spironolactone',
  '/REST/rxclass/class/byRxcui.json?rxcui=29046': 'rxclass-all-29046',
};
for (const id of ['314076', '104377', '197885', '29046', '313096']) {
  rxnav[`/REST/rxcui/${id}/properties.json`] = `properties-${id}`;
  rxnav[`/REST/rxcui/${id}/related.json?tty=IN+BN+DF`] = `related-${id}`;
  rxnav[`/REST/rxcui/${id}/allProperties.json?prop=attributes`] = `attributes-${id}`;
}
for (const id of ['29046', '9997']) {
  rxnav[`/REST/rxclass/class/byRxcui.json?rxcui=${id}&relaSource=DAILYMED&relas=has_epc`] =
    `epc-${id}`;
  rxnav[`/REST/rxcui/${id}/related.json?tty=BN`] = `related-bn-${id}`;
}

const OPENFDA_LABELS = ['314076', '313096', '617310'];

// ── Digest: two weeks of news, switched by POST /stub/digest-week/:n ─────────────
// Week 0 is the default world the other specs use. Week 1 leaves aprocitentan off the
// hypertension list; week 2 lists it and publishes a new lisinopril label version.
let digestWeek = 0;
/** Two of the four fixture papers with details and abstracts; the rest are only counted. */
const DIGEST_PMIDS = ['37417783', '29971804'];
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);
const study = (nctId: string, title: string, dates: { first: string; results?: string }) => ({
  protocolSection: {
    identificationModule: { nctId, briefTitle: title },
    statusModule: {
      overallStatus: dates.results ? 'COMPLETED' : 'RECRUITING',
      startDateStruct: { date: '2025-01-15' },
      studyFirstPostDateStruct: { date: dates.first },
      ...(dates.results ? { resultsFirstPostDateStruct: { date: dates.results } } : {}),
      lastUpdatePostDateStruct: { date: daysAgo(1) },
    },
    designModule: { phases: ['PHASE4'] },
  },
  hasResults: !!dates.results,
});
/** Trials updated this week: one newly posted, one with results, one other update. */
const trialUpdates = () => ({
  studies: [
    study('NCT07685938', 'Lisinopril to Protect the Heart During Radiation', { first: daysAgo(2) }),
    study('NCT04550481', 'Lisinopril in Fatty Liver Disease', {
      first: '2020-09-16',
      results: daysAgo(3),
    }),
    study('NCT05530655', 'Lisinopril Dose for Urinary Toxicity', { first: '2022-09-07' }),
  ],
});

// ── Alternatives: a small world for lisinopril taken for hypertension ──────────
const concept = (rxcui: string, name: string, tty = 'IN') => ({
  minConcept: { rxcui, name, tty },
});
const members = (...list: ReturnType<typeof concept>[]) => ({
  drugMemberGroup: { drugMember: list },
});
const epc = (classId: string, className: string) => ({
  rxclassDrugInfoList: {
    rxclassDrugInfo: [{ rxclassMinConceptItem: { classId, className, classType: 'EPC' } }],
  },
});
const scd = (rxcui: string, name: string) => ({
  relatedGroup: {
    conceptGroup: [{ tty: 'SCD', conceptProperties: [{ rxcui, name, tty: 'SCD' }] }],
  },
});
/** Synthetic RxNav answers for the alternatives lists (JSON by path). */
const alternatives: Record<string, unknown> = {
  '/REST/rxclass/classMembers.json?classId=N0000175562&relaSource=DAILYMED&rela=has_epc': members(
    concept('29046', 'lisinopril'),
    concept('3827', 'enalapril'),
  ),
  '/REST/rxclass/classMembers.json?classId=D006973&relaSource=MEDRT&rela=may_treat': members(
    concept('29046', 'lisinopril'),
    concept('3827', 'enalapril'),
    concept('52175', 'losartan'),
    concept('2679059', 'aprocitentan'),
    concept('75207', 'bosentan'),
  ),
  // Bosentan is also listed for pulmonary hypertension; its label rules it out.
  '/REST/rxclass/classMembers.json?classId=D006976&relaSource=MEDRT&rela=may_treat': members(
    concept('75207', 'bosentan'),
  ),
  '/REST/rxclass/class/byRxcui.json?rxcui=52175&relaSource=DAILYMED&relas=has_epc': epc(
    'N0000175561',
    'Angiotensin 2 Receptor Blocker',
  ),
  '/REST/rxclass/class/byRxcui.json?rxcui=2679059&relaSource=DAILYMED&relas=has_epc': epc(
    'N0000191266',
    'Endothelin Receptor Antagonist',
  ),
  '/REST/rxclass/class/byRxcui.json?rxcui=75207&relaSource=DAILYMED&relas=has_epc': epc(
    'N0000191266',
    'Endothelin Receptor Antagonist',
  ),
  '/REST/Prescribe/rxcui/29046/related.json?tty=SCD': scd('314076', 'lisinopril 10 MG Oral Tablet'),
  '/REST/Prescribe/rxcui/52175/related.json?tty=SCD': scd(
    '979492',
    'losartan potassium 50 MG Oral Tablet',
  ),
  '/REST/Prescribe/rxcui/2679059/related.json?tty=SCD': scd(
    '2679064',
    'aprocitentan 12.5 MG Oral Tablet',
  ),
  '/REST/Prescribe/rxcui/75207/related.json?tty=SCD': scd('656659', 'bosentan 62.5 MG Oral Tablet'),
};
rxnav['/REST/rxcui/314076/ndcs.json'] = 'ndcs-314076';
rxnav['/REST/rxclass/class/byRxcui.json?rxcui=3827&relaSource=DAILYMED&relas=has_epc'] = 'epc-3827';
rxnav['/REST/rxclass/classTree.json?classId=D006973&relaSource=MEDRT'] = 'class-tree-D006973';
rxnav['/REST/Prescribe/rxcui/3827/related.json?tty=SCD'] = 'prescribe-scd-3827';
for (const suffix of [
  'properties.json',
  'related.json?tty=IN+BN+DF',
  'allProperties.json?prop=attributes',
]) {
  const name = suffix.split(/[./?]/)[0];
  rxnav[`/REST/rxcui/858804/${suffix}`] =
    `${name === 'allProperties' ? 'attributes' : name}-858804`;
}

/** Drugs@FDA applications for a Drugs@FDA search, from recorded fixtures or synthetic. */
function drugsFda(search: string): { status: number; body: string } {
  const ingredient = /active_ingredients\.name:"?([A-Z ]+)/.exec(search)?.[1].trim().toLowerCase();
  const kind = search.includes('application_number:ANDA') ? 'anda' : 'nda';
  const recorded = join(OPENFDA_FIXTURES, `drugsfda-${kind}-${ingredient}.json`);
  try {
    const body = readFileSync(recorded, 'utf8');
    return { status: body.includes('NOT_FOUND') ? 404 : 200, body };
  } catch {
    // losartan and bosentan: one NDA each, generics for losartan.
    const app = (number: string, name: string, date: string) => ({
      application_number: number,
      products: [{ active_ingredients: [{ name }] }],
      submissions: [
        { submission_type: 'ORIG', submission_status: 'AP', submission_status_date: date },
      ],
    });
    const synthetic: Record<string, unknown[]> = {
      'nda-losartan': [app('NDA020386', 'LOSARTAN POTASSIUM', '19950414')],
      'anda-losartan': [app('ANDA078232', 'LOSARTAN POTASSIUM', '20101006')],
      'nda-bosentan': [app('NDA021290', 'BOSENTAN', '20011120')],
    };
    const results = synthetic[`${kind}-${ingredient}`];
    return results
      ? { status: 200, body: JSON.stringify({ results }) }
      : { status: 404, body: readFileSync(join(OPENFDA_FIXTURES, 'label-none.json'), 'utf8') };
  }
}

createServer((req, res) => {
  const url = req.url ?? '';
  res.setHeader('content-type', 'application/json');
  if (url === '/health') return res.end('{"ok":true}');

  const week = /^\/stub\/digest-week\/(\d)$/.exec(url);
  if (week && req.method === 'POST') {
    digestWeek = Number(week[1]);
    return res.end(JSON.stringify({ digestWeek }));
  }

  if (url === '/ollama/api/chat' && req.method === 'POST') {
    let body = '';
    req.on('data', (chunk: Buffer) => (body += chunk));
    req.on('end', () => {
      // Label summaries and research takeaways are told apart by their system prompt.
      const system: string = JSON.parse(body).messages?.[0]?.content ?? '';
      const answer = system.startsWith('You explain medical research')
        ? OLLAMA_TAKEAWAYS
        : OLLAMA_SUMMARY;
      const reply = {
        model: 'qwen2.5:7b',
        message: { role: 'assistant', content: readFileSync(answer, 'utf8') },
        done: true,
        prompt_eval_count: 5200,
        eval_count: 950,
      };
      // A short delay so the page shows its pending state, as with the real model.
      setTimeout(() => res.end(JSON.stringify(reply)), 1500);
    });
    return;
  }

  if (url.startsWith('/pubmed/')) {
    const { pathname, searchParams } = new URL(url, 'http://stub');
    if (pathname.endsWith('/esearch.fcgi') && searchParams.get('datetype') === 'edat') {
      // The digest's entry-date search: two new papers, six in all. A week later the
      // window starts on the last run's day, which holds just those two again.
      const found = searchParams.get('term')?.includes('"lisinopril"');
      const idlist = found ? DIGEST_PMIDS : [];
      const count = !found ? '0' : digestWeek === 2 ? '2' : '6';
      return res.end(JSON.stringify({ esearchresult: { count, idlist } }));
    }
    if (pathname.endsWith('/esearch.fcgi')) {
      const lisinopril = searchParams.get('term')?.includes('"lisinopril"');
      const tier = searchParams.get('term')?.includes('[tiab]') ? 'reviews' : 'rcts';
      const fixture = lisinopril ? `esearch-${tier}-lisinopril.json` : 'esearch-none.json';
      return res.end(readFileSync(join(PUBMED_FIXTURES, fixture)));
    }
    // Details and abstracts exist for four of the found papers, so four are shown.
    if (pathname.endsWith('/esummary.fcgi')) {
      return res.end(readFileSync(join(PUBMED_FIXTURES, 'esummary-4.json')));
    }
    res.setHeader('content-type', 'application/xml');
    return res.end(readFileSync(join(PUBMED_FIXTURES, 'efetch-4.xml')));
  }

  if (url.startsWith('/ctgov/studies')) {
    const params = new URL(url, 'http://stub').searchParams;
    const lisinopril = params.get('query.intr') === 'lisinopril';
    if (params.has('filter.advanced')) {
      return res.end(JSON.stringify(lisinopril ? trialUpdates() : { studies: [] }));
    }
    const status = params.get('filter.overallStatus');
    const fixture = !lisinopril
      ? 'none.json'
      : status === 'COMPLETED'
        ? 'completed-lisinopril.json'
        : 'recruiting-lisinopril.json';
    return res.end(readFileSync(join(CTGOV_FIXTURES, fixture)));
  }

  if (url.startsWith('/costplus')) {
    // Cost Plus Drugs sells lisinopril (recorded answer); nothing else in the e2e world.
    const name = new URL(url, 'http://stub').searchParams.get('medication_name');
    const fixture = name === 'lisinopril' ? 'lisinopril.json' : 'none.json';
    return res.end(readFileSync(join(COSTPLUS_FIXTURES, fixture)));
  }

  if (url.startsWith('/medlineplus')) {
    const found = url.includes('mainSearchCriteria.v.c=29046');
    const fixture = found ? 'connect-29046.json' : 'connect-none.json';
    return res.end(readFileSync(join(MEDLINEPLUS_FIXTURES, fixture)));
  }

  if (url.startsWith('/openfda/drug/event.json')) {
    const params = new URL(url, 'http://stub').searchParams;
    if (!params.get('search')?.includes('"LISINOPRIL"')) {
      res.statusCode = 404;
      return res.end(readFileSync(join(OPENFDA_FIXTURES, 'faers-none.json')));
    }
    const fixture = params.has('count') ? 'faers-count-lisinopril' : 'faers-total-lisinopril';
    return res.end(readFileSync(join(OPENFDA_FIXTURES, `${fixture}.json`)));
  }

  const hypertension =
    '/REST/rxclass/classMembers.json?classId=D006973&relaSource=MEDRT&rela=may_treat';
  if (url === hypertension && digestWeek === 1) {
    const { drugMemberGroup } = alternatives[url] as ReturnType<typeof members>;
    const listed = drugMemberGroup.drugMember.filter((m) => m.minConcept.name !== 'aprocitentan');
    return res.end(JSON.stringify(members(...listed)));
  }
  if (alternatives[url]) return res.end(JSON.stringify(alternatives[url]));

  if (url.startsWith('/openfda/drug/drugsfda.json')) {
    const search = new URL(url, 'http://stub').searchParams.get('search') ?? '';
    const { status, body } = drugsFda(search);
    res.statusCode = status;
    return res.end(body);
  }

  if (url.startsWith('/openfda/drug/label.json') && url.includes('generic_name')) {
    const search = new URL(url, 'http://stub').searchParams.get('search') ?? '';
    const name = /generic_name:"([A-Z ]+)"/.exec(search)?.[1].toLowerCase();
    try {
      return res.end(readFileSync(join(OPENFDA_FIXTURES, `indications-${name}.json`)));
    } catch {
      res.statusCode = 404;
      return res.end(readFileSync(join(OPENFDA_FIXTURES, 'label-none.json')));
    }
  }

  if (url.startsWith('/openfda/drug/label.json')) {
    const search = new URL(url, 'http://stub').searchParams.get('search') ?? '';
    const rxcui = /openfda\.rxcui:(\d+)/.exec(search)?.[1];
    // The summary asks for the newest label that has the sections it summarizes.
    if (search.includes('_exists_:indications_and_usage')) {
      if (rxcui === '314076') {
        const label = readFileSync(join(OPENFDA_FIXTURES, 'summary-label-314076.json'), 'utf8');
        if (digestWeek < 2) return res.end(label);
        // A new version of the same label, effective this week.
        const body = JSON.parse(label);
        body.results[0].version = '3';
        body.results[0].effective_time = daysAgo(2).replace(/-/g, '');
        return res.end(JSON.stringify(body));
      }
    } else if (rxcui && OPENFDA_LABELS.includes(rxcui)) {
      return res.end(readFileSync(join(OPENFDA_FIXTURES, `label-${rxcui}.json`)));
    }
    res.statusCode = 404;
    return res.end(readFileSync(join(OPENFDA_FIXTURES, 'label-none.json')));
  }

  const fixture = rxnav[url];
  res.end(fixture ? readFileSync(join(RXNORM_FIXTURES, `${fixture}.json`)) : '{}');
}).listen(PORT, () => console.log(`stub upstreams on http://localhost:${PORT}`));
