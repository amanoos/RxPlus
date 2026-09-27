// Stand-in for RxNav during e2e runs: serves the recorded fixtures used by the
// unit tests. Started by Playwright (see playwright.config.ts).
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';

const PORT = Number(process.env['STUB_RXNAV_PORT'] ?? 4399);
const FIXTURES = join(import.meta.dirname, '..', 'src', 'server', 'rxnorm', 'fixtures');

const routes: Record<string, string> = {
  '/REST/Prescribe/displaynames.json': 'displaynames-sample',
  '/REST/Prescribe/drugs.json?name=lisinopril': 'drugs-lisinopril',
};
for (const id of ['314076', '104377', '197885', '29046']) {
  routes[`/REST/rxcui/${id}/properties.json`] = `properties-${id}`;
  routes[`/REST/rxcui/${id}/related.json?tty=IN+BN+DF`] = `related-${id}`;
  routes[`/REST/rxcui/${id}/allProperties.json?prop=attributes`] = `attributes-${id}`;
}

createServer((req, res) => {
  const fixture = routes[req.url ?? ''];
  res.setHeader('content-type', 'application/json');
  if (req.url === '/health') return res.end('{"ok":true}');
  res.end(fixture ? readFileSync(join(FIXTURES, `${fixture}.json`)) : '{}');
}).listen(PORT, () => console.log(`stub RxNav on http://localhost:${PORT}/REST`));
