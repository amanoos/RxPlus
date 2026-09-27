import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { MockStore, provideMockStore } from '@ngrx/store/testing';

import { reportFixture, resultFixture } from '../../features/interactions/interaction.fixture';
import {
  initialInteractionsState,
  type InteractionsState,
} from '../../features/interactions/store/interactions.reducer';
import { medicationFixture } from '../../features/medications/medication.fixture';
import { MedicationsActions } from '../../features/medications/store/medications.actions';
import { medicationsFeature } from '../../features/medications/store/medications.reducer';
import DashboardPage from './index.page';

const meds = (n: number) =>
  medicationsFeature.reducer(
    undefined,
    MedicationsActions.loadSuccess({
      medications: Array.from({ length: n }, (_, i) =>
        medicationFixture({ id: `m${i}`, rxcui: String(i) }),
      ),
    }),
  );

describe('DashboardPage', () => {
  const setup = async (medications = meds(0), interactions: Partial<InteractionsState> = {}) => {
    await TestBed.configureTestingModule({
      imports: [DashboardPage],
      providers: [
        provideRouter([]),
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
    const fixture = TestBed.createComponent(DashboardPage);
    await fixture.whenStable();
    return { store, el: fixture.nativeElement as HTMLElement };
  };

  it('loads medications and invites adding the first one', async () => {
    const { store, el } = await setup();
    expect(store.dispatch).toHaveBeenCalledWith(MedicationsActions.load());
    expect(el.querySelector('[data-testid="medications-summary"] a')?.textContent).toContain(
      'Add your first medication',
    );
    expect(el.querySelector('[data-testid="interactions-summary"]')).toBeNull();
  });

  it('counts Major interactions and links to /interactions', async () => {
    const { el } = await setup(meds(2), {
      currentStatus: 'loaded',
      current: reportFixture({ results: [resultFixture(), resultFixture({ level: 'Minor' })] }),
    });
    expect(el.textContent).toContain('You’re taking 2 medications');
    const summary = el.querySelector('[data-testid="interactions-summary"] a');
    expect(summary?.textContent).toContain('1 Major interaction between your current medications');
    expect(summary?.getAttribute('href')).toBe('/interactions');
  });

  it('says when no interactions were found', async () => {
    const { el } = await setup(meds(2), {
      currentStatus: 'loaded',
      current: reportFixture({ results: [] }),
    });
    expect(el.textContent).toContain('No interactions found between your current medications');
  });
});
