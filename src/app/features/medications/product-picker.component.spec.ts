import { HttpErrorResponse } from '@angular/common/http';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { providePrimeNG } from 'primeng/config';
import { of, throwError } from 'rxjs';

import { AppReady } from '../../core/app-ready';
import { ProductPickerComponent } from './product-picker.component';
import { RxNormApi, type RxProduct } from './rxnorm-api.service';

const products: RxProduct[] = [
  {
    rxcui: '104377',
    name: 'lisinopril 10 MG Oral Tablet [Zestril]',
    tty: 'SBD',
    brandName: 'Zestril',
  },
  { rxcui: '314076', name: 'lisinopril 10 MG Oral Tablet', tty: 'SCD', brandName: null },
];

describe('ProductPickerComponent', () => {
  const rxnorm = { search: vi.fn(), products: vi.fn() };

  const setup = async (
    inputs: Record<string, string> = {},
    appReady?: { isReady: () => boolean },
  ) => {
    vi.resetAllMocks();
    await TestBed.configureTestingModule({
      imports: [ProductPickerComponent],
      providers: [
        providePrimeNG(),
        { provide: RxNormApi, useValue: rxnorm },
        ...(appReady ? [{ provide: AppReady, useValue: appReady }] : []),
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(ProductPickerComponent);
    for (const [name, value] of Object.entries(inputs)) fixture.componentRef.setInput(name, value);
    await fixture.whenStable();
    return { fixture, cmp: fixture.componentInstance, el: fixture.nativeElement as HTMLElement };
  };

  it('keeps the drug search disabled until the app has loaded', async () => {
    const ready = signal(false);
    const { el, fixture } = await setup({}, { isReady: ready });
    const search = () => el.querySelector<HTMLInputElement>('input#drug-search')!;
    expect(search().closest('fieldset')!.disabled).toBe(true);
    expect(search().matches(':disabled')).toBe(true);

    ready.set(true);
    await fixture.whenStable();
    expect(search().matches(':disabled')).toBe(false);
  });

  it('suggests drug names from the search', async () => {
    const { cmp } = await setup();
    rxnorm.search.mockReturnValue(of(['lisinopril', 'hydroCHLOROthiazide / lisinopril']));
    cmp.search('lisin');
    expect(rxnorm.search).toHaveBeenCalledWith('lisin');
    expect(cmp.suggestions()).toEqual(['lisinopril', 'hydroCHLOROthiazide / lisinopril']);
  });

  it('lists sorted products and emits the chosen RXCUI', async () => {
    const { cmp, fixture, el } = await setup();
    rxnorm.products.mockReturnValue(of(products));
    cmp.selectDrug('lisinopril');
    await fixture.whenStable();
    const options = [...el.querySelectorAll('[data-testid="product-option"]')];
    expect(options.map((o) => o.textContent?.trim())).toEqual([
      'lisinopril 10 MG Oral Tablet',
      'lisinopril 10 MG Oral Tablet [Zestril]',
    ]);
    options[0].querySelector('input')?.dispatchEvent(new Event('change'));
    expect(cmp.rxcui()).toBe('314076');
  });

  it('clears the chosen product when the drug changes, and on reset', async () => {
    const { cmp } = await setup();
    rxnorm.products.mockReturnValue(of(products));
    cmp.selectDrug('lisinopril');
    cmp.rxcui.set('314076');
    cmp.selectDrug('atorvastatin');
    expect(cmp.rxcui()).toBeNull();
    cmp.rxcui.set('617310');
    cmp.reset();
    expect(cmp.rxcui()).toBeNull();
    expect(cmp.selectedDrug()).toBeNull();
  });

  it('shows the lookup outage message', async () => {
    const { cmp, fixture, el } = await setup();
    rxnorm.search.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 503 })));
    cmp.search('lisin');
    await fixture.whenStable();
    expect(el.textContent).toContain('Drug lookup is unavailable right now.');
  });

  it('uses the given input id and radio group name', async () => {
    const { cmp, fixture, el } = await setup({ inputId: 'check-drug', radioName: 'check-product' });
    rxnorm.products.mockReturnValue(of(products));
    cmp.selectDrug('lisinopril');
    await fixture.whenStable();
    expect(el.querySelector('label[for="check-drug"]')).not.toBeNull();
    expect(el.querySelector('input[type="radio"]')?.getAttribute('name')).toBe('check-product');
  });
});
