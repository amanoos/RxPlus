// Stand-in for RxNav and openFDA during e2e runs: serves the recorded fixtures
// used by the unit tests. Started by Playwright (see playwright.config.ts).
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';

const PORT = Number(process.env['STUB_UPSTREAM_PORT'] ?? 4399);
const SERVER = join(import.meta.dirname, '..', 'src', 'server');
const RXNORM_FIXTURES = join(SERVER, 'rxnorm', 'fixtures');
const OPENFDA_FIXTURES = join(SERVER, 'openfda', 'fixtures');

const rxnav: Record<string, string> = {
  '/REST/Prescribe/displaynames.json': 'displaynames-sample',
  '/REST/Prescribe/drugs.json?name=lisinopril': 'drugs-lisinopril',
  '/REST/Prescribe/drugs.json?name=spironolactone': 'drugs-spironolactone',
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

  if (url.startsWith('/openfda/drug/label.json')) {
    const search = new URL(url, 'http://stub').searchParams.get('search') ?? '';
    const rxcui = /openfda\.rxcui:(\d+)/.exec(search)?.[1];
    if (rxcui && OPENFDA_LABELS.includes(rxcui)) {
      return res.end(readFileSync(join(OPENFDA_FIXTURES, `label-${rxcui}.json`)));
    }
    res.statusCode = 404;
    return res.end(readFileSync(join(OPENFDA_FIXTURES, 'label-none.json')));
  }

  const fixture = rxnav[url];
  res.end(fixture ? readFileSync(join(RXNORM_FIXTURES, `${fixture}.json`)) : '{}');
}).listen(PORT, () => console.log(`stub RxNav + openFDA on http://localhost:${PORT}`));
