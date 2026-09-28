import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { providePrimeNG } from 'primeng/config';

import type { Digest } from './digest';
import { DigestViewComponent, formatDay } from './digest-view.component';
import { digestFixture, digestItemFixture } from './digest.fixture';

describe('DigestViewComponent', () => {
  const setup = async (digest: Digest, inputs: { canRetry?: boolean; busy?: boolean } = {}) => {
    await TestBed.configureTestingModule({
      imports: [DigestViewComponent],
      providers: [providePrimeNG(), provideRouter([])],
    }).compileComponents();
    const fixture = TestBed.createComponent(DigestViewComponent);
    fixture.componentRef.setInput('digest', digest);
    fixture.componentRef.setInput('canRetry', inputs.canRetry ?? false);
    fixture.componentRef.setInput('busy', inputs.busy ?? false);
    await fixture.whenStable();
    return { fixture, el: fixture.nativeElement as HTMLElement };
  };
  const text = (el: Element | null | undefined) => el?.textContent?.replace(/\s+/g, ' ').trim();

  it('groups items by drug and shows each kind with its link', async () => {
    const items = [
      digestItemFixture(),
      digestItemFixture({
        id: 'i2',
        kind: 'more-papers',
        title: '9 more new papers on PubMed',
        url: 'https://pubmed.ncbi.nlm.nih.gov/?term=x',
        details: { count: 9 },
        takeaway: null,
      }),
      digestItemFixture({
        id: 'i3',
        kind: 'trial',
        title: 'Lisinopril for kidney protection',
        url: 'https://clinicaltrials.gov/study/NCT1',
        details: { nctId: 'NCT1', event: 'results', status: 'COMPLETED', phases: ['PHASE4'] },
        takeaway: null,
      }),
      digestItemFixture({
        id: 'i4',
        kind: 'label',
        title: 'New FDA label for lisinopril 10 MG Oral Tablet',
        url: '/drugs/314076',
        productRxcui: '314076',
        details: {
          labelDate: '2026-09-15',
          dailyMedUrl: 'https://dailymed.nlm.nih.gov/dailymed/lookup.cfm?setid=a',
        },
        takeaway: null,
        read: true,
      }),
    ];
    const approval = digestItemFixture({
      id: 'i5',
      kind: 'approval',
      title: 'aprocitentan',
      url: '/drugs/p2679059',
      details: { condition: 'Hypertension', firstApproved: '2024-03-19' },
      takeaway: null,
    });
    const { el } = await setup(
      digestFixture({
        groups: [
          { subject: 'lisinopril', items },
          { subject: 'Hypertension', items: [approval] },
        ],
      }),
    );

    const groups = [...el.querySelectorAll('[data-testid="digest-group"]')];
    expect(groups.map((g) => text(g.querySelector('h3')))).toEqual(['lisinopril', 'Hypertension']);
    const [paper, more, trial, label] = [
      ...groups[0].querySelectorAll('[data-testid="digest-item"]'),
    ];

    expect(paper.querySelector('a')?.getAttribute('href')).toBe(
      'https://pubmed.ncbi.nlm.nih.gov/101/',
    );
    expect(text(paper)).toContain('Hypertension · 2026');
    expect(text(paper.querySelector('[data-testid="takeaway-quote"]'))).toBe(
      'In the study: “Lisinopril slowed the decline in kidney function compared with placebo.”',
    );
    expect(text(more)).toBe('New: and 9 more on PubMed');
    expect(text(trial)).toContain('Results posted NCT1');
    expect(trial.querySelector('a')?.getAttribute('href')).toBe(
      'https://clinicaltrials.gov/study/NCT1',
    );
    expect(text(label)).toContain(
      'New FDA label for lisinopril 10 MG Oral Tablet, dated Sep 15, 2026',
    );
    expect(label.getAttribute('data-unread')).toBeNull();
    expect(paper.getAttribute('data-unread')).toBe('true');
    expect(label.querySelector('a')?.getAttribute('href')).toBe('/drugs/314076');

    const listed = groups[1].querySelector('[data-testid="digest-item"]');
    expect(text(listed)).toBe('New: Newly listed for Hypertension: aprocitentan (approved 2024)');
    expect(listed?.querySelector('a')?.getAttribute('href')).toBe('/drugs/p2679059');
  });

  it('labels who was studied, highlighting animal and lab work', async () => {
    const items = [
      digestItemFixture({ id: 'a', details: { journal: 'J', year: 2026, studySubject: 'animal' } }),
      digestItemFixture({ id: 'b', details: { journal: 'J', year: 2026, studySubject: 'human' } }),
      digestItemFixture({ id: 'c', details: { journal: 'J', year: 2026 } }),
    ];
    const { el } = await setup(digestFixture({ groups: [{ subject: 'metformin', items }] }));
    const labels = [...el.querySelectorAll('[data-testid="digest-item"]')].map((i) =>
      text(i.querySelector('[data-testid="study-subject"]')),
    );
    expect(labels).toEqual(['Animal study', 'Study in people', undefined]);
  });

  it('marks a takeaway that could not be linked to its abstract', async () => {
    const item = digestItemFixture({
      takeaway: { text: 'Lisinopril helped.', quote: null, uncited: true },
    });
    const { el } = await setup(
      digestFixture({ groups: [{ subject: 'lisinopril', items: [item] }] }),
    );
    expect(text(el.querySelector('[data-testid="takeaway"]'))).toBe(
      'Lisinopril helped. (not linked to the abstract)',
    );
  });

  it('notes a takeaway worded as if about the reader', async () => {
    const item = digestItemFixture({
      takeaway: {
        text: 'Taking it can help your kidneys.',
        quote: 'Lisinopril slowed the decline in kidney function compared with placebo.',
        uncited: false,
        readerDirected: true,
      },
    });
    const { el } = await setup(
      digestFixture({ groups: [{ subject: 'lisinopril', items: [item] }] }),
    );
    expect(text(el.querySelector('[data-testid="reader-directed"]'))).toBe(
      'Worded as if about you or as advice; the study itself is what’s quoted.',
    );
    expect(el.querySelector('[data-testid="takeaway-quote"]')).not.toBeNull();
  });

  it('shows an empty week, notes, and a failure with Try again', async () => {
    const empty = await setup(
      digestFixture({
        groups: [],
        itemCount: 0,
        notes: ["Trials for lisinopril couldn't be checked"],
      }),
    );
    expect(empty.el.querySelector('[data-testid="digest-empty"]')).not.toBeNull();
    expect(text(empty.el.querySelector('[data-testid="digest-notes"]'))).toBe(
      "Trials for lisinopril couldn't be checked",
    );

    TestBed.resetTestingModule();
    const failed = await setup(
      digestFixture({ status: 'failed', error: 'PubMed is down', groups: [] }),
      { canRetry: true },
    );
    const retried = vi.fn();
    failed.fixture.componentInstance.retry.subscribe(retried);
    expect(text(failed.el.querySelector('[data-testid="digest-failed"]'))).toContain(
      'This digest couldn’t be collected: PubMed is down',
    );
    failed.el.querySelector<HTMLButtonElement>('[data-testid="try-again"] button')?.click();
    expect(retried).toHaveBeenCalled();
    expect(failed.el.querySelector('[data-testid="digest-empty"]')).toBeNull();
  });

  it('formats dates without shifting the day', () => {
    expect(formatDay('2026-09-21')).toBe('Sep 21, 2026');
    expect(formatDay('2026-09-21', false)).toBe('Sep 21');
  });
});
