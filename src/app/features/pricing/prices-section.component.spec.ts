import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideMockActions } from '@ngrx/effects/testing';
import { MockStore, provideMockStore } from '@ngrx/store/testing';
import { providePrimeNG } from 'primeng/config';
import { EMPTY } from 'rxjs';

import { medicationFixture } from '../medications/medication.fixture';
import { MedicationsActions } from '../medications/store/medications.actions';
import {
  initialMedicationsState,
  medicationsFeature,
} from '../medications/store/medications.reducer';
import { PricesSectionComponent, unitsLabel } from './prices-section.component';
import type { PricesResponse } from './pricing';
import { medicationCostFixture, pricesFixture } from './pricing.fixture';
import { PricingActions } from './store/pricing.actions';
import { initialPricingState, type Loadable } from './store/pricing.reducer';

describe('PricesSectionComponent', () => {
  const setup = async (
    entry: Loadable<PricesResponse> | null,
    medications = initialMedicationsState,
  ) => {
    await TestBed.configureTestingModule({
      imports: [PricesSectionComponent],
      providers: [
        providePrimeNG(),
        provideHttpClient(),
        provideHttpClientTesting(),
        provideMockActions(() => EMPTY),
        provideMockStore({
          initialState: {
            pricing: { ...initialPricingState, prices: entry ? { '314076': entry } : {} },
            medications,
          },
        }),
      ],
    }).compileComponents();
    const store = TestBed.inject(MockStore);
    vi.spyOn(store, 'dispatch');
    const fixture = TestBed.createComponent(PricesSectionComponent);
    fixture.componentRef.setInput('rxcui', '314076');
    await fixture.whenStable();
    return { store, fixture, el: fixture.nativeElement as HTMLElement };
  };
  const loaded = (data: PricesResponse): Loadable<PricesResponse> => ({
    status: 'loaded',
    data,
    error: null,
  });
  const text = (el: Element | null | undefined) => el?.textContent?.replace(/\s+/g, ' ').trim();

  it('loads the prices, and says so while loading', async () => {
    const { store, el } = await setup(null);
    expect(store.dispatch).toHaveBeenCalledWith(PricingActions.loadPrices({ rxcui: '314076' }));
    expect(text(el.querySelector('[data-testid="prices"]'))).toContain('Loading prices…');
  });

  it('shows the Cost Plus price for 30 a month, the fee note and the link', async () => {
    const { el } = await setup(loaded(pricesFixture()));
    expect(text(el.querySelector('[data-testid="cash-price"]'))).toBe(
      'Cost Plus Drugs: $0.0131 per tablet → $0.39 for 30 tablets a month',
    );
    expect(text(el.querySelector('[data-testid="prices"]'))).toContain(
      'Plus Cost Plus’s per-order fees',
    );
    expect(el.querySelector('a[href*="costplusdrugs.com"]')?.getAttribute('target')).toBe('_blank');
    expect(el.querySelector('[data-testid="my-cost"]')).toBeNull();
  });

  it('compares with the owner’s copay and opens the editor', async () => {
    const med = medicationFixture({ copayCents: 1000, copayUnits: 90 });
    const medications = medicationsFeature.reducer(
      initialMedicationsState,
      MedicationsActions.loadSuccess({ medications: [med] }),
    );
    const { el, fixture } = await setup(
      loaded(pricesFixture({ medication: medicationCostFixture({ medicationId: med.id }) })),
      medications,
    );
    expect(text(el.querySelector('[data-testid="my-cost"]'))).toContain(
      'Your copay: $10.00 per 90 tablets → $3.33 a month',
    );
    expect(text(el.querySelector('[data-testid="comparison"]'))).toBe(
      'Cash at Cost Plus is cheaper by $2.94 a month.',
    );
    el.querySelector<HTMLButtonElement>('[data-testid="edit-cost"] button')?.click();
    await fixture.whenStable();
    expect(document.body.textContent).toContain('units per month');
  });

  it('loads the medications when it needs one for editing', async () => {
    const { store } = await setup(loaded(pricesFixture({ medication: medicationCostFixture() })));
    expect(store.dispatch).toHaveBeenCalledWith(MedicationsActions.load());
  });

  it('says when the copay is missing, or which option is cheaper', async () => {
    const { el } = await setup(
      loaded(
        pricesFixture({
          medication: medicationCostFixture({
            copayCents: null,
            copayUnits: null,
            insuredCents: null,
            cheaper: null,
            savingsCents: null,
          }),
        }),
      ),
    );
    expect(text(el.querySelector('[data-testid="my-cost"]'))).toContain('No copay entered.');
    expect(el.querySelector('[data-testid="comparison"]')).toBeNull();
    const cmp = TestBed.createComponent(PricesSectionComponent).componentInstance;
    expect(cmp.comparison(medicationCostFixture({ cheaper: 'insurance', savingsCents: 150 }))).toBe(
      'Your copay is cheaper by $1.50 a month.',
    );
    expect(cmp.comparison(medicationCostFixture({ cheaper: 'same', savingsCents: 0 }))).toBe(
      'Cash and your copay cost the same.',
    );
  });

  it('says when Cost Plus does not sell it, or prices are unavailable', async () => {
    const notSold = await setup(
      loaded(pricesFixture({ status: 'not-sold', price: null, defaultMonthlyCents: null })),
    );
    expect(text(notSold.el.querySelector('[data-testid="not-sold"]'))).toContain(
      'Not sold at Cost Plus Drugs',
    );
    TestBed.resetTestingModule();
    const down = await setup({
      status: 'error',
      data: null,
      error: 'Prices are unavailable right now.',
    });
    expect(text(down.el.querySelector('[data-testid="prices-error"]'))).toBe(
      'Prices are unavailable right now.',
    );
  });

  it('names units by the product form', () => {
    expect(unitsLabel(30, 'Tablet')).toBe('30 tablets');
    expect(unitsLabel(1, 'Capsule')).toBe('1 capsule');
    expect(unitsLabel(2, 'Solution')).toBe('2 units');
  });
});
