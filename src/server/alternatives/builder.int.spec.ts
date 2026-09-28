// @vitest-environment node
import { sql } from 'drizzle-orm';

import { createDb } from '../db/client';
import { runMigrations } from '../db/migrate';
import type { RxConcept } from '../rxnorm/client';
import { createAlternativesBuilder, settleAlternativeJobs } from './builder';
import { createAlternativesRepository } from './repository';

// Requires: npm run db:test:up
const url =
  process.env['TEST_DATABASE_URL'] ?? 'postgres://rxplus:rxplus@localhost:5433/rxplus_test';

const IN = (rxcui: string, name: string): RxConcept => ({ rxcui, name, tty: 'IN' });
const PIN = (rxcui: string, name: string): RxConcept => ({ rxcui, name, tty: 'PIN' });

const ACE = { id: 'N0000175562', name: 'Angiotensin Converting Enzyme Inhibitor' };
const CLASSES: Record<string, { id: string; name: string }> = {
  '29046': ACE,
  '3827': ACE,
  '52175': { id: 'N0000175561', name: 'Angiotensin 2 Receptor Blocker' },
  '5470': { id: 'N0000175359', name: 'Arteriolar Vasodilator' },
  '2679059': { id: 'N0000191266', name: 'Endothelin Receptor Antagonist' },
};
/** Ingredients with a US product (bopindolol and enalaprilat have none). */
const US = new Set(['29046', '3827', '1998', '52175', '75207', '5470', '2679059']);

function stubs() {
  const rxnav = {
    classMembers: vi.fn(async () => [
      IN('29046', 'lisinopril'),
      IN('3827', 'enalapril'),
      PIN('1545989', 'enalaprilat anhydrous'),
      IN('1998', 'captopril'),
    ]),
    diseaseMembers: vi.fn(async (id: string) =>
      id === 'D006973'
        ? [
            IN('29046', 'lisinopril'),
            IN('3827', 'enalapril'),
            PIN('203160', 'losartan potassium'),
            IN('75207', 'bosentan'),
            IN('5470', 'hydralazine'),
            IN('2679059', 'aprocitentan'),
            IN('31555', 'bopindolol'),
          ]
        : [IN('75207', 'bosentan'), PIN('5471', 'hydralazine hydrochloride')],
    ),
    diseaseDescendants: vi.fn(async () => [{ id: 'D006976', name: 'Hypertension, Pulmonary' }]),
    toIngredient: vi.fn(
      async (rxcui: string) =>
        ({
          '1545989': IN('3829', 'enalaprilat'),
          '203160': IN('52175', 'losartan'),
          '5471': IN('5470', 'hydralazine'),
        })[rxcui] ?? null,
    ),
    usProduct: vi.fn(async (rxcui: string) =>
      US.has(rxcui) ? { rxcui: `p${rxcui}`, name: `product ${rxcui}` } : null,
    ),
    epcClasses: vi.fn(async (rxcui: string) => (CLASSES[rxcui] ? [CLASSES[rxcui]] : [])),
  };
  const openFda = {
    approvalFacts: vi.fn(async (name: string) => {
      if (name === 'captopril') throw new Error('openFDA timed out');
      return name === 'aprocitentan'
        ? { firstApproved: '2024-03-19', genericAvailable: false }
        : { firstApproved: '1990-01-01', genericAvailable: true };
    }),
    indications: vi.fn(async (name: string) =>
      name === 'bosentan'
        ? ['Bosentan is indicated for the treatment of pulmonary arterial hypertension (PAH).']
        : ['Essential hypertension, alone or as an adjunct.'],
    ),
  };
  return { rxnav, openFda };
}

