import { TestBed } from '@angular/core/testing';
import { providePrimeNG } from 'primeng/config';

import type { Paper } from './literature';
import { paperFixture } from './literature.fixture';
import { PaperListComponent } from './paper-list.component';

describe('PaperListComponent', () => {
  const render = async (papers: Paper[], writing = false) => {
    TestBed.configureTestingModule({ providers: [providePrimeNG()] });
    const fixture = TestBed.createComponent(PaperListComponent);
    fixture.componentRef.setInput('papers', papers);
    fixture.componentRef.setInput('writing', writing);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    return { el, q: (id: string) => el.querySelector(`[data-testid="${id}"]`) };
  };

  it('shows the study type, source, links and the takeaway with its quote below it', async () => {
    const { el, q } = await render([paperFixture()]);
    expect(el.textContent).toContain('Meta-analysis');
    expect(el.textContent).toContain('J Clin Hypertens (Greenwich) · 2023');
    const title = q('paper-title') as HTMLAnchorElement;
    expect(title.href).toBe('https://pubmed.ncbi.nlm.nih.gov/37417783/');
    expect(title.rel).toBe('noopener noreferrer');
    expect((q('full-text') as HTMLAnchorElement).href).toBe(
      'https://pmc.ncbi.nlm.nih.gov/articles/PMC10423763/',
    );
    expect(q('takeaway')?.textContent).toContain(
      'In this review, cough was more common with ACE inhibitors than with placebo.',
    );
    expect(q('takeaway-quote')?.textContent?.replace(/\s+/g, ' ').trim()).toBe(
      'In the study: “ACEIs were associated with a higher risk of cough than placebo.”',
    );
    expect(q('not-supported')).toBeNull();
  });

  it('marks unlinked takeaways, flags unsupported ones, and hides empty ones', async () => {
    const { el } = await render([
      paperFixture({
        pmid: '1',
        takeaway: { text: 'Unlinked claim.', quote: null, uncited: true },
      }),
      paperFixture({
        pmid: '2',
        fullTextUrl: null,
        takeaway: {
          text: 'Overstated.',
          quote: 'Partial quote here.',
          uncited: false,
          supported: false,
          readerDirected: true,
        },
        studySubject: 'animal',
      }),
      paperFixture({ pmid: '3', takeaway: { text: '', quote: null, uncited: true } }),
    ]);
    const [one, two, three] = [...el.querySelectorAll('[data-testid="paper"]')];
    expect(one.querySelector('[data-testid="reader-directed"]')).toBeNull();
    // Who was studied is shown for animal work, not for a review already tagged as one.
    expect(one.querySelector('[data-testid="study-subject"]')).toBeNull();
    expect(two.querySelector('[data-testid="study-subject"]')?.textContent?.trim()).toBe(
      'Animal study',
    );
    expect(two.querySelector('[data-testid="reader-directed"]')?.textContent).toContain(
      'Worded as if about you',
    );
    expect(one.textContent).toContain('(not linked to the abstract)');
    expect(one.querySelector('[data-testid="takeaway-quote"]')).toBeNull();
    expect(two.querySelector('[data-testid="not-supported"]')?.textContent).toContain(
      'doesn’t back up all of this',
    );
    expect(two.querySelector('[data-testid="full-text"]')).toBeNull();
    expect(three.querySelector('[data-testid="takeaway"]')).toBeNull();
  });

  it('says a takeaway is being written while the job runs', async () => {
    const { el } = await render([paperFixture({ takeaway: null })], true);
    expect(el.textContent).toContain('Writing a takeaway…');
  });
});

describe('PaperListComponent actions', () => {
  it('offers Hide or Show again and reports the paper', async () => {
    TestBed.configureTestingModule({ providers: [providePrimeNG()] });
    const fixture = TestBed.createComponent(PaperListComponent);
    fixture.componentRef.setInput('papers', [paperFixture()]);
    const acted: string[] = [];
    fixture.componentInstance.act.subscribe((pmid) => acted.push(pmid));
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('[data-testid="paper-action"]')).toBeNull();

    fixture.componentRef.setInput('action', 'hide');
    await fixture.whenStable();
    const button = el.querySelector('[data-testid="paper-action"]') as HTMLButtonElement;
    expect(button.textContent?.trim()).toBe('Hide');
    expect(button.getAttribute('aria-label')).toMatch(/^Hide: ACE inhibitor induced cough/);
    button.click();
    expect(acted).toEqual(['37417783']);

    fixture.componentRef.setInput('action', 'unhide');
    await fixture.whenStable();
    expect(el.querySelector('[data-testid="paper-action"]')?.textContent?.trim()).toBe(
      'Show again',
    );
  });
});
