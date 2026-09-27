import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideMockActions } from '@ngrx/effects/testing';
import { MockStore, provideMockStore } from '@ngrx/store/testing';
import { providePrimeNG } from 'primeng/config';
import { EMPTY } from 'rxjs';

import { medicationFixture } from '../../features/medications/medication.fixture';
import { MedicationsActions } from '../../features/medications/store/medications.actions';
import {
  initialMedicationsState,
  medicationsFeature,
} from '../../features/medications/store/medications.reducer';
import MedicationsPage from './medications.page';

describe('MedicationsPage', () => {
  const setup = async (medications = initialMedicationsState) => {
    await TestBed.configureTestingModule({
      imports: [MedicationsPage],
      providers: [
        providePrimeNG(),
        provideMockStore({ initialState: { medications } }),
        provideMockActions(() => EMPTY),
        provideHttpClient(),
        provideHttpClientTesting(),
      ],
    }).compileComponents();
    const store = TestBed.inject(MockStore);
    vi.spyOn(store, 'dispatch');
    const fixture = TestBed.createComponent(MedicationsPage);
    await fixture.whenStable();
    return { store, fixture, el: fixture.nativeElement as HTMLElement };
  };
  const loadedWith = (...meds: ReturnType<typeof medicationFixture>[]) =>
    medicationsFeature.reducer(undefined, MedicationsActions.loadSuccess({ medications: meds }));

  it('loads medications on init', async () => {
    const { store } = await setup();
    expect(store.dispatch).toHaveBeenCalledWith(MedicationsActions.load());
  });

  it('lists active medications and puts stopped ones in a collapsed section', async () => {
    const { el } = await setup(
      loadedWith(
        medicationFixture({ id: 'a', name: 'lisinopril 10 MG Oral Tablet' }),
        medicationFixture({
          id: 'b',
          rxcui: '2',
          name: 'atorvastatin 20 MG Oral Tablet',
          stoppedOn: '2026-05-01',
        }),
      ),
    );
    const active = el.querySelector('[data-testid="active-list"]');
    expect(active?.textContent).toContain('lisinopril 10 MG Oral Tablet');
    expect(active?.textContent).not.toContain('atorvastatin');

    const stopped = el.querySelector('details[data-testid="stopped"]');
    expect(stopped?.hasAttribute('open')).toBe(false);
    expect(stopped?.querySelector('summary')?.textContent).toContain('Stopped (1)');
    expect(stopped?.textContent).toContain('atorvastatin 20 MG Oral Tablet');
  });

  it('shows an empty state once loaded with nothing', async () => {
    const { el } = await setup(loadedWith());
    expect(el.textContent).toContain('No medications yet');
    expect(el.querySelector('[data-testid="stopped"]')).toBeNull();
  });

  it('shows the load error', async () => {
    const { el } = await setup({ ...initialMedicationsState, error: 'Something went wrong.' });
    expect(el.textContent).toContain('Something went wrong.');
  });
});
