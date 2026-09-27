import { TestBed } from '@angular/core/testing';
import { provideMockActions } from '@ngrx/effects/testing';
import { Action } from '@ngrx/store';
import { MockStore, provideMockStore } from '@ngrx/store/testing';
import { providePrimeNG } from 'primeng/config';
import { Subject } from 'rxjs';

import { localToday } from '../../shared/dates';
import { EditMedicationDialogComponent, type EditMode } from './edit-medication-dialog.component';
import { medicationFixture } from './medication.fixture';
import { MedicationsActions } from './store/medications.actions';
import { initialMedicationsState } from './store/medications.reducer';

describe('EditMedicationDialogComponent', () => {
  let actions$: Subject<Action>;
  const med = medicationFixture({ notes: 'morning', startedOn: '2026-01-15' });

  const setup = async (mode: EditMode) => {
    actions$ = new Subject<Action>();
    await TestBed.configureTestingModule({
      imports: [EditMedicationDialogComponent],
      providers: [
        providePrimeNG(),
        provideMockStore({ initialState: { medications: initialMedicationsState } }),
        provideMockActions(() => actions$),
      ],
    }).compileComponents();
    const store = TestBed.inject(MockStore);
    vi.spyOn(store, 'dispatch');
    const fixture = TestBed.createComponent(EditMedicationDialogComponent);
    fixture.componentRef.setInput('medication', med);
    fixture.componentRef.setInput('mode', mode);
    fixture.componentRef.setInput('visible', true);
    await fixture.whenStable();
    return { fixture, store, cmp: fixture.componentInstance };
  };

  it('prefills and saves notes and start date in edit mode', async () => {
    const { cmp, store } = await setup('edit');
    expect(cmp.notes()).toBe('morning');
    expect(cmp.startedOn()).toBe('2026-01-15');

    cmp.notes.set('  evening ');
    cmp.startedOn.set('2026-01-20');
    cmp.save();
    expect(store.dispatch).toHaveBeenCalledWith(
      MedicationsActions.update({
        id: med.id,
        changes: { notes: 'evening', startedOn: '2026-01-20' },
      }),
    );
  });

  it('defaults the stop date to today and saves it in stop mode', async () => {
    const { cmp, store } = await setup('stop');
    expect(cmp.stoppedOn()).toBe(localToday());
    cmp.stoppedOn.set('2026-06-01');
    cmp.save();
    expect(store.dispatch).toHaveBeenCalledWith(
      MedicationsActions.update({ id: med.id, changes: { stoppedOn: '2026-06-01' } }),
    );
  });

  it('refuses a stop date before the start date', async () => {
    const { cmp, store } = await setup('stop');
    cmp.stoppedOn.set('2026-01-01');
    expect(cmp.invalid()).toBe('The stop date can’t be before the start date.');
    cmp.save();
    expect(store.dispatch).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: MedicationsActions.update.type }),
    );
  });

  it('closes after a successful update', async () => {
    const { cmp, fixture } = await setup('edit');
    actions$.next(MedicationsActions.updateSuccess({ medication: med }));
    await fixture.whenStable();
    expect(cmp.visible()).toBe(false);
  });
});
