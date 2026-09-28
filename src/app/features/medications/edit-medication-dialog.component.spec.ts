import { TestBed } from '@angular/core/testing';
import { provideMockActions } from '@ngrx/effects/testing';
import { Action } from '@ngrx/store';
import { MockStore, provideMockStore } from '@ngrx/store/testing';
import { providePrimeNG } from 'primeng/config';
import { of, Subject, throwError, type Observable } from 'rxjs';

import { localToday } from '../../shared/dates';
import type { DrugFacts } from '../drug-info/drug-info';
import { DrugInfoApi } from '../drug-info/drug-info-api.service';
import { factsFixture } from '../drug-info/drug-info.fixture';
import { EditMedicationDialogComponent, type EditMode } from './edit-medication-dialog.component';
import { medicationFixture } from './medication.fixture';
import { MedicationsActions } from './store/medications.actions';
import { initialMedicationsState } from './store/medications.reducer';

describe('EditMedicationDialogComponent', () => {
  let actions$: Subject<Action>;
  const med = medicationFixture({ notes: 'morning', startedOn: '2026-01-15' });

  const drugInfo = { facts: vi.fn<(rxcui: string) => Observable<DrugFacts>>() };

  const setup = async (mode: EditMode, medication = med) => {
    actions$ = new Subject<Action>();
    drugInfo.facts.mockReset();
    drugInfo.facts.mockReturnValue(of(factsFixture()));
    await TestBed.configureTestingModule({
      imports: [EditMedicationDialogComponent],
      providers: [
        providePrimeNG(),
        provideMockStore({ initialState: { medications: initialMedicationsState } }),
        provideMockActions(() => actions$),
        { provide: DrugInfoApi, useValue: drugInfo },
      ],
    }).compileComponents();
    const store = TestBed.inject(MockStore);
    vi.spyOn(store, 'dispatch');
    const fixture = TestBed.createComponent(EditMedicationDialogComponent);
    fixture.componentRef.setInput('medication', medication);
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

  it('prefills units and copay, and sends only what changed', async () => {
    const withCopay = medicationFixture({ unitsPerMonth: 60, copayCents: 1000, copayUnits: 90 });
    const { cmp, store } = await setup('edit', withCopay);
    expect([cmp.unitsPerMonth(), cmp.copayAmount(), cmp.copayUnits()]).toEqual([
      '60',
      '10.00',
      '90',
    ]);
    cmp.save();
    expect(store.dispatch).toHaveBeenLastCalledWith(
      MedicationsActions.update({
        id: withCopay.id,
        changes: { notes: null, startedOn: '2026-01-15' },
      }),
    );

    cmp.unitsPerMonth.set('30');
    cmp.copayAmount.set('4.5');
    cmp.copayUnits.set('30');
    cmp.save();
    expect(store.dispatch).toHaveBeenLastCalledWith(
      MedicationsActions.update({
        id: withCopay.id,
        changes: {
          notes: null,
          startedOn: '2026-01-15',
          unitsPerMonth: 30,
          copay: { amountCents: 450, units: 30 },
        },
      }),
    );

    cmp.copayAmount.set('');
    cmp.copayUnits.set('');
    cmp.save();
    expect(store.dispatch).toHaveBeenLastCalledWith(
      MedicationsActions.update({
        id: withCopay.id,
        changes: { notes: null, startedOn: '2026-01-15', unitsPerMonth: 30, copay: null },
      }),
    );
  });

  it('explains invalid units or a half-entered copay', async () => {
    const { cmp } = await setup('edit');
    cmp.unitsPerMonth.set('0');
    expect(cmp.invalid()).toContain('Units per month');
    cmp.unitsPerMonth.set('1.25');
    expect(cmp.invalid()).toContain('Units per month');
    cmp.unitsPerMonth.set('30');
    cmp.copayAmount.set('10');
    expect(cmp.invalid()).toBe('Enter both the copay and how many units it covers.');
    cmp.copayUnits.set('0');
    expect(cmp.invalid()).toContain('The copay’s units');
    cmp.copayAmount.set('-3');
    cmp.copayUnits.set('30');
    expect(cmp.invalid()).toBe('Enter the copay in dollars.');
    cmp.copayAmount.set('3');
    expect(cmp.invalid()).toBeNull();
  });

  it('offers the drug’s known uses as "Taken for" and saves a change', async () => {
    const { cmp, store, fixture } = await setup('edit');
    expect(drugInfo.facts).toHaveBeenCalledWith(med.rxcui);
    const select = fixture.nativeElement.querySelector(
      '[data-testid="taken-for-select"]',
    ) as HTMLSelectElement;
    expect([...select.options].map((o) => o.textContent?.trim())).toEqual([
      'Not set',
      'Heart Failure',
      'Hypertension',
    ]);
    select.value = 'D006973';
    select.dispatchEvent(new Event('change'));
    cmp.save();
    expect(store.dispatch).toHaveBeenCalledWith(
      MedicationsActions.update({
        id: med.id,
        changes: {
          notes: 'morning',
          startedOn: '2026-01-15',
          takenFor: { id: 'D006973', name: 'Hypertension' },
        },
      }),
    );
  });

  it('keeps or clears an existing "Taken for"', async () => {
    const withTakenFor = medicationFixture({
      notes: 'morning',
      startedOn: '2026-01-15',
      takenForId: 'D006973',
      takenForName: 'Hypertension',
    });
    const { cmp, store } = await setup('edit', withTakenFor);
    expect(cmp.takenForId()).toBe('D006973');
    cmp.save();
    // Unchanged: not sent.
    expect(store.dispatch).toHaveBeenLastCalledWith(
      MedicationsActions.update({
        id: withTakenFor.id,
        changes: { notes: 'morning', startedOn: '2026-01-15' },
      }),
    );
    cmp.takenForId.set('');
    cmp.save();
    expect(store.dispatch).toHaveBeenLastCalledWith(
      MedicationsActions.update({
        id: withTakenFor.id,
        changes: { notes: 'morning', startedOn: '2026-01-15', takenFor: null },
      }),
    );
  });

  it('keeps the current choice selectable when the uses can’t be loaded', async () => {
    drugInfo.facts.mockReturnValue(throwError(() => new Error('down')));
    const withTakenFor = medicationFixture({ takenForId: 'D006973', takenForName: 'Hypertension' });
    TestBed.resetTestingModule();
    actions$ = new Subject<Action>();
    await TestBed.configureTestingModule({
      imports: [EditMedicationDialogComponent],
      providers: [
        providePrimeNG(),
        provideMockStore({ initialState: { medications: initialMedicationsState } }),
        provideMockActions(() => actions$),
        { provide: DrugInfoApi, useValue: drugInfo },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(EditMedicationDialogComponent);
    fixture.componentRef.setInput('medication', withTakenFor);
    fixture.componentRef.setInput('mode', 'edit');
    fixture.componentRef.setInput('visible', true);
    await fixture.whenStable();
    expect(fixture.componentInstance.usesStatus()).toBe('error');
    expect(fixture.componentInstance.useOptions()).toEqual([
      { id: 'D006973', name: 'Hypertension' },
    ]);
    expect(document.querySelector('[data-testid="uses-error"]')?.textContent).toContain(
      'Couldn’t load this drug’s uses',
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
