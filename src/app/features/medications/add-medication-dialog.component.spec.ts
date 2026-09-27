import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { provideMockActions } from '@ngrx/effects/testing';
import { Action } from '@ngrx/store';
import { MockStore, provideMockStore } from '@ngrx/store/testing';
import { providePrimeNG } from 'primeng/config';
import { of, Subject, throwError } from 'rxjs';

import { AddMedicationDialogComponent } from './add-medication-dialog.component';
import { medicationFixture } from './medication.fixture';
import { RxNormApi, type RxProduct } from './rxnorm-api.service';
import { MedicationsActions } from './store/medications.actions';
import { initialMedicationsState } from './store/medications.reducer';

const products: RxProduct[] = [
  {
    rxcui: '104377',
    name: 'lisinopril 10 MG Oral Tablet [Zestril]',
    tty: 'SBD',
    brandName: 'Zestril',
  },
  { rxcui: '314076', name: 'lisinopril 10 MG Oral Tablet', tty: 'SCD', brandName: null },
];

describe('AddMedicationDialogComponent', () => {
  const rxnorm = { search: vi.fn(), products: vi.fn() };
  let actions$: Subject<Action>;

  const setup = async (medications = initialMedicationsState) => {
    actions$ = new Subject<Action>();
    vi.resetAllMocks();
    await TestBed.configureTestingModule({
      imports: [AddMedicationDialogComponent],
      providers: [
        providePrimeNG(),
        provideMockStore({ initialState: { medications } }),
        provideMockActions(() => actions$),
        { provide: RxNormApi, useValue: rxnorm },
      ],
    }).compileComponents();
    const store = TestBed.inject(MockStore);
    vi.spyOn(store, 'dispatch');
    const fixture = TestBed.createComponent(AddMedicationDialogComponent);
    fixture.componentRef.setInput('visible', true);
    await fixture.whenStable();
    return { fixture, store, cmp: fixture.componentInstance, doc: document };
  };

  it('suggests drug names from the search', async () => {
    const { cmp } = await setup();
    rxnorm.search.mockReturnValue(of(['lisinopril', 'hydroCHLOROthiazide / lisinopril']));
    cmp.search('lisin');
    expect(rxnorm.search).toHaveBeenCalledWith('lisin');
    expect(cmp.suggestions()).toEqual(['lisinopril', 'hydroCHLOROthiazide / lisinopril']);
  });

  it('lists sorted products for the chosen drug and saves the chosen one', async () => {
    const { cmp, fixture, store, doc } = await setup();
    rxnorm.products.mockReturnValue(of(products));
    cmp.selectDrug('lisinopril');
    await fixture.whenStable();

    const options = [...doc.querySelectorAll('[data-testid="product-option"]')].map((o) =>
      o.textContent?.trim(),
    );
    expect(options).toEqual([
      'lisinopril 10 MG Oral Tablet',
      'lisinopril 10 MG Oral Tablet [Zestril]',
    ]);

    cmp.selectedRxcui.set('314076');
    cmp.startedOn.set('2026-01-15');
    cmp.notes.set('  with breakfast  ');
    cmp.save();
    expect(store.dispatch).toHaveBeenCalledWith(
      MedicationsActions.add({ rxcui: '314076', startedOn: '2026-01-15', notes: 'with breakfast' }),
    );
  });

  it('does not save without a product', async () => {
    const { cmp, store } = await setup();
    cmp.save();
    expect(store.dispatch).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: MedicationsActions.add.type }),
    );
  });

  it('shows the lookup outage message', async () => {
    const { cmp, fixture, doc } = await setup();
    rxnorm.search.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 503 })));
    cmp.search('lisin');
    await fixture.whenStable();
    expect(cmp.lookupError()).toBe('Drug lookup is unavailable right now.');
    expect(doc.body.textContent).toContain('Drug lookup is unavailable right now.');
  });

  it('shows the save error from the store', async () => {
    const { doc } = await setup({
      ...initialMedicationsState,
      error: 'This medication is already on your active list.',
    });
    expect(doc.body.textContent).toContain('This medication is already on your active list.');
  });

  it('closes and resets after a successful add', async () => {
    const { cmp, fixture } = await setup();
    rxnorm.products.mockReturnValue(of(products));
    cmp.selectDrug('lisinopril');
    cmp.selectedRxcui.set('314076');
    actions$.next(MedicationsActions.addSuccess({ medication: medicationFixture() }));
    await fixture.whenStable();
    expect(cmp.visible()).toBe(false);
    expect(cmp.selectedDrug()).toBeNull();
    expect(cmp.selectedRxcui()).toBeNull();
  });
});
