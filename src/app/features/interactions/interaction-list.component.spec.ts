import { TestBed } from '@angular/core/testing';
import { MockStore, provideMockStore } from '@ngrx/store/testing';
import { providePrimeNG } from 'primeng/config';

import { evidenceQuery, pairKey, type InteractionResult } from './interaction';
import { resultFixture } from './interaction.fixture';
import { InteractionListComponent } from './interaction-list.component';
import { InteractionsActions } from './store/interactions.actions';
import { initialInteractionsState, type EvidenceEntry } from './store/interactions.reducer';

describe('InteractionListComponent', () => {
  const major = resultFixture();
  const unrated = resultFixture({
    level: 'Unknown',
    a: {
      ...resultFixture().a,
      rxcui: '617310',
      ingredient: 'atorvastatin',
      ingredientRxcui: '83367',
    },
  });

  const setup = async (
    results: InteractionResult[],
    evidence: Record<string, EvidenceEntry> = {},
  ) => {
    await TestBed.configureTestingModule({
      imports: [InteractionListComponent],
      providers: [
        providePrimeNG(),
        provideMockStore({
          initialState: { interactions: { ...initialInteractionsState, evidence } },
        }),
      ],
    }).compileComponents();
    const store = TestBed.inject(MockStore);
    vi.spyOn(store, 'dispatch');
    const fixture = TestBed.createComponent(InteractionListComponent);
    fixture.componentRef.setInput('results', results);
    await fixture.whenStable();
    return { fixture, store, el: fixture.nativeElement as HTMLElement };
  };

  it('shows each pair with a severity tag and explains unrated pairs', async () => {
    const { el } = await setup([major, unrated]);
    const items = [...el.querySelectorAll('[data-testid="interaction"]')];
    expect(items.map((i) => i.getAttribute('data-level'))).toEqual(['Major', 'Unknown']);
    expect(items[0].textContent).toContain('spironolactone + lisinopril');
    expect(items[0].textContent).toContain('Major');
    expect(items[1].textContent).toContain('Not rated');
    expect(items[1].textContent).toContain('severity not rated');
  });

  it('loads label evidence when a pair is expanded', async () => {
    const { el, store, fixture } = await setup([major]);
    el.querySelector<HTMLButtonElement>('[data-testid="toggle-evidence"]')?.click();
    await fixture.whenStable();
    expect(store.dispatch).toHaveBeenCalledWith(
      InteractionsActions.loadEvidence({ key: pairKey(major), query: evidenceQuery(major) }),
    );
    expect(el.textContent).toContain('Loading label text');
  });

  it('quotes label sentences with their source link', async () => {
    const { el, fixture } = await setup([major], {
      [pairKey(major)]: {
        status: 'loaded',
        error: null,
        items: [
          {
            label: 'lisinopril 10 MG Oral Tablet',
            manufacturer: 'Maker',
            effectiveDate: '2026-09-10',
            url: 'https://dailymed.nlm.nih.gov/dailymed/lookup.cfm?setid=x',
            sentences: ['Potassium-sparing diuretics (spironolactone) can increase potassium.'],
          },
          { label: 'spironolactone 25 MG Oral Tablet', missing: true, sentences: [] },
        ],
      },
    });
    el.querySelector<HTMLButtonElement>('[data-testid="toggle-evidence"]')?.click();
    await fixture.whenStable();
    const evidence = el.querySelector('[data-testid="evidence"]');
    expect(evidence?.querySelector('blockquote')?.textContent).toContain('spironolactone');
    expect(evidence?.querySelector('a')?.getAttribute('href')).toContain('dailymed');
    expect(evidence?.querySelector('a')?.getAttribute('rel')).toBe('noopener noreferrer');
    expect(evidence?.textContent).toContain('FDA label: Maker, Sep 10, 2026');
    expect(el.querySelector('[data-testid="toggle-evidence"]')?.getAttribute('aria-expanded')).toBe(
      'true',
    );
    expect(evidence?.textContent).toContain('No FDA label with an interactions section');
  });
});
