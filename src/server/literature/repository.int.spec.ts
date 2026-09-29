// @vitest-environment node
import { sql } from 'drizzle-orm';

import { createDb } from '../db/client';
import { runMigrations } from '../db/migrate';
import { seedTestUsers, type TestUsers } from '../tests/test-users';
import {
  createLiteratureRepository,
  selectShown,
  type FetchedPaper,
  type FetchedTrial,
} from './repository';

// Requires: npm run db:test:up
const url =
  process.env['TEST_DATABASE_URL'] ?? 'postgres://rxplus:rxplus@localhost:5433/rxplus_test';

const ING = '29046';

const paper = (pmid: string, tier: 'review' | 'rct', rank: number): FetchedPaper => ({
  pmid,
  tier,
  rank,
  title: `Paper ${pmid}`,
  journal: 'Lancet',
  year: 2020,
  pubTypes: [tier === 'review' ? 'Meta-Analysis' : 'Randomized Controlled Trial'],
  studyType: tier === 'review' ? 'meta-analysis' : 'rct',
  doi: null,
  pmcid: null,
  abstract: `Abstract of ${pmid}.`,
});

const trial = (nctId: string, rank: number): FetchedTrial => ({
  nctId,
  rank,
  title: `Trial ${nctId}`,
  status: 'RECRUITING',
  phases: ['PHASE4'],
  hasResults: false,
  startDate: '2026-01',
  lastUpdate: '2026-09-01',
});

const reviews = (n: number) => Array.from({ length: n }, (_, i) => paper(`r${i}`, 'review', i));
const rcts = (n: number) => Array.from({ length: n }, (_, i) => paper(`t${i}`, 'rct', i));

describe('selectShown', () => {
  it('takes at most 4 reviews, then trials, 10 in all', () => {
    expect(selectShown([...rcts(12), ...reviews(6)]).map((p) => p.pmid)).toEqual([
      'r0',
      'r1',
      'r2',
      'r3',
      't0',
      't1',
      't2',
      't3',
      't4',
      't5',
    ]);
  });

  it('fills with trials when there are few reviews', () => {
    expect(selectShown([...reviews(1), ...rcts(3)]).map((p) => p.pmid)).toEqual([
      'r0',
      't0',
      't1',
      't2',
    ]);
  });
});

