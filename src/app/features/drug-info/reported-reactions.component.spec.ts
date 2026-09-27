import { TestBed } from '@angular/core/testing';
import { providePrimeNG } from 'primeng/config';

import { reactionsFixture } from './drug-info.fixture';
import { ReportedReactionsComponent } from './reported-reactions.component';

describe('ReportedReactionsComponent', () => {
  const render = async (inputs: Record<string, unknown>) => {
    TestBed.configureTestingModule({ providers: [providePrimeNG()] });
    const fixture = TestBed.createComponent(ReportedReactionsComponent);
    for (const [k, v] of Object.entries(inputs)) fixture.componentRef.setInput(k, v);
    await fixture.whenStable();
    return fixture.nativeElement as HTMLElement;
  };

  it('lists reactions as bars relative to the top one, with totals', async () => {
    const el = await render({ reactions: reactionsFixture(), status: 'loaded' });
    expect(el.querySelector('[data-testid="faers-ingredient"] h3')?.textContent).toMatch(
      /lisinopril:\s+304,318 reports/,
    );
    const rows = [...el.querySelectorAll('li')];
    const text = (r: Element) =>
      ['term', 'count']
        .map((id) => r.querySelector(`[data-testid="${id}"]`)?.textContent?.trim())
        .join(' ');
    expect(rows.map(text)).toEqual(['Cough 17,000', 'Dizziness 12,000']);
    const bars = rows.map((r) => (r.querySelector('[aria-hidden]') as HTMLElement).style.width);
    expect(bars).toEqual(['100%', '71%']);
  });

  it('always shows the disclaimer, even while loading or on error', async () => {
    let el = await render({ status: 'loading' });
    expect(el.querySelector('[data-testid="faers-disclaimer"]')?.textContent).toContain(
      'A report doesn’t prove the drug caused the reaction',
    );
    expect(el.textContent).toContain('Loading reports…');

    TestBed.resetTestingModule();
    el = await render({ status: 'error', error: 'FDA adverse event reports are unavailable.' });
    expect(el.querySelector('[data-testid="faers-disclaimer"]')).not.toBeNull();
    expect(el.textContent).toContain('FDA adverse event reports are unavailable.');
  });
});
