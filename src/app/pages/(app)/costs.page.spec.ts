import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
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
import type { CostsResponse } from '../../features/pricing/pricing';
import { costRowFixture, costsFixture } from '../../features/pricing/pricing.fixture';
import { PricingActions } from '../../features/pricing/store/pricing.actions';
import { initialPricingState, type Loadable } from '../../features/pricing/store/pricing.reducer';
import CostsPage from './costs.page';

describe('CostsPage', () => {
  const med = medicationFixture();
  const medications = medicationsFeature.reducer(
    initialMedicationsState,
    MedicationsActions.loadSuccess({ medications: [med] }),
  );
  const setup = async (costs: Loadable<CostsResponse> | null) => {
    await TestBed.configureTestingModule({
      imports: [CostsPage],
      providers: [
        providePrimeNG(),
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        provideMockActions(() => EMPTY),
        provideMockStore({
          initialState: { pricing: { ...initialPricingState, costs }, medications },
        }),
      ],
    }).compileComponents();
    const store = TestBed.inject(MockStore);
    vi.spyOn(store, 'dispatch');
    const fixture = TestBed.createComponent(CostsPage);
    await fixture.whenStable();
    return { store, fixture, el: fixture.nativeElement as HTMLElement };
  };
  const loaded = (data: CostsResponse): Loadable<CostsResponse> => ({
    status: 'loaded',
    data,
    error: null,
  });
  const text = (el: Element | null | undefined) => el?.textContent?.replace(/\s+/g, ' ').trim();

  it('loads costs and medications', async () => {
    const { store, el } = await setup(null);
    expect(store.dispatch).toHaveBeenCalledWith(PricingActions.loadCosts());
    expect(store.dispatch).toHaveBeenCalledWith(MedicationsActions.load());
    expect(el.textContent).toContain('Loading…');
  });

  it('lists each medication with cash, copay and the cheaper option, and totals', async () => {
    const data = costsFixture({
      rows: [
        costRowFixture({ medicationId: med.id }),
        costRowFixture({
          medicationId: 'm2',
          rxcui: '1364445',
          name: 'apixaban 5 MG Oral Tablet',
          status: 'not-sold',
          price: null,
          cashCents: null,
          insuredCents: 4700,
          cheaper: null,
          savingsCents: null,
        }),
      ],
      totals: {
        cashCents: 39,
        insuredCents: 5033,
        medications: 2,
        missingPrice: 1,
        missingCopay: 0,
      },
    });
    const { el } = await setup(loaded(data));
    const rows = [...el.querySelectorAll('[data-testid="cost-row"]')].map((r) =>
      [...r.querySelectorAll('th, td')].map((c) => text(c)),
    );
    expect(rows).toEqual([
      ['lisinopril 10 MG Oral Tablet', '30', '$0.39', '$3.33', 'Cash, by $2.94', 'Edit'],
      ['apixaban 5 MG Oral Tablet', '30', 'Not sold', '$47.00', '—', 'Edit'],
    ]);
    const totals = el.querySelector('[data-testid="totals"]');
    expect([...(totals?.querySelectorAll('th, td') ?? [])].map((c) => text(c))).toEqual([
      'Total a month',
      '',
      '$0.39',
      '$50.33',
      '',
    ]);
    expect(text(el.querySelector('[data-testid="missing"]'))).toBe(
      'Totals leave out 1 of 2 without a Cost Plus price.',
    );
    expect(el.querySelector('[data-testid="costs-cards"]')?.textContent).toContain(
      'Total a month: $0.39 cash · $50.33 with insurance',
    );
  });

  it('opens the editor for a row', async () => {
    const { el, fixture } = await setup(
      loaded(costsFixture({ rows: [costRowFixture({ medicationId: med.id })] })),
    );
    el.querySelector<HTMLButtonElement>('[data-testid="cost-row"] button')?.click();
    await fixture.whenStable();
    expect(document.body.textContent).toContain('units per month');
  });

  it('explains no medications, unavailable rows and errors', async () => {
    const empty = await setup(loaded(costsFixture({ rows: [] })));
    expect(empty.el.querySelector('[data-testid="no-medications"]')).not.toBeNull();

    TestBed.resetTestingModule();
    const down = await setup({ status: 'error', data: null, error: 'Something went wrong.' });
    expect(text(down.el.querySelector('[data-testid="costs-error"]'))).toBe(
      'Something went wrong.',
    );

    const cmp = down.fixture.componentInstance;
    expect(cmp.missingPrice(costRowFixture({ status: 'unavailable' }))).toBe(
      'Unavailable right now',
    );
    expect(cmp.cheaper(costRowFixture({ cheaper: 'insurance', savingsCents: 100 }))).toBe(
      'Copay, by $1.00',
    );
    expect(cmp.cheaper(costRowFixture({ cheaper: 'same', savingsCents: 0 }))).toBe('Same');
  });
});