describe('alternatives builder (integration)', () => {
  const { db, pool } = createDb(url);
  const repo = createAlternativesRepository(db);

  beforeAll(() => runMigrations(url, 'drizzle'));
  beforeEach(() => db.execute(sql`truncate alternative_lists, alternative_drugs`));
  afterAll(() => pool.end());

  const create = () => {
    const { rxnav, openFda } = stubs();
    const builder = createAlternativesBuilder({
      repo,
      rxnav,
      openFda,
      sleep: async () => undefined,
    });
    return { builder, rxnav, openFda };
  };

  it('builds a class list: US drugs only, with facts, failures counted', async () => {
    const { builder } = create();
    const key = await builder.ensure('class', ACE.id, ACE.name);
    expect(key).toBe('class:N0000175562');
    await settleAlternativeJobs();

    expect(await repo.list(key)).toMatchObject({ status: 'ready', skipped: 1 });
    const drugs = await repo.drugs(key);
    // enalaprilat (metabolite, no product) left out; captopril skipped (lookup failed).
    expect(drugs.map((d) => d.name)).toEqual(['enalapril', 'lisinopril']);
    expect(drugs[0]).toEqual({
      ingredientRxcui: '3827',
      name: 'enalapril',
      classId: ACE.id,
      className: ACE.name,
      firstApproved: '1990-01-01',
      genericAvailable: true,
      productRxcui: 'p3827',
    });
  });

  it('builds a condition list, dropping drugs only for a more specific form', async () => {
    const { builder, openFda } = create();
    const key = await builder.ensure('condition', 'D006973', 'Hypertension');
    await settleAlternativeJobs();

    const drugs = await repo.drugs(key);
    expect(drugs.map((d) => d.name)).toEqual([
      'aprocitentan',
      'enalapril',
      'hydralazine',
      'lisinopril',
      'losartan',
    ]);
    expect(drugs.find((d) => d.name === 'losartan')).toMatchObject({
      className: 'Angiotensin 2 Receptor Blocker',
    });
    expect(drugs.find((d) => d.name === 'aprocitentan')).toMatchObject({
      firstApproved: '2024-03-19',
      genericAvailable: false,
    });
    // Labels are read only for the drugs also listed for the specific form.
    expect(openFda.indications.mock.calls.map(([name]) => name).sort()).toEqual([
      'bosentan',
      'hydralazine',
    ]);
  });

  it('reuses a built list, and rebuilds when forced', async () => {
    const { builder, rxnav } = create();
    await builder.ensure('condition', 'D006973', 'Hypertension');
    await settleAlternativeJobs();
    const calls = rxnav.diseaseMembers.mock.calls.length;

    await builder.ensure('condition', 'D006973', 'Hypertension');
    await settleAlternativeJobs();
    expect(rxnav.diseaseMembers.mock.calls.length).toBe(calls);

    await builder.ensure('condition', 'D006973', 'Hypertension', { force: true });
    await settleAlternativeJobs();
    expect(rxnav.diseaseMembers.mock.calls.length).toBeGreaterThan(calls);
  });

  it('spaces openFDA lookups to stay under its rate limit', async () => {
    const { rxnav, openFda } = stubs();
    let clock = 0;
    const waits: number[] = [];
    const builder = createAlternativesBuilder({
      repo,
      rxnav,
      openFda,
      now: () => clock,
      sleep: async (ms) => {
        waits.push(ms);
        clock += ms;
      },
    });
    await builder.ensure('class', ACE.id, ACE.name);
    await settleAlternativeJobs();
    // Three approval lookups (enalapril, lisinopril, captopril): starts 500 ms apart.
    expect(openFda.approvalFacts).toHaveBeenCalledTimes(3);
    expect(waits.every((ms) => ms > 0 && ms <= 1000)).toBe(true);
    expect(clock).toBeGreaterThanOrEqual(1000);
  });

  it('fails the list when the members can’t be read', async () => {
    const { builder, rxnav } = create();
    rxnav.diseaseMembers.mockRejectedValue(new Error('RxNav unreachable: timed out'));
    const key = await builder.ensure('condition', 'D006973', 'Hypertension');
    await settleAlternativeJobs();
    expect(await repo.list(key)).toMatchObject({
      status: 'failed',
      error: 'RxNav unreachable: timed out',
    });
  });
});