describe('literature repository (integration)', () => {
  const { db, pool } = createDb(url);
  const repo = createLiteratureRepository(db);
  const save = (papers: FetchedPaper[], trials: FetchedTrial[] = []) =>
    repo.saveFetched({ ingredientRxcui: ING, ingredientName: 'lisinopril', papers, trials });
  let users: TestUsers;
  let alice: string;

  beforeAll(() => runMigrations(url, 'drizzle'));
  beforeEach(async () => {
    await db.execute(sql`truncate table literature_lists, literature_papers, literature_trials`);
    users = await seedTestUsers(db);
    alice = users.alice.id;
  });
  afterAll(() => pool.end());

  it('stores a fetched list and shows reviews first, then trials', async () => {
    await save([...reviews(6), ...rcts(12)], [trial('NCT2', 1), trial('NCT1', 0)]);
    expect(await repo.list(ING)).toMatchObject({
      ingredientName: 'lisinopril',
      takeawayStatus: 'none',
    });
    const shown = await repo.shownPapers(ING, alice);
    expect(shown.map((p) => p.pmid)).toEqual([
      'r0',
      'r1',
      'r2',
      'r3',
      't0',
      't1',
      't2',
      't3',
      't4',
      't5',
    ]);
    expect(shown[0]).toMatchObject({ abstract: 'Abstract of r0.', takeaway: null });
    expect((await repo.trials(ING)).map((t) => t.nctId)).toEqual(['NCT1', 'NCT2']);
    expect(await repo.list('1')).toBeNull();
  });

  it('keeps takeaways and hidden state on refresh, and drops papers no longer found', async () => {
    await save([...reviews(2), ...rcts(3)], [trial('NCT1', 0)]);
    await repo.completeTakeaways(
      ING,
      new Map([
        ['t0', { text: 'It lowered blood pressure.', quote: 'reduced BP', uncited: false }],
      ]),
      { inputTokens: 10, outputTokens: 5 },
    );
    await repo.setHidden(alice, ING, 'r1', true);

    // The new search no longer finds t2 and ranks t0 lower.
    await save([...reviews(2), paper('t1', 'rct', 0), paper('t0', 'rct', 1)], [trial('NCT9', 0)]);

    const shown = await repo.shownPapers(ING, alice);
    expect(shown.map((p) => p.pmid)).toEqual(['r0', 't1', 't0']);
    expect(shown[2].takeaway).toEqual({
      text: 'It lowered blood pressure.',
      quote: 'reduced BP',
      uncited: false,
    });
    expect((await repo.hiddenPapers(ING, alice)).map((p) => p.pmid)).toEqual(['r1']);
    expect((await repo.trials(ING)).map((t) => t.nctId)).toEqual(['NCT9']);

    // Trials unavailable this time: the stored ones stay.
    await repo.saveFetched({ ingredientRxcui: ING, ingredientName: 'lisinopril', papers: rcts(1) });
    expect((await repo.trials(ING)).map((t) => t.nctId)).toEqual(['NCT9']);
  });

  it('promotes the next candidate when a paper is hidden, and restores it when unhidden', async () => {
    await save([...reviews(5), ...rcts(8)]);
    expect((await repo.shownPapers(ING, alice)).map((p) => p.pmid)).toContain('r3');

    expect(await repo.setHidden(alice, ING, 'r1', true)).toBe(true);
    let shown = (await repo.shownPapers(ING, alice)).map((p) => p.pmid);
    expect(shown.slice(0, 4)).toEqual(['r0', 'r2', 'r3', 'r4']);
    expect(shown).not.toContain('r1');

    await repo.setHidden(alice, ING, 'r1', false);
    shown = (await repo.shownPapers(ING, alice)).map((p) => p.pmid);
    expect(shown.slice(0, 4)).toEqual(['r0', 'r1', 'r2', 'r3']);
    expect(await repo.hiddenPapers(ING, alice)).toEqual([]);
    expect(await repo.setHidden(alice, ING, 'unknown', true)).toBe(false);
  });

  it('hides a paper for one user only, and drops their hides with the account', async () => {
    await save([...reviews(5), ...rcts(8)]);
    const bob = users.bob.id;
    await repo.setHidden(alice, ING, 'r1', true);
    await repo.setHidden(alice, ING, 'r1', true); // twice is harmless
    expect((await repo.shownPapers(ING, alice)).map((p) => p.pmid)).not.toContain('r1');
    expect((await repo.shownPapers(ING, bob)).map((p) => p.pmid)).toContain('r1');
    expect(await repo.hiddenPapers(ING, bob)).toEqual([]);
    // Unhiding what isn't hidden is harmless too.
    expect(await repo.setHidden(bob, ING, 'r1', false)).toBe(true);
    expect((await repo.hiddenPapers(ING, alice)).map((p) => p.pmid)).toEqual(['r1']);

    await db.execute(sql`delete from users where id = ${alice}`);
    const [{ n }] = (await db.execute(sql`select count(*)::int n from literature_hidden`)).rows as {
      n: number;
    }[];
    expect(n).toBe(0);
  });

  it('runs one takeaway job at a time and records its outcome', async () => {
    await save(rcts(3));
    expect(await repo.claimTakeaways(ING, 'ollama', 'qwen2.5:7b')).toMatchObject({
      takeawayStatus: 'pending',
      provider: 'ollama',
    });
    expect(await repo.claimTakeaways(ING, 'ollama', 'qwen2.5:7b')).toBeNull();
    expect((await repo.withoutTakeaway(ING, ['t0', 't1'])).map((p) => p.pmid).sort()).toEqual([
      't0',
      't1',
    ]);

    await repo.completeTakeaways(
      ING,
      new Map([['t0', { text: 'x', quote: null, uncited: true }]]),
      { inputTokens: 100, outputTokens: 20 },
    );
    expect(await repo.list(ING)).toMatchObject({
      takeawayStatus: 'ready',
      inputTokens: 100,
      error: null,
    });
    expect((await repo.withoutTakeaway(ING, ['t0', 't1'])).map((p) => p.pmid)).toEqual(['t1']);

    await repo.claimTakeaways(ING, 'claude', 'claude-opus-5');
    await repo.failTakeaways(ING, 'Claude declined.');
    expect(await repo.list(ING)).toMatchObject({
      takeawayStatus: 'failed',
      error: 'Claude declined.',
    });

    await repo.claimTakeaways(ING, 'ollama', 'qwen2.5:7b');
    expect(await repo.failInterrupted()).toBe(1);
    expect(await repo.list(ING)).toMatchObject({
      takeawayStatus: 'failed',
      error: 'Interrupted by a server restart.',
    });
  });
});
