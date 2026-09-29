// @vitest-environment node
import { sql } from 'drizzle-orm';

import { createAlternativesRepository, listKey } from '../alternatives/repository';
import type { CtGovClient, TrialUpdate } from '../ctgov/client';
import { createDb } from '../db/client';
import { runMigrations } from '../db/migrate';
import type { TakeawayProvider } from '../literature/takeaways';
import { createMedicationsRepository } from '../medications/repository';
import { seedTestUsers, type TestUsers } from '../tests/test-users';
import type { OpenFdaClient, SummaryLabel } from '../openfda/client';
import type { PubMedClient } from '../pubmed/client';
import { createDigestRepository, type UserDigests } from './repository';
import { createDigestRunner, settleDigestJobs, type RunnerDeps } from './run';

// Requires: npm run db:test:up
const url =
  process.env['TEST_DATABASE_URL'] ?? 'postgres://rxplus:rxplus@localhost:5433/rxplus_test';

// Monday 2026-09-28, 6:00 AM in New York.
const NOW = Date.parse('2026-09-28T10:00:00Z');

const drug = (rxcui: string, name: string, firstApproved: string) => ({
  ingredientRxcui: rxcui,
  name,
  classId: null,
  className: null,
  firstApproved,
  genericAvailable: false,
  productRxcui: `p${rxcui}`,
});

const trial = (nctId: string, overrides: Partial<TrialUpdate>): TrialUpdate => ({
  nctId,
  title: `Trial ${nctId}`,
  status: 'RECRUITING',
  phases: ['PHASE4'],
  hasResults: false,
  startDate: null,
  lastUpdate: '2026-09-25',
  firstPosted: '2020-01-01',
  resultsFirstPosted: null,
  ...overrides,
});

const label = (version: string): SummaryLabel => ({
  rxcui: '314076',
  setId: 'set-a',
  version,
  manufacturer: null,
  effectiveDate: '2026-09-20',
  dailyMedUrl: 'https://dailymed.nlm.nih.gov/dailymed/lookup.cfm?setid=set-a',
  sections: [],
});

