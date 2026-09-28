import { TestBed } from '@angular/core/testing';
import { MockStore, provideMockStore } from '@ngrx/store/testing';
import { providePrimeNG } from 'primeng/config';

import { summaryFixture } from './drug-info.fixture';
import { DrugInfoActions } from './store/drug-info.actions';
import type { SummaryState } from './store/drug-info.reducer';
import { SummaryPanelComponent } from './summary-panel.component';

const rxcui = '314076';
const base: SummaryState = {
  status: 'ready',
  data: summaryFixture(),
  error: null,
  starting: false,
  timedOut: false,
  checking: false,
  upToDate: false,
};

describe('SummaryPanelComponent', () => {
  const render = async (state: Partial<SummaryState>) => {
    TestBed.configureTestingModule({
      providers: [providePrimeNG(), provideMockStore()],
    });
    const store = TestBed.inject(MockStore);
    vi.spyOn(store, 'dispatch');
    const fixture = TestBed.createComponent(SummaryPanelComponent);
    fixture.componentRef.setInput('rxcui', rxcui);
    fixture.componentRef.setInput('state', { ...base, ...state });
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    const q = (id: string) => el.querySelector(`[data-testid="${id}"]`);
    return { fixture, store, el, q };
  };

  afterEach(() => vi.useRealTimers());

  it('offers to summarize when there is no summary yet', async () => {
    const { store, q } = await render({ status: 'none', data: null });
    (q('start-summary')?.querySelector('button') as HTMLButtonElement).click();
    expect(store.dispatch).toHaveBeenCalledWith(
      DrugInfoActions.startSummary({ rxcui, refresh: false }),
    );
  });

  it('shows why a summary could not start', async () => {
    const { q } = await render({
      status: 'none',
      data: null,
      error: 'AI summary unavailable: No local model configured (OLLAMA_MODEL).',
    });
    expect(q('summary-start-error')?.textContent).toContain('OLLAMA_MODEL');
    expect(q('start-summary')).not.toBeNull();
  });

  it('shows elapsed time while pending, and a note when polling gave up', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-27T17:54:55.000Z'));
    const pending = summaryFixture({ status: 'pending', startedAt: '2026-09-27T17:52:42.000Z' });
    const { q } = await render({ status: 'pending', data: pending, timedOut: true });
    expect(q('summary-pending')?.textContent).toMatch(/Summarizing the FDA label…\s+2:13 elapsed/);
    expect(q('summary-timeout')?.textContent).toContain('taking longer than expected');
  });

  it('explains a failure and retries', async () => {
    const failed = summaryFixture({ status: 'failed', sections: null, error: 'Ollama timed out.' });
    const { store, q } = await render({ status: 'failed', data: failed });
    expect(q('summary-failed')?.textContent).toContain('Ollama timed out.');
    (q('retry-summary')?.querySelector('button') as HTMLButtonElement).click();
    expect(store.dispatch).toHaveBeenCalledWith(
      DrugInfoActions.startSummary({ rxcui, refresh: false }),
    );
  });

  it('renders sections with numbered source markers, uncited notes and honest gaps', async () => {
    const { el, q } = await render({});
    expect([...el.querySelectorAll('h3')].map((h) => h.textContent?.trim())).toEqual([
      "What it's for",
      'How well it works',
    ]);
    const markers = [...el.querySelectorAll('[data-testid="citation-marker"]')];
    expect(markers.map((m) => m.textContent?.trim())).toEqual(['[1]']);
    expect(markers[0].getAttribute('aria-label')).toBe('Source 1: Indications and usage');
    expect(q('uncited')?.textContent).toBe('It is gentle on the stomach.');
    expect(q('uncited')?.parentElement?.textContent).toContain('(not linked to the label)');
    expect(el.textContent).toContain('The label doesn’t say.');
    expect(q('low-citation')).not.toBeNull();
  });

  it('points to the full label when every sentence of a section was removed', async () => {
    const data = summaryFixture();
    data.sections!.push({ heading: 'Serious warnings', sentences: [] });
    const { q } = await render({ data });
    expect(q('empty-section')?.textContent).toContain('Nothing to show for this section.');
    expect(q('empty-section')?.querySelector('a')?.getAttribute('href')).toBe(
      data.label.dailyMedUrl,
    );
  });

  it('shows the quoted label text and section in a popover', async () => {
    const { fixture } = await render({});
    const marker = fixture.nativeElement.querySelector(
      '[data-testid="citation-marker"]',
    ) as HTMLButtonElement;
    marker.click();
    await fixture.whenStable();
    const popover = document.querySelector('[data-testid="citation-popover"]');
    expect(popover?.textContent).toContain('Indications and usage');
    expect(popover?.textContent).toContain('“treatment of hypertension”');
    expect(popover?.querySelector('a')?.getAttribute('href')).toBe(
      'https://dailymed.nlm.nih.gov/dailymed/lookup.cfm?setid=set-1',
    );
    expect(marker.getAttribute('aria-expanded')).toBe('true');
  });

  it('names the model and label date, notes removed advice, and checks for a newer label', async () => {
    const { store, q } = await render({
      data: summaryFixture({ removedAdvice: 2, lowCitation: false }),
      upToDate: true,
    });
    expect(q('summary-footer')?.textContent).toBe(
      'Summary written by AI (qwen2.5:7b, local) from the FDA label dated 2026-09-10. ' +
        'Check anything important with your pharmacist.',
    );
    expect(q('summary-panel')?.textContent).toContain(
      '2 sentences giving medication advice were removed.',
    );
    expect(q('low-citation')).toBeNull();
    expect(q('up-to-date')?.textContent).toContain('newest FDA label');
    (q('check-label')?.querySelector('button') as HTMLButtonElement).click();
    expect(store.dispatch).toHaveBeenCalledWith(
      DrugInfoActions.startSummary({ rxcui, refresh: true }),
    );
  });

  it('shows every quote inline on request and remembers it for the session', async () => {
    sessionStorage.clear();
    const { fixture, el, q } = await render({});
    expect(el.querySelector('[data-testid="inline-quote"]')).toBeNull();
    const toggle = q('toggle-quotes') as HTMLButtonElement;
    expect(toggle.textContent?.trim()).toBe('Show quotes');

    toggle.click();
    await fixture.whenStable();
    const quotes = [...el.querySelectorAll('[data-testid="inline-quote"]')];
    expect(quotes.map((b) => b.textContent?.replace(/\s+/g, ' ').trim())).toEqual([
      '[1] Indications and usage: “treatment of hypertension”',
    ]);
    // Markers stay; uncited sentences get no quote.
    expect(el.querySelectorAll('[data-testid="citation-marker"]')).toHaveLength(1);
    expect(toggle.getAttribute('aria-pressed')).toBe('true');
    expect(sessionStorage.getItem('rxplus.summary.showQuotes')).toBe('1');

    TestBed.resetTestingModule();
    const again = await render({});
    expect(again.el.querySelectorAll('[data-testid="inline-quote"]')).toHaveLength(1);
    sessionStorage.clear();
  });

  it('offers the quotes toggle only for a ready summary', async () => {
    const { q } = await render({ status: 'none', data: null });
    expect(q('toggle-quotes')).toBeNull();
  });

  it('names Claude as the provider when it wrote the summary', async () => {
    const { q } = await render({
      data: summaryFixture({ provider: 'claude', model: 'claude-opus-5' }),
    });
    expect(q('summary-footer')?.textContent).toContain('(claude-opus-5, Claude)');
  });
});
