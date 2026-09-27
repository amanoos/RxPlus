// Stand-in for RxNav, openFDA, MedlinePlus Connect and Ollama during e2e runs:
// serves the recorded fixtures used by the unit tests. Started by Playwright
// (see playwright.config.ts).
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';

const PORT = Number(process.env['STUB_UPSTREAM_PORT'] ?? 4399);
const SERVER = join(import.meta.dirname, '..', 'src', 'server');
const RXNORM_FIXTURES = join(SERVER, 'rxnorm', 'fixtures');
const OPENFDA_FIXTURES = join(SERVER, 'openfda', 'fixtures');
const MEDLINEPLUS_FIXTURES = join(SERVER, 'medlineplus', 'fixtures');
/** A real qwen2.5:7b answer for the lisinopril label (quotes match summary-label-314076). */
const OLLAMA_SUMMARY = join(import.meta.dirname, 'fixtures', 'ollama-lisinopril-summary.json');

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

createServer((req, res) => {
  const url = req.url ?? '';
  res.setHeader('content-type', 'application/json');
  if (url === '/health') return res.end('{"ok":true}');

  if (url === '/ollama/api/chat' && req.method === 'POST') {
    const reply = {
      model: 'qwen2.5:7b',
      message: { role: 'assistant', content: readFileSync(OLLAMA_SUMMARY, 'utf8') },
      done: true,
      prompt_eval_count: 5200,
      eval_count: 950,
    };
    req.resume();
    // A short delay so the page shows its pending state, as with the real model.
    return void setTimeout(() => res.end(JSON.stringify(reply)), 1500);
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

  if (url.startsWith('/openfda/drug/label.json')) {
    const search = new URL(url, 'http://stub').searchParams.get('search') ?? '';
    const rxcui = /openfda\.rxcui:(\d+)/.exec(search)?.[1];
    // The summary asks for the newest label that has the sections it summarizes.
    if (search.includes('_exists_:indications_and_usage')) {
      if (rxcui === '314076') {
        return res.end(readFileSync(join(OPENFDA_FIXTURES, 'summary-label-314076.json')));
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
