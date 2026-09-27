import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideMockActions } from '@ngrx/effects/testing';
import { Action } from '@ngrx/store';
import { MockStore, provideMockStore } from '@ngrx/store/testing';
import { providePrimeNG } from 'primeng/config';
import { Subject } from 'rxjs';

import { AddMedicationDialogComponent } from './add-medication-dialog.component';
import { medicationFixture } from './medication.fixture';
import { ProductPickerComponent } from './product-picker.component';
import { RxNormApi } from './rxnorm-api.service';
import { MedicationsActions } from './store/medications.actions';
import { initialMedicationsState } from './store/medications.reducer';

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
    const picker = fixture.debugElement.query(By.directive(ProductPickerComponent))
      .componentInstance as ProductPickerComponent;
    return { fixture, store, cmp: fixture.componentInstance, picker };
  };

  it('saves the product chosen in the picker with start date and trimmed notes', async () => {
    const { cmp, picker, store } = await setup();
    picker.rxcui.set('314076');
    expect(cmp.selectedRxcui()).toBe('314076');
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

  it('shows the save error from the store', async () => {
    await setup({
      ...initialMedicationsState,
      error: 'This medication is already on your active list.',
    });
    expect(document.body.textContent).toContain('This medication is already on your active list.');
  });

  it('closes after a successful add, and resets the picker when hidden', async () => {
    const { cmp, picker, fixture } = await setup();
    picker.rxcui.set('314076');
    actions$.next(MedicationsActions.addSuccess({ medication: medicationFixture() }));
    await fixture.whenStable();
    expect(cmp.visible()).toBe(false);
    cmp.reset();
    expect(picker.rxcui()).toBeNull();
    expect(cmp.selectedRxcui()).toBeNull();
  });
});