describe('digest run (integration)', () => {
  const { db, pool } = createDb(url);
  const shared = createDigestRepository(db);
  const alternatives = createAlternativesRepository(db);
  const medications = createMedicationsRepository(db);
  let users: TestUsers;
  // Alice's digests: she takes lisinopril (and stopped metformin).
  let repo: UserDigests;

  beforeAll(() => runMigrations(url, 'drizzle'));
  beforeEach(async () => {
    await db.execute(
      sql`truncate digests, digest_items, digest_label_versions, alternative_lists, alternative_drugs, medications`,
    );
    users = await seedTestUsers(db);
    repo = shared.forUser(users.alice.id);
    const alicesList = medications.forUser(users.alice.id);
    const lisinopril = await alicesList.create({
      rxcui: '314076',
      tty: 'SCD',
      name: 'lisinopril 10 MG Oral Tablet',
      strength: '10 MG',
      doseForm: 'Oral Tablet',
      brandName: null,
      ingredients: [{ rxcui: '29046', name: 'lisinopril' }],
      notes: null,
      startedOn: null,
    });
    await alicesList.update(lisinopril.id, {
      takenForId: 'D006973',
      takenForName: 'Hypertension',
    });
    const stopped = await alicesList.create({
      rxcui: '861007',
      tty: 'SCD',
      name: 'metformin 500 MG Oral Tablet',
      strength: '500 MG',
      doseForm: 'Oral Tablet',
      brandName: null,
      ingredients: [{ rxcui: '6809', name: 'metformin' }],
      notes: null,
      startedOn: null,
    });
    await alicesList.update(stopped.id, { stoppedOn: '2026-01-01' });
  });
  // The e2e server shares this database: leave no running digest for its startup to resume.
  afterAll(async () => {
    await settleDigestJobs();
    await db.execute(sql`truncate digests, digest_items, digest_label_versions`);
    await pool.end();
  });

  /** Each upstream answers the same until changed; the condition list grows by `listed`. */
  function create(now = NOW) {
    const world = {
      pmids: ['101', '102'],
      total: 2,
      trials: [trial('NCT1', { firstPosted: '2026-09-22' })],
      label: label('12'),
      listed: [drug('29046', 'lisinopril', '1987-12-29')],
      /** When set, PubMed answers only once it resolves. */
      gate: null as Promise<void> | null,
    };
    const provider: TakeawayProvider = {
      name: 'ollama',
      model: 'test',
      generate: vi.fn<TakeawayProvider['generate']>(async (papers) => ({
        raw: {
          takeaways: papers.map((p) => ({
            pmid: p.pmid,
            quote: 'Lisinopril lowered blood pressure more than placebo in adults.',
            text: 'In this trial, lisinopril lowered blood pressure more than placebo.',
          })),
        },
      })),
    };
    const pubmed = {
      recentPapers: vi.fn<PubMedClient['recentPapers']>(async () => {
        await world.gate;
        return {
          pmids: world.pmids,
          total: world.total,
          searchUrl: 'https://pubmed.ncbi.nlm.nih.gov/?term=lisinopril',
        };
      }),
      paperDetails: vi.fn<PubMedClient['paperDetails']>(async (ids) =>
        ids.map((pmid) => ({
          pmid,
          title: `Paper ${pmid}`,
          journal: 'Hypertension',
          year: 2026,
          pubTypes: [],
          studyType: 'other' as const,
          doi: null,
          pmcid: null,
        })),
      ),
      abstracts: vi.fn<PubMedClient['abstracts']>(
        async (ids) =>
          new Map(
            ids.map((id) => [
              id,
              'Methods. Lisinopril lowered blood pressure more than placebo in adults.',
            ]),
          ),
      ),
    };
    const ctgov = { recentUpdates: vi.fn<CtGovClient['recentUpdates']>(async () => world.trials) };
    const openFda = { summaryLabel: vi.fn<OpenFdaClient['summaryLabel']>(async () => world.label) };
    const builder = {
      rebuild: vi.fn(async (kind: 'class' | 'condition', id: string, name: string) => {
        const key = listKey(kind, id);
        await alternatives.claim(key, kind, name, { force: true });
        await alternatives.complete(key, world.listed, 0);
        return key;
      }),
    };
    const deps: RunnerDeps = {
      repo: shared,
      medications,
      pubmed,
      ctgov,
      openFda,
      alternatives,
      builder,
      takeaways: () => ({ provider }),
      dailyLimit: 20,
      claudeStartsToday: async () => 0,
      timeZone: 'America/New_York',
      now: () => now,
    };
    return { runner: createDigestRunner(deps), deps, world, pubmed, ctgov, builder, provider };
  }

  /** One manual run for a user (Alice unless named), settled. */
  const run = async (
    runner: ReturnType<typeof create>['runner'],
    as: keyof TestUsers = 'alice',
  ) => {
    const digest = await runner.start('manual', users[as].id);
    await settleDigestJobs();
    return (await shared.forUser(users[as].id).recent()).find((d) => d.id === digest?.id)!;
  };
  /** Puts a product on Bob's list. */
  const giveBob = (rxcui: string, name: string, ingredient: [string, string]) =>
    medications.forUser(users.bob.id).create({
      rxcui,
      tty: 'SCD',
      name,
      strength: null,
      doseForm: 'Oral Tablet',
      brandName: null,
      ingredients: [{ rxcui: ingredient[0], name: ingredient[1] }],
      notes: null,
      startedOn: null,
    });

  it('collects the week for active medications, with baselines on the first run', async () => {
    const { runner, pubmed, ctgov, builder } = create();
    const digest = await run(runner);

    expect(digest).toMatchObject({
      status: 'ready',
      trigger: 'manual',
      windowStart: '2026-09-21',
      windowEnd: '2026-09-28',
      notes: null,
    });
    expect(digest.items.map((i) => [i.kind, i.subject, i.externalId])).toEqual([
      ['paper', 'lisinopril', '101'],
      ['paper', 'lisinopril', '102'],
      ['trial', 'lisinopril', 'NCT1:new'],
    ]);
    expect(digest.items[0].takeaway).toMatchObject({ uncited: false });
    // Stopped medications are skipped.
    expect(pubmed.recentPapers).toHaveBeenCalledTimes(1);
    expect(ctgov.recentUpdates).toHaveBeenCalledWith('lisinopril', '2026-09-21');
    expect(builder.rebuild).toHaveBeenCalledWith('condition', 'D006973', 'Hypertension');
    expect((await repo.labelVersions(['314076'])).get('314076')?.version).toBe('12');
  });

  it('reports only what is new on the next run, including approvals and label changes', async () => {
    const first = create();
    await run(first.runner);

    const next = create(NOW + 7 * 24 * 60 * 60 * 1000);
    next.world.pmids = ['101', '103'];
    next.world.total = 5;
    next.world.trials = [
      trial('NCT1', { firstPosted: '2026-09-22' }),
      trial('NCT2', { resultsFirstPosted: '2026-10-01' }),
    ];
    next.world.label = label('13');
    next.world.listed = [
      drug('29046', 'lisinopril', '1987-12-29'),
      drug('2679059', 'aprocitentan', '2024-03-19'),
    ];
    const digest = await run(next.runner);

    expect(digest).toMatchObject({ windowStart: '2026-09-28', windowEnd: '2026-10-05' });
    expect(digest.items.map((i) => [i.kind, i.externalId])).toEqual([
      ['paper', '103'],
      ['more-papers', null],
      ['trial', 'NCT2:results'],
      ['approval', 'D006973:2679059'],
      ['label', 'set-a:13'],
    ]);
    expect(digest.items[1]).toMatchObject({ title: '3 more new papers on PubMed' });
  });

  it('runs one digest at a time per user', async () => {
    const { runner, world } = create();
    let release = () => undefined as void;
    world.gate = new Promise<void>((resolve) => (release = resolve));
    const first = await runner.start('manual', users.alice.id);
    expect(first).not.toBeNull();
    expect(await runner.start('schedule', users.alice.id)).toBeNull();
    // Bob's run is his own: Alice's doesn't block it.
    expect(await runner.start('manual', users.bob.id)).not.toBeNull();
    release();
    await settleDigestJobs();
    expect(await runner.start('schedule', users.alice.id)).not.toBeNull();
    await settleDigestJobs();
  });

  it('keeps a failed takeaway call as a note on a finished digest', async () => {
    const { runner, provider } = create();
    vi.mocked(provider.generate).mockRejectedValue(new Error('boom'));
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const digest = await run(runner);
    expect(digest.status).toBe('ready');
    expect(digest.notes).toEqual([
      "Takeaways for lisinopril couldn't be written: the model call failed.",
    ]);
    expect(digest.items.filter((i) => i.kind === 'paper').every((i) => !i.takeaway)).toBe(true);
  });

  it('stops before the daily Claude limit and counts the calls it makes', async () => {
    const withClaude = ({ deps, provider }: ReturnType<typeof create>) =>
      createDigestRunner({
        ...deps,
        takeaways: () => ({ provider: { ...provider, name: 'claude' } }),
        dailyLimit: 1,
        claudeStartsToday: () => shared.claudeCallsToday('America/New_York'),
      });

    const allowed = await run(withClaude(create()));
    expect(allowed.claudeCalls).toBe(1);
    expect(allowed.notes).toBeNull();

    const later = create();
    later.world.pmids = ['201'];
    const blocked = await run(withClaude(later));
    expect(blocked.claudeCalls).toBe(0);
    expect(blocked.notes).toEqual([
      "Takeaways for lisinopril couldn't be written: The daily limit of 1 Claude requests has been reached.",
    ]);
  });

  it('fails the run, writing nothing, when collecting breaks', async () => {
    const { runner } = create();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(medications, 'forUser').mockReturnValueOnce({
      list: () => Promise.reject(new Error('database gone')),
    } as never);
    const digest = await run(runner);
    expect(digest).toMatchObject({ status: 'failed', error: 'database gone', items: [] });
  });

  it('at startup, fails an interrupted run and runs again', async () => {
    const { runner } = create();
    await repo.start({ trigger: 'schedule', windowStart: '2026-09-21', windowEnd: '2026-09-28' });
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const caughtUp = await runner.startup();
    expect(caughtUp).toEqual([users.alice.id]);
    await settleDigestJobs();
    const [latest, interrupted] = await repo.recent();
    expect(latest).toMatchObject({ status: 'ready', trigger: 'catch-up' });
    expect(interrupted).toMatchObject({ status: 'failed' });
  });

  it('at startup, catches up only when the last successful run is over a week old', async () => {
    await run(create().runner);
    const now = Date.now();
    await db.execute(sql`update digests set started_at = now() - interval '6 days'`);
    expect(await create(now).runner.startup()).toEqual([]);

    await db.execute(sql`update digests set started_at = now() - interval '8 days'`);
    expect(await create(now).runner.startup()).toEqual([users.alice.id]);
    await settleDigestJobs();
  });

  it('at startup, waits for the schedule before the very first run', async () => {
    expect(await create(Date.now()).runner.startup()).toEqual([]);
  });

  describe('two users', () => {
    const subjects = (digest: { items: { subject: string }[] }) =>
      new Set(digest.items.map((i) => i.subject));

    it("builds each user's digest from their own medications only", async () => {
      await giveBob('861007', 'metformin 500 MG Oral Tablet', ['6809', 'metformin']);
      const alice = await run(create().runner);
      const bob = await run(create().runner, 'bob');
      expect([...subjects(alice)].some((s) => s.includes('metformin'))).toBe(false);
      expect([...subjects(bob)].every((s) => s.includes('metformin'))).toBe(true);
      expect(bob.items.length).toBeGreaterThan(0);
    });

    it("reports a paper Alice has seen to Bob too, reusing Alice's takeaway", async () => {
      await giveBob('314076', 'lisinopril 10 MG Oral Tablet', ['29046', 'lisinopril']);
      const { runner, provider } = create();
      const alice = await run(runner);
      expect(provider.generate).toHaveBeenCalledTimes(1);

      const bob = await run(runner, 'bob');
      const papers = bob.items.filter((i) => i.kind === 'paper');
      expect(papers.map((i) => i.externalId)).toEqual(['101', '102']);
      expect(papers[0].takeaway).toEqual(alice.items.find((i) => i.externalId === '101')?.takeaway);
      // No second model call, and none counted against the Claude cap.
      expect(provider.generate).toHaveBeenCalledTimes(1);
      expect(bob.claudeCalls).toBe(0);
    });

    it('runs the week for users with active medications, one after another', async () => {
      const { runner } = create();
      expect(await runner.runAll('schedule')).toEqual([users.alice.id]);
      await settleDigestJobs();
      expect(await shared.forUser(users.bob.id).recent()).toEqual([]);

      await giveBob('861007', 'metformin 500 MG Oral Tablet', ['6809', 'metformin']);
      const queued = await runner.runAll('schedule');
      expect(new Set(queued)).toEqual(new Set([users.alice.id, users.bob.id]));
      await settleDigestJobs();
      const firsts = await Promise.all(
        queued.map(async (id) => (await shared.forUser(id).recent())[0]),
      );
      expect(firsts.every((d) => d.status === 'ready' && d.trigger === 'schedule')).toBe(true);
      // Sequential: the first user's run finished before the second's started.
      expect(firsts[0].finishedAt!.getTime()).toBeLessThanOrEqual(firsts[1].startedAt.getTime());
    });

    it('at startup, catches up and reruns each user on their own schedule', async () => {
      await giveBob('861007', 'metformin 500 MG Oral Tablet', ['6809', 'metformin']);
      await run(create().runner);
      await run(create().runner, 'bob');
      // Alice's last digest is over a week old; Bob's is recent.
      await db.execute(
        sql`update digests set started_at = now() - interval '8 days' where user_id = ${users.alice.id}`,
      );
      await db.execute(
        sql`update digests set started_at = now() - interval '2 days' where user_id = ${users.bob.id}`,
      );
      expect(await create(Date.now()).runner.startup()).toEqual([users.alice.id]);
      await settleDigestJobs();

      // A restart cut off Bob's run: only Bob runs again.
      await shared
        .forUser(users.bob.id)
        .start({ trigger: 'manual', windowStart: '2026-09-21', windowEnd: '2026-09-28' });
      vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      expect(await create(Date.now()).runner.startup()).toEqual([users.bob.id]);
      await settleDigestJobs();
      const [latest] = await shared.forUser(users.bob.id).recent();
      expect(latest).toMatchObject({ status: 'ready', trigger: 'catch-up' });
    });

    it("keeps going when one user's run fails", async () => {
      await giveBob('861007', 'metformin 500 MG Oral Tablet', ['6809', 'metformin']);
      const { runner } = create();
      vi.spyOn(console, 'error').mockImplementation(() => undefined);
      vi.spyOn(medications, 'forUser').mockReturnValueOnce({
        list: () => Promise.reject(new Error('database gone')),
      } as never);
      const queued = await runner.runAll('schedule');
      await settleDigestJobs();
      const statuses = await Promise.all(
        queued.map(async (id) => (await shared.forUser(id).recent())[0].status),
      );
      expect(statuses).toEqual(['failed', 'ready']);
    });
  });
});
