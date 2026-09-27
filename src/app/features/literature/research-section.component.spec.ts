import { PLATFORM_ID } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MockStore, provideMockStore } from '@ngrx/store/testing';
import { providePrimeNG } from 'primeng/config';

import { ingredientFixture, literatureFixture } from './literature.fixture';
import type { LiteratureResponse } from './literature';
import { ResearchSectionComponent } from './research-section.component';
import { LiteratureActions } from './store/literature.actions';
import {
  initialLiteratureState,
  literatureFeature,
  type LiteratureState,
} from './store/literature.reducer';

const rxcui = '314076';

function stateWith(
  data: LiteratureResponse | null,
  extra: (s: LiteratureState) => LiteratureState = (s) => s,
): LiteratureState {
  let s = literatureFeature.reducer(
    initialLiteratureState,
    LiteratureActions.openResearch({ rxcui }),
  );
  if (data) s = literatureFeature.reducer(s, LiteratureActions.loadSuccess({ rxcui, data }));
  return extra(s);
}

describe('ResearchSectionComponent', () => {
  const render = async (literature: LiteratureState, platform = 'browser') => {
    TestBed.configureTestingModule({
      providers: [
        providePrimeNG(),
        provideMockStore({ initialState: { literature } }),
        { provide: PLATFORM_ID, useValue: platform },
      ],
    });
    const store = TestBed.inject(MockStore);
    vi.spyOn(store, 'dispatch');
    const fixture = TestBed.createComponent(ResearchSectionComponent);
    fixture.componentRef.setInput('rxcui', rxcui);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    return { fixture, store, el, q: (id: string) => el.querySelector(`[data-testid="${id}"]`) };
  };

  afterEach(() => vi.useRealTimers());

  it('opens Research in the browser and leaves it on destroy, but not during SSR', async () => {
    const { store, fixture } = await render(stateWith(null));
    expect(store.dispatch).toHaveBeenCalledWith(LiteratureActions.openResearch({ rxcui }));
    fixture.destroy();
    expect(store.dispatch).toHaveBeenLastCalledWith(LiteratureActions.leaveResearch({ rxcui }));

    TestBed.resetTestingModule();
    const server = await render(stateWith(null), 'server');
    expect(server.store.dispatch).not.toHaveBeenCalled();
  });

  it('shows loading, then papers; a heading per ingredient only for combinations', async () => {
    let { el } = await render(stateWith(null));
    expect(el.textContent).toContain('Finding research…');

    TestBed.resetTestingModule();
    ({ el } = await render(stateWith(literatureFixture())));
    expect(el.querySelectorAll('[data-testid="paper"]')).toHaveLength(2);
    expect(el.querySelector('h3')).toBeNull();

    TestBed.resetTestingModule();
    ({ el } = await render(
      stateWith(
        literatureFixture(
          ingredientFixture({ rxcui: '5487', name: 'hydrochlorothiazide' }),
          ingredientFixture(),
        ),
      ),
    ));
    expect([...el.querySelectorAll('h3')].map((h) => h.textContent?.trim())).toEqual([
      'hydrochlorothiazide',
      'lisinopril',
    ]);
  });

  it('shows the elapsed time while takeaways are written', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-27T20:03:05.000Z'));
    const { q } = await render(
      stateWith(literatureFixture(ingredientFixture({}, { status: 'pending' }))),
    );
    expect(q('takeaways-pending')?.textContent).toMatch(
      /Writing plain-language takeaways…\s+2:05 elapsed/,
    );
  });

  it('explains a failure and retries; shows why takeaways could not start', async () => {
    const { store, q } = await render(
      stateWith(
        literatureFixture(ingredientFixture({}, { status: 'failed', error: 'Ollama timed out.' })),
        (s) =>
          literatureFeature.reducer(
            s,
            LiteratureActions.startTakeawaysFailure({
              rxcui,
              error: 'AI takeaways unavailable: No local model configured (OLLAMA_MODEL).',
            }),
          ),
      ),
    );
    expect(q('takeaways-failed')?.textContent).toContain('Ollama timed out.');
    expect(q('takeaways-start-error')?.textContent).toContain('OLLAMA_MODEL');
    (q('retry-takeaways')?.querySelector('button') as HTMLButtonElement).click();
    expect(store.dispatch).toHaveBeenCalledWith(LiteratureActions.startTakeaways({ rxcui }));
  });

  it('shows an outage message when nothing is stored', async () => {
    const { q } = await render(
      stateWith(null, (s) =>
        literatureFeature.reducer(
          s,
          LiteratureActions.loadFailure({ rxcui, error: 'PubMed is unavailable right now.' }),
        ),
      ),
    );
    expect(q('research-error')?.textContent).toContain('PubMed is unavailable right now.');
  });
});
