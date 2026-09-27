import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { MockStore, provideMockStore } from '@ngrx/store/testing';
import { providePrimeNG } from 'primeng/config';

import { reportFixture } from '../../features/interactions/interaction.fixture';
import { InteractionsActions } from '../../features/interactions/store/interactions.actions';
import {
  initialInteractionsState,
  type InteractionsState,
} from '../../features/interactions/store/interactions.reducer';
import { medicationFixture } from '../../features/medications/medication.fixture';
import { MedicationsActions } from '../../features/medications/store/medications.actions';
import { medicationsFeature } from '../../features/medications/store/medications.reducer';
import InteractionsPage from './interactions.page';

const twoMeds = medicationsFeature.reducer(
  undefined,
  MedicationsActions.loadSuccess({
    medications: [medicationFixture({ id: 'm1' }), medicationFixture({ id: 'm2', rxcui: '2' })],
  }),
);

describe('InteractionsPage', () => {
  const setup = async (interactions: Partial<InteractionsState>, medications = twoMeds) => {
    await TestBed.configureTestingModule({
      imports: [InteractionsPage],
      providers: [
        providePrimeNG(),
        provideHttpClient(),
        provideHttpClientTesting(),
        provideMockStore({
          initialState: {
            medications,
            interactions: { ...initialInteractionsState, ...interactions },
          },
        }),
      ],
    }).compileComponents();
    const store = TestBed.inject(MockStore);
    vi.spyOn(store, 'dispatch');
    const fixture = TestBed.createComponent(InteractionsPage);
    await fixture.whenStable();
    return { store, fixture, el: fixture.nativeElement as HTMLElement };
  };

  it('loads medications (which refreshes interactions) and clears any old candidate', async () => {
    const { store } = await setup({});
    expect(store.dispatch).toHaveBeenCalledWith(MedicationsActions.load());
    expect(store.dispatch).toHaveBeenCalledWith(InteractionsActions.clearCandidate());
  });

  it('explains how to import data when none exists', async () => {
    const { el } = await setup({ noData: true });
    expect(el.querySelector('[data-testid="no-data"]')?.textContent).toContain(
      'npm run ddi:import',
    );
    expect(el.textContent).not.toContain('Check a new prescription');
  });

  it('checks the picked product and clears the check when the pick is cleared', async () => {
    const { fixture, store } = await setup({});
    fixture.componentInstance.check('313096');
    expect(store.dispatch).toHaveBeenCalledWith(
      InteractionsActions.checkCandidate({ rxcui: '313096' }),
    );
    fixture.componentInstance.check(null);
    expect(store.dispatch).toHaveBeenLastCalledWith(InteractionsActions.clearCandidate());
  });

  it('shows candidate results, and warns about ingredients outside the dataset', async () => {
    const { el } = await setup({
      candidateStatus: 'loaded',
      candidate: reportFixture({
        notCovered: [
          { rxcui: '1', name: 'x', ingredient: 'lipase' },
          { rxcui: '1', name: 'x', ingredient: 'amylase' },
        ],
      }),
    });
    const candidate = el.querySelector('[data-testid="candidate-results"]');
    expect(candidate?.querySelectorAll('[data-testid="interaction"]')).toHaveLength(1);
    expect(candidate?.querySelector('[data-testid="not-covered"]')?.textContent).toContain(
      'lipase and amylase aren’t in the interaction dataset',
    );
  });

  it('never claims "no interactions" when an ingredient is not covered', async () => {
    const { el } = await setup({
      candidateStatus: 'loaded',
      candidate: reportFixture({
        results: [],
        notCovered: [{ rxcui: '1', name: 'x', ingredient: 'lipase' }],
      }),
    });
    expect(el.textContent).not.toContain('No interactions found');
    expect(el.textContent).toContain('lipase isn’t in the interaction dataset');
  });

  it('reports no interactions among current medications, with the source and import date', async () => {
    const { el } = await setup({
      currentStatus: 'loaded',
      current: reportFixture({ results: [] }),
    });
    expect(el.querySelector('[data-testid="current-results"]')?.textContent).toContain(
      'No interactions found in DDInter between your current medications.',
    );
    expect(el.querySelector('footer')?.textContent).toContain('DDInter 2.0');
    expect(el.querySelector('footer')?.textContent).toContain(
      '(CC BY-NC-SA 4.0), imported Sep 27, 2026.',
    );
    expect(el.querySelector('footer')?.textContent).toContain('Not medical advice');
  });

  it('asks for at least two medications before comparing them', async () => {
    const oneMed = medicationsFeature.reducer(
      undefined,
      MedicationsActions.loadSuccess({ medications: [medicationFixture()] }),
    );
    const { el } = await setup({ currentStatus: 'loaded', current: reportFixture() }, oneMed);
    expect(el.querySelector('[data-testid="current-results"]')?.textContent).toContain(
      'Add at least two medications',
    );
  });
});
