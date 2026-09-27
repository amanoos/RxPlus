import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { provideMockActions } from '@ngrx/effects/testing';
import { Action } from '@ngrx/store';
import { firstValueFrom, of, Subject, throwError } from 'rxjs';

import { medicationFixture } from '../medication.fixture';
import { MedicationsApi } from '../medications-api.service';
import { MedicationsActions } from './medications.actions';
import * as effects from './medications.effects';

describe('medications effects', () => {
  let actions$: Subject<Action>;
  const api = { list: vi.fn(), add: vi.fn(), update: vi.fn(), remove: vi.fn() };
  const med = medicationFixture();

  beforeEach(() => {
    actions$ = new Subject<Action>();
    vi.resetAllMocks();
    TestBed.configureTestingModule({
      providers: [provideMockActions(() => actions$), { provide: MedicationsApi, useValue: api }],
    });
  });

  const run = <T>(effect: () => T) => TestBed.runInInjectionContext(effect);
  const httpError = (status: number, statusMessage?: string) =>
    throwError(
      () => new HttpErrorResponse({ status, error: statusMessage ? { statusMessage } : null }),
    );

  it('loads the list', async () => {
    api.list.mockReturnValue(of([med]));
    const result = firstValueFrom(run(() => effects.load()));
    actions$.next(MedicationsActions.load());
    expect(await result).toEqual(MedicationsActions.loadSuccess({ medications: [med] }));
  });

  it('adds a medication', async () => {
    api.add.mockReturnValue(of(med));
    const result = firstValueFrom(run(() => effects.add()));
    actions$.next(MedicationsActions.add({ rxcui: '314076', notes: 'x' }));
    expect(await result).toEqual(MedicationsActions.addSuccess({ medication: med }));
    expect(api.add).toHaveBeenCalledWith({ rxcui: '314076', notes: 'x' });
  });

  it.each([
    [
      409,
      'This medication is already on your active list.',
      'This medication is already on your active list.',
    ],
    [422, undefined, 'That product can’t be added.'],
    [503, 'Drug lookup is unavailable right now.', 'Drug lookup is unavailable right now.'],
    [500, undefined, 'Something went wrong. Please try again.'],
  ])('maps a %i add error to a message', async (status, statusMessage, error) => {
    api.add.mockReturnValue(httpError(status, statusMessage));
    const result = firstValueFrom(run(() => effects.add()));
    actions$.next(MedicationsActions.add({ rxcui: '314076' }));
    expect(await result).toEqual(MedicationsActions.addFailure({ error }));
  });

  it('updates and removes', async () => {
    const stopped = { ...med, stoppedOn: '2026-06-01' };
    api.update.mockReturnValue(of(stopped));
    api.remove.mockReturnValue(of(null));

    const updated = firstValueFrom(run(() => effects.update()));
    actions$.next(MedicationsActions.update({ id: med.id, changes: { stoppedOn: '2026-06-01' } }));
    expect(await updated).toEqual(MedicationsActions.updateSuccess({ medication: stopped }));

    const removed = firstValueFrom(run(() => effects.remove()));
    actions$.next(MedicationsActions.remove({ id: med.id }));
    expect(await removed).toEqual(MedicationsActions.removeSuccess({ id: med.id }));
  });

  it('reports a missing medication on update', async () => {
    api.update.mockReturnValue(httpError(404));
    const result = firstValueFrom(run(() => effects.update()));
    actions$.next(MedicationsActions.update({ id: med.id, changes: { notes: 'x' } }));
    expect(await result).toEqual(
      MedicationsActions.updateFailure({ error: 'That medication no longer exists.' }),
    );
  });
});
